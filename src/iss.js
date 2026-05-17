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

function geographicFeature(lat, lon) {
  if (lat == null || lon == null) return { label: "the open ocean", searchQuery: "open ocean, Earth" };
  lon = ((lon + 540) % 360) - 180;
  const inBox = (latMin, latMax, lonMin, lonMax) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
  const feature = (label, searchQuery) => ({ label, searchQuery });

  // Major mountain ranges, plateaus, and deserts. These come before ocean
  // basins so inland locations get meaningful natural-feature labels.
  if (inBox(26, 36, 70, 96)) return feature("the Himalayas", "Himalayas mountain range, Asia");
  if (inBox(26, 38, 78, 100)) return feature("the Tibetan Plateau", "Tibetan Plateau, Asia");
  if (inBox(38, 50, 88, 122)) return feature("the Gobi Desert", "Gobi Desert, Mongolia and China");
  if (inBox(36, 42, 76, 91)) return feature("the Taklamakan Desert", "Taklamakan Desert, Xinjiang, China");
  if (inBox(24, 32, 68, 76)) return feature("the Thar Desert", "Thar Desert, India and Pakistan");
  if (inBox(18, 33, -17, 35)) return feature("the Sahara Desert", "Sahara Desert, North Africa");
  if (inBox(11, 23, 35, 60)) return feature("the Arabian Desert", "Arabian Desert, Arabian Peninsula");
  if (inBox(10, 24, 10, 25)) return feature("the Sahel", "Sahel region, Africa");
  if (inBox(27, 36, -12, 12)) return feature("the Atlas Mountains", "Atlas Mountains, North Africa");
  if (inBox(-6, 14, 34, 48)) return feature("the Ethiopian Highlands", "Ethiopian Highlands, Ethiopia");
  if (inBox(-30, -15, 12, 18)) return feature("the Namib Desert", "Namib Desert, Namibia");
  if (inBox(-30, -17, 17, 30)) return feature("the Kalahari Desert", "Kalahari Desert, Southern Africa");
  if (inBox(-12, 8, -78, -50)) return feature("the Amazon Basin", "Amazon Basin, South America");
  if (inBox(-32, -18, -75, -66)) return feature("the Atacama Desert", "Atacama Desert, Chile");
  if (inBox(-56, 12, -79, -66)) return feature("the Andes", "Andes mountain range, South America");
  if (inBox(-52, -35, -75, -62)) return feature("the Patagonian Desert", "Patagonian Desert, Argentina");
  if (inBox(31, 37, -121, -114)) return feature("the Mojave Desert", "Mojave Desert, United States");
  if (inBox(25, 34, -116, -107)) return feature("the Sonoran Desert", "Sonoran Desert, United States and Mexico");
  if (inBox(25, 36, -109, -101)) return feature("the Chihuahuan Desert", "Chihuahuan Desert, North America");
  if (inBox(36, 43, -120, -112)) return feature("the Great Basin Desert", "Great Basin Desert, United States");
  if (inBox(31, 60, -125, -103)) return feature("the Rocky Mountains", "Rocky Mountains, North America");
  if (inBox(43, 48, 5, 16)) return feature("the Alps", "Alps mountain range, Europe");
  if (inBox(-36, -24, 120, 135)) return feature("the Great Victoria Desert", "Great Victoria Desert, Australia");
  if (inBox(-30, -21, 135, 146)) return feature("the Simpson Desert", "Simpson Desert, Australia");
  if (inBox(-35, -20, 113, 138)) return feature("the Australian Outback", "Australian Outback");
  if (inBox(40, 60, -120, -90)) return feature("the Canadian interior", "Canadian interior, Canada");
  if (inBox(35, 55, 50, 88)) return feature("Central Asia", "Central Asia");
  if (inBox(55, 75, 30, 180)) return feature("Siberia", "Siberia, Russia");
  if (inBox(22, 40, 100, 122)) return feature("inland China", "inland China");

  // Enclosed / marginal seas.
  if (inBox(30, 46, -6, 36)) return feature("the Mediterranean Sea", "Mediterranean Sea");
  if (inBox(40, 47, 27, 42)) return feature("the Black Sea", "Black Sea");
  if (inBox(36, 47, 46, 55)) return feature("the Caspian Sea", "Caspian Sea");
  if (inBox(12, 30, 32, 44)) return feature("the Red Sea", "Red Sea");
  if (inBox(24, 30, 48, 57)) return feature("the Persian Gulf", "Persian Gulf");
  if (inBox(0, 25, 50, 78)) return feature("the Arabian Sea", "Arabian Sea");
  if (inBox(5, 22, 78, 100)) return feature("the Bay of Bengal", "Bay of Bengal");
  if (inBox(50, 60, 10, 32)) return feature("the Baltic Sea", "Baltic Sea");
  if (inBox(51, 62, -4, 11)) return feature("the North Sea", "North Sea");
  if (inBox(62, 75, -5, 18)) return feature("the Norwegian Sea", "Norwegian Sea");
  if (inBox(68, 82, 18, 65)) return feature("the Barents Sea", "Barents Sea");
  if (inBox(72, 84, -22, 18)) return feature("the Greenland Sea", "Greenland Sea");
  if (inBox(50, 66, -97, -76)) return feature("Hudson Bay", "Hudson Bay, Canada");
  if (inBox(56, 72, -170, -156)) return feature("the Bering Sea", "Bering Sea");
  if (inBox(45, 60, 135, 165)) return feature("the Sea of Okhotsk", "Sea of Okhotsk");
  if (inBox(33, 52, 128, 142)) return feature("the Sea of Japan", "Sea of Japan");
  if (inBox(24, 38, 117, 130)) return feature("the East China Sea", "East China Sea");
  if (inBox(0, 24, 100, 122)) return feature("the South China Sea", "South China Sea");
  if (inBox(10, 33, 121, 145)) return feature("the Philippine Sea", "Philippine Sea");
  if (inBox(-12, 7, 105, 125)) return feature("the Java Sea", "Java Sea");
  if (inBox(-9, 0, 122, 135)) return feature("the Banda Sea", "Banda Sea");
  if (inBox(-7, 12, 130, 152)) return feature("the Bismarck Sea", "Bismarck Sea");
  if (inBox(-26, -9, 142, 160)) return feature("the Coral Sea", "Coral Sea");
  if (inBox(-50, -28, 145, 175)) return feature("the Tasman Sea", "Tasman Sea");
  if (inBox(-22, -10, 30, 52)) return feature("the Mozambique Channel", "Mozambique Channel");
  if (inBox(13, 30, -98, -80)) return feature("the Gulf of Mexico", "Gulf of Mexico");
  if (inBox(8, 23, -88, -60)) return feature("the Caribbean Sea", "Caribbean Sea");
  if (inBox(50, 75, -90, -50)) return feature("the Labrador Sea", "Labrador Sea");

  if (lat > 66) return feature("the Arctic Ocean", "Arctic Ocean");
  if (lat < -60) return feature("the Southern Ocean", "Southern Ocean");
  if (lon >= 20 && lon <= 100 && lat < 30) {
    if (lat < -30) return feature("the Southern Indian Ocean", "Southern Indian Ocean");
    return feature("the Indian Ocean", "Indian Ocean");
  }
  if (lon > 100 || lon < -70) {
    if (lat > 30) return feature("the North Pacific Ocean", "North Pacific Ocean");
    if (lat < -10) return feature("the South Pacific Ocean", "South Pacific Ocean");
    if (lon < -100 && lat > 0 && lat < 30) return feature("the Eastern Pacific Ocean", "Eastern Pacific Ocean");
    return feature("the Equatorial Pacific Ocean", "Equatorial Pacific Ocean");
  }
  if (lon >= -70 && lon <= 20) {
    if (lat > 30) return feature("the North Atlantic Ocean", "North Atlantic Ocean");
    if (lat < 0) return feature("the South Atlantic Ocean", "South Atlantic Ocean");
    return feature("the Equatorial Atlantic Ocean", "Equatorial Atlantic Ocean");
  }
  return feature("the open ocean", "open ocean, Earth");
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
  geographicFeature,
  greatCircleKm,
  elevationDeg,
  nextPasses,
};
