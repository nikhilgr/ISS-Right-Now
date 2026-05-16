import { CITIES } from "./cities";

// ISS data + ground-track propagation + pass-time approximation.
// All maths are intentionally lightweight (no SGP4). Adequate for a "what's
// overhead right now" visual. Pass times are an approximation good enough
// to set expectations — actual viewing should be confirmed elsewhere.

const ISS_PERIOD_MIN = 92.68;                // minutes
const ISS_PERIOD_S   = ISS_PERIOD_MIN * 60;  // seconds
const ISS_INCL_DEG   = 51.6398;              // inclination
const EARTH_W_DEG_S  = 360 / 86164.0905;     // sidereal rotation (deg/s)
const ISS_ALT_KM     = 408;                  // mean
const ISS_SPEED_KMH  = 27580;
const ISS_SPEED_MPH  = 17150;

const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

// Try the modern, CORS-friendly endpoint first; fall back to the named API.
async function fetchISSNow() {
  const tries = [
    "https://api.wheretheiss.at/v1/satellites/25544",
    "https://api.open-notify.org/iss-now.json",
  ];
  for (const url of tries) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.latitude != null) {
        return {
          lat: +j.latitude, lon: +j.longitude,
          alt: +j.altitude || ISS_ALT_KM,
          velocity: +j.velocity || ISS_SPEED_KMH,
          source: "wheretheiss",
          ts: (+j.timestamp || Date.now()/1000),
        };
      }
      if (j.iss_position) {
        return {
          lat: +j.iss_position.latitude, lon: +j.iss_position.longitude,
          alt: ISS_ALT_KM, velocity: ISS_SPEED_KMH,
          source: "open-notify",
          ts: +j.timestamp,
        };
      }
    } catch (e) { /* try next */ }
  }
  throw new Error("ISS feed unavailable");
}

// Solve for an orbital phase (anomaly) that matches lat0 and direction.
// Ground track model assumes a circular orbit at fixed inclination.
//   lat(t) = asin( sin(i) * sin(φ) ), where φ = ω_orbit * (t - t0) + φ0
//   lon_inertial(t) = atan2(cos(i) * sin(φ), cos(φ))
//   lon_ground(t)   = lon_inertial(t) - ω_earth * (t - t0) + Δlon0  (wrapped)
// φ0 is chosen so lat(t0) = lat0; sign of dφ chosen from a past sample to
// match north/south travel. Δlon0 set so lon(t0) = lon0.
function buildPropagator(currentSample, previousSample) {
  const i = ISS_INCL_DEG * TO_RAD;
  const lat0 = currentSample.lat * TO_RAD;
  const lon0 = currentSample.lon * TO_RAD;

  // sin(φ0) = sin(lat0) / sin(i). Clamp to handle rounding noise.
  let sinPhi0 = Math.sin(lat0) / Math.sin(i);
  sinPhi0 = Math.max(-1, Math.min(1, sinPhi0));
  // Two candidate phases per orbit. Disambiguate by latitude trend.
  const phiA = Math.asin(sinPhi0);          // ascending or descending branch
  const phiB = Math.PI - phiA;

  let movingNorth = true;
  if (previousSample) {
    movingNorth = currentSample.lat > previousSample.lat;
  } else {
    // If we don't yet have a trend, assume ascending (cos(φ) > 0 → moving N).
    movingNorth = true;
  }
  const phi0 = movingNorth ? phiA : phiB;

  // Inertial longitude at t=t0 implied by the orbit:
  const lonInertial0 = Math.atan2(Math.cos(i) * Math.sin(phi0), Math.cos(phi0));
  // Offset so wrapped lon matches current ground lon0.
  const lonOffset = lon0 - lonInertial0;

  const wOrbit = (2 * Math.PI) / ISS_PERIOD_S;
  const wEarth = EARTH_W_DEG_S * TO_RAD;
  const t0 = currentSample.ts;

  return function at(t) {
    const dt = t - t0;
    const phi = phi0 + wOrbit * dt;
    const lat = Math.asin(Math.sin(i) * Math.sin(phi));
    const lonI = Math.atan2(Math.cos(i) * Math.sin(phi), Math.cos(phi));
    let lon = lonI - wEarth * dt + lonOffset;
    // Wrap to [-180, 180]
    lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return { lat: lat * TO_DEG, lon: lon * TO_DEG };
  };
}

// Sample the ground track over a window centred on `now`, in seconds.
function sampleTrack(propagator, now, beforeS, afterS, stepS) {
  const pts = [];
  for (let dt = -beforeS; dt <= afterS; dt += stepS) {
    pts.push(propagator(now + dt));
  }
  return pts;
}

// Great-circle distance between two lat/lons (km).
function greatCircleKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const φ1 = lat1 * TO_RAD, φ2 = lat2 * TO_RAD;
  const dφ = (lat2 - lat1) * TO_RAD;
  const dλ = (lon2 - lon1) * TO_RAD;
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Find nearest city from the bundled lookup table.
function nearestCity(lat, lon) {
  const list = CITIES;
  let best = null, bestD = Infinity;
  for (const c of list) {
    const d = greatCircleKm(lat, lon, c[2], c[3]);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  return { name: best[0], country: best[1], lat: best[2], lon: best[3], distanceKm: bestD };
}

// Compute "is this point currently within view of (obsLat, obsLon)?" given
// the ISS altitude, using a spherical-Earth elevation angle.
function elevationDeg(obsLat, obsLon, issLat, issLon, altKm = ISS_ALT_KM) {
  const R = 6371;
  const d = greatCircleKm(obsLat, obsLon, issLat, issLon);
  // Earth-central angle (rad)
  const γ = d / R;
  // ISS in 2D plane through observer, Earth centre, ISS:
  const ox = 0, oy = R;
  const ix = (R + altKm) * Math.sin(γ);
  const iy = (R + altKm) * Math.cos(γ);
  // Vector observer→ISS:
  const vx = ix - ox, vy = iy - oy;
  // Local up at observer is (0, 1).
  const len = Math.hypot(vx, vy);
  const cosZ = vy / len;           // cos(zenith)
  return 90 - Math.acos(cosZ) * TO_DEG;
}

// Approximate next visible passes. We scan the propagated ground track for
// elevation maxima above MIN_ELEV. Direction is taken from the entry → exit
// azimuth on the horizon.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * TO_RAD, φ2 = lat2 * TO_RAD;
  const Δλ = (lon2 - lon1) * TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y, x) * TO_DEG + 360) % 360;
}
function bearingToCardinal(b) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(b / 22.5) % 16];
}

function nextPasses(propagator, obsLat, obsLon, startTs, hoursAhead = 48, count = 5) {
  const STEP = 30;                  // 30-second scan
  const MIN_ELEV = 10;              // degrees — typical "visible" threshold
  const passes = [];
  let inPass = false;
  let pass = null;
  for (let dt = 0; dt < hoursAhead * 3600; dt += STEP) {
    const t = startTs + dt;
    const p = propagator(t);
    const e = elevationDeg(obsLat, obsLon, p.lat, p.lon);
    if (e >= MIN_ELEV) {
      if (!inPass) {
        inPass = true;
        pass = { start: t, end: t, maxEl: e, entry: p, exit: p };
      } else {
        pass.end = t;
        pass.exit = p;
        if (e > pass.maxEl) pass.maxEl = e;
      }
    } else if (inPass) {
      inPass = false;
      pass.duration = pass.end - pass.start;
      const bIn = bearingDeg(obsLat, obsLon, pass.entry.lat, pass.entry.lon);
      const bOut = bearingDeg(obsLat, obsLon, pass.exit.lat, pass.exit.lon);
      pass.dirFrom = bearingToCardinal(bIn);
      pass.dirTo = bearingToCardinal(bOut);
      passes.push(pass);
      pass = null;
      if (passes.length >= count) break;
    }
  }
  return passes;
}

export {
  ISS_PERIOD_S as PERIOD_S,
  ISS_INCL_DEG as INCL_DEG,
  ISS_ALT_KM as ALT_KM,
  ISS_SPEED_KMH as SPEED_KMH,
  ISS_SPEED_MPH as SPEED_MPH,
  fetchISSNow,
  buildPropagator,
  sampleTrack,
  nearestCity,
  greatCircleKm,
  elevationDeg,
  nextPasses,
};
