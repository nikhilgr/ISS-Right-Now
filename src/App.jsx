import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as amplitude from "@amplitude/unified";
import { CITIES } from "./cities";
import { Globe } from "./Globe";
import * as ISS from "./iss";

function getDeviceContext() {
  return {
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    device_pixel_ratio: window.devicePixelRatio || 1,
    is_mobile: window.matchMedia("(max-width: 900px)").matches,
    user_agent: navigator.userAgent,
  };
}

const ACCENT = "#8cdeea";
const DEFAULT_SETTINGS = { units: "imperial", showObserver: true };
const SETTINGS_KEY = "iss-rightnow.settings";

const KM_TO_MI = 0.621371;
const POLL_MS = 4000; // refresh cadence


// ── helpers ──────────────────────────────────────────────────────────────
function fmt(n, dp = 0) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtDate(ts, zone) {
  const d = new Date(ts * 1000);
  // No observer zone → fall back to the viewer's browser zone.
  if (!zone) {
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }
  // zone may be an IANA name ("America/Los_Angeles") or a number meaning a
  // fixed UTC offset in hours. The IANA path is DST-aware; the numeric path
  // is the longitude fallback.
  let tzName;
  if (typeof zone === "string") {
    tzName = zone;
  } else {
    // POSIX Etc/GMT zones invert the sign: Etc/GMT-10 == UTC+10.
    const sign = zone >= 0 ? "-" : "+";
    tzName = `Etc/GMT${sign}${Math.abs(Math.round(zone))}`;
  }
  try {
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: tzName,
    });
  } catch {
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }
}

// Approximate the timezone offset for a longitude, used to display pass times
// in the observer's local time without bundling a full tz database. Accurate
// within ~30 minutes for any point; does not handle daylight saving.
function tzOffsetForLon(lon) {
  if (lon == null) return null;
  return Math.round(lon / 15);
}

// Best-effort IANA timezone lookup from coordinates. We cover the populated
// world's main zones with coarse lat/lon boxes so DST-observing regions
// (US, Canada, Europe, Australia, NZ, Chile, much of southern South America)
// render correctly. Anywhere unmatched falls back to a fixed-offset
// `Etc/GMT±N` zone, which doesn't follow DST — acceptable for most of the
// equatorial and tropical world where DST isn't observed anyway.
function ianaZoneForLatLon(lat, lon) {
  if (lat == null || lon == null) return null;
  const within = (lo, hi, x) => x >= lo && x <= hi;

  // ── Pacific outliers (US) ──
  if (within(18, 23, lat) && within(-161, -154, lon)) return "Pacific/Honolulu";
  if (within(50, 72, lat) && within(-170, -130, lon)) return "America/Anchorage";

  // ── Continental US — band by longitude ──
  if (within(24, 50, lat) && within(-125, -66, lon)) {
    if (lon < -114.5) return "America/Los_Angeles";   // PT
    if (lon < -101.5) return "America/Denver";        // MT (Arizona is mostly OK; Phoenix happens to skip DST, but coarse is fine)
    if (lon <  -85)   return "America/Chicago";       // CT
    return "America/New_York";                        // ET
  }

  // ── Canada — same banding (most of Canada follows US bands) ──
  if (within(48, 70, lat) && within(-141, -52, lon)) {
    if (lon < -120) return "America/Vancouver";
    if (lon < -104) return "America/Edmonton";
    if (lon < -90)  return "America/Winnipeg";
    if (lon < -68)  return "America/Toronto";
    return "America/Halifax";
  }

  // ── Mexico, Central America ──
  if (within(14, 33, lat) && within(-118, -86, lon)) {
    if (lon < -108) return "America/Tijuana";         // Baja
    if (lon < -101) return "America/Mazatlan";
    if (lon < -90)  return "America/Mexico_City";
    return "America/Cancun";
  }

  // ── South America ──
  if (within(-56, 13, lat) && within(-82, -34, lon)) {
    if (lon < -70 && lat < -17) return "America/Santiago";       // Chile (DST)
    if (lon > -65 && lat < -22 && lat > -56) return "America/Argentina/Buenos_Aires"; // AR
    if (lat < 5 && lon < -68 && lon > -82) return "America/Lima"; // Peru, Ecuador
    if (lat < -5 && lon > -55) return "America/Sao_Paulo";       // Brazil east
    return "America/Sao_Paulo";
  }

  // ── Europe — Western / Central / Eastern ──
  if (within(34, 72, lat) && within(-12, 45, lon)) {
    if (lon < -7) return "Europe/Lisbon";              // Portugal, western Spain edge
    if (lon < 1)  return "Europe/London";              // UK / Ireland
    if (lon < 23) return "Europe/Paris";               // CET — most of continental Europe
    return "Europe/Helsinki";                          // EET — Finland, Baltic, Romania, Bulgaria, Greece
  }
  if (within(34, 72, lat) && within(45, 60, lon)) return "Europe/Moscow";

  // ── Russia (broad bands, no DST in modern Russia) ──
  if (within(45, 80, lat) && within(60, 90, lon))  return "Asia/Yekaterinburg";
  if (within(45, 80, lat) && within(90, 110, lon)) return "Asia/Krasnoyarsk";
  if (within(45, 80, lat) && within(110, 130, lon)) return "Asia/Irkutsk";
  if (within(45, 80, lat) && within(130, 150, lon)) return "Asia/Yakutsk";
  if (within(45, 80, lat) && within(150, 180, lon)) return "Asia/Vladivostok";

  // ── Asia ──
  if (within(20, 55, lat) && within(73, 105, lon)) return "Asia/Shanghai";    // China, Mongolia
  if (within(8, 38, lat) && within(60, 78, lon))   return "Asia/Karachi";     // Pakistan
  if (within(6, 36, lat) && within(68, 89, lon))   return "Asia/Kolkata";     // India
  if (within(8, 28, lat) && within(89, 110, lon))  return "Asia/Bangkok";     // SE Asia mainland
  if (within(20, 45, lat) && within(124, 146, lon)) return "Asia/Tokyo";
  if (within(33, 39, lat) && within(125, 132, lon)) return "Asia/Seoul";
  if (within(-12, 7, lat) && within(95, 142, lon)) return "Asia/Jakarta";     // Indonesia (rough)
  if (within(5, 21, lat) && within(115, 127, lon)) return "Asia/Manila";

  // ── Middle East ──
  if (within(12, 42, lat) && within(34, 60, lon)) {
    if (lon < 42) return "Asia/Jerusalem";             // Levant, w/ DST
    return "Asia/Dubai";                               // Arabian Peninsula
  }

  // ── Africa ──
  if (within(-35, 38, lat) && within(-18, 52, lon)) {
    if (lat > 22 && lon > 25) return "Africa/Cairo";   // Egypt (now no DST)
    if (lat > 22) return "Africa/Casablanca";          // Morocco/Algeria/Tunisia (Morocco does DST)
    if (lon > 25) return "Africa/Nairobi";             // East Africa
    return "Africa/Lagos";                             // West/Central Africa
  }
  if (within(-35, -22, lat) && within(15, 35, lon)) return "Africa/Johannesburg";

  // ── Australia / NZ ──
  if (within(-44, -10, lat) && within(112, 154, lon)) {
    if (lon < 128) return "Australia/Perth";
    if (lon < 141) return "Australia/Adelaide";
    return "Australia/Sydney";                          // AEST/AEDT (NSW, VIC, TAS, ACT, QLD)
  }
  if (within(-48, -33, lat) && within(165, 180, lon)) return "Pacific/Auckland";

  return null;  // fall back to fixed offset
}

// Return a renderable timezone + label pair for the observer.
// Prefers a DST-aware IANA zone; falls back to a fixed UTC offset string.
function observerZoneInfo(lat, lon) {
  const iana = ianaZoneForLatLon(lat, lon);
  if (iana) {
    try {
      // Validate the zone with a quick format test.
      const fmt = new Intl.DateTimeFormat(undefined, { timeZone: iana, timeZoneName: "short" });
      const parts = fmt.formatToParts(new Date());
      const tzPart = parts.find(p => p.type === "timeZoneName");
      return { iana, label: tzPart ? tzPart.value : iana };
    } catch { /* fall through */ }
  }
  const off = tzOffsetForLon(lon);
  return { iana: null, offset: off, label: fmtTzLabel(off) };
}

function fmtTzLabel(off) {
  if (off == null) return "";
  const sign = off >= 0 ? "+" : "−";
  return `UTC${sign}${Math.abs(off)}`;
}
function fmtRel(ts) {
  const diff = ts - Date.now()/1000;
  if (diff < 60) return "in <1 min";
  if (diff < 3600) return `in ${Math.round(diff/60)} min`;
  if (diff < 86400) return `in ${Math.round(diff/3600)} h`;
  return `in ${Math.round(diff/86400)} d`;
}
function fmtDuration(s) {
  const m = Math.floor(s/60), sec = Math.round(s%60);
  return `${m}m ${sec.toString().padStart(2,"0")}s`;
}

// ── observer (user location) hook ────────────────────────────────────────
function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  return [settings, setSettings];
}

const LS_KEY = "iss-rightnow.observer";
function useObserver() {
  const [obs, setObs] = useState(() => {
    try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const save = useCallback((o) => {
    setObs(o);
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch {}
  }, []);
  const clear = useCallback(() => {
    setObs(null);
    try { localStorage.removeItem(LS_KEY); } catch {}
  }, []);
  return [obs, save, clear];
}

// ── App ──────────────────────────────────────────────────────────────────
function App() {
  const [settings, setSettings] = useSettings();

  const [iss, setIss] = useState(null);          // {lat, lon, alt, velocity, ts, source}
  const [prevIss, setPrevIss] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | live | error
  const [now, setNow] = useState(Date.now());

  const [observer, setObserver, clearObserver] = useObserver();
  const [passPanel, setPassPanel] = useState(false);
  const [followingISS, setFollowingISS] = useState(true);
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia("(max-width: 900px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobileLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // poll ISS position
  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        const sample = await ISS.fetchISSNow();
        if (cancelled) return;
        setIss(cur => { setPrevIss(cur); return sample; });
        setStatus("live");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          amplitude.track("ISS Data Error Encountered", {
            error_message: e?.message || "unknown",
            ...getDeviceContext(),
          });
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // local clock tick (for the speed display + relative times)
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // propagator (rebuilt whenever we have a fresh sample)
  const propagator = useMemo(() => {
    if (!iss) return null;
    return ISS.buildPropagator(iss, prevIss);
  }, [iss, prevIss]);

  // ── derived display values ──
  const issNow = useMemo(() => {
    if (!iss) return null;
    if (!propagator) return { lat: iss.lat, lon: iss.lon };
    const t = now / 1000;
    const p = propagator(t);
    return { ...iss, lat: p.lat, lon: p.lon, ts: t };
  }, [iss, propagator, now]);

  const placeBelow = useMemo(() => {
    if (!issNow) return null;
    const c = ISS.nearestCity(issNow.lat, issNow.lon);
    if (!c) return { name: "the open ocean", country: "", distanceKm: 0, ocean: true };
    return c;
  }, [issNow]);

  const altMi = iss ? iss.alt * KM_TO_MI : ISS.ALT_KM * KM_TO_MI;
  const altKm = iss ? iss.alt : ISS.ALT_KM;
  const speedMph = iss ? iss.velocity * KM_TO_MI : ISS.SPEED_MPH;
  const speedKmh = iss ? iss.velocity : ISS.SPEED_KMH;

  const isImperial = settings.units === "imperial";
  const altDisplay = isImperial ? Math.round(altMi) : Math.round(altKm);
  const altUnit = isImperial ? "mi" : "km";
  const speedDisplay = Math.round(isImperial ? speedMph : speedKmh);
  const speedUnit = isImperial ? "mph" : "km/h";

  // place phrase
  let placeNode = <span className="skel">—————</span>;
  let placePrefix = "above";
  let searchTerm = null;          // name to feed into the Google search CTA
  let searchLabel = null;
  if (placeBelow) {
    if (placeBelow.ocean) { placeNode = <span className="place">the open ocean</span>; }
    else if (placeBelow.distanceKm < 120) {
      placeNode = <span className="place">{placeBelow.name}</span>;
      searchTerm = `${placeBelow.name}, ${placeBelow.country}`;
      searchLabel = placeBelow.name;
    }
    else if (placeBelow.distanceKm < 700) {
      placePrefix = "near";
      placeNode = <span className="place">{placeBelow.name}</span>;
      searchTerm = `${placeBelow.name}, ${placeBelow.country}`;
      searchLabel = placeBelow.name;
    }
    else {
      const feature = ISS.geographicFeature(issNow?.lat, issNow?.lon);
      placeNode = <span className="place">{feature.label}</span>;
      searchTerm = feature.searchQuery;
      searchLabel = feature.label;
    }
  }

  const miNode = iss ? <span className="miles">{fmt(altDisplay)} {altUnit}</span> : <span className="miles skel">—— mi</span>;

  // ── render ──
  const renderGlobe = () => (
    <Globe
      iss={iss}
      propagator={propagator}
      observer={settings.showObserver ? observer : null}
      observerVisible={settings.showObserver}
      accent={ACCENT}
      following={followingISS}
      onDragStart={() => {
        setFollowingISS(false);
        amplitude.track("Globe Drag Started", { ...getDeviceContext() });
      }}
    />
  );

  return (
    <>
      {!isMobileLayout && (
        <div className="stage stage-desktop">
          {renderGlobe()}
        </div>
      )}

      {!isMobileLayout && !followingISS && !passPanel && (
        <button
          className="recentre-btn"
          onClick={() => {
            setFollowingISS(true);
            amplitude.track("Globe Recentred", { layout: "desktop", ...getDeviceContext() });
          }}
          title="Re-centre on the ISS"
        >
          <span className="dot" /> Re-centre on ISS
        </button>
      )}

      <div className="overlay">
        {/* top row */}
        <div className="top">
          <div className="brand">
            <div className="mark" />
            <div>
              <div className="name">ISS Right <em>Now</em></div>
              <div className="domain">issrightnow.app</div>
            </div>
          </div>
          <div className={`status ${status === "loading" ? "is-loading" : status === "error" ? "is-error" : ""}`}>
            <span className="dot" />
            {status === "loading" && "Acquiring signal"}
            {status === "live" && <>Live · updated every {POLL_MS/1000}s</>}
            {status === "error" && "Telemetry offline"}
          </div>
        </div>

        {/* middle */}
        <div className="center">
          <div className="lede">
            <h1>
              The International Space Station is {miNode} {placePrefix} {placeNode}
              {searchTerm && (
                <a
                  className="learn-more"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchTerm)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Learn more about ${searchLabel || searchTerm}`}
                  aria-label={`Learn more about ${searchLabel || searchTerm} on Google`}
                  onClick={() => amplitude.track("Location Clicked", {
                    place_name: searchLabel || searchTerm,
                    iss_lat: issNow?.lat,
                    iss_lon: issNow?.lon,
                    ...getDeviceContext(),
                  })}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <line x1="10.3" y1="10.3" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <span className="lm-text">Learn more</span>
                </a>
              )}
            </h1>
            <button className="pass-btn" onClick={() => {
              setPassPanel(true);
              amplitude.track("Pass Panel Opened", { ...getDeviceContext() });
            }}>
              Pass times over me <span className="arrow">→</span>
            </button>
          </div>

          {isMobileLayout && (
            <div className="mobile-globe-block">
              <div className="stage stage-mobile">
                {renderGlobe()}
              </div>
              {!followingISS && !passPanel && (
                <button
                  className="recentre-btn recentre-btn-mobile"
                  onClick={() => {
                    setFollowingISS(true);
                    amplitude.track("Globe Recentred", { layout: "mobile", ...getDeviceContext() });
                  }}
                  title="Re-centre on the ISS"
                >
                  <span className="dot" /> Re-centre on ISS
                </button>
              )}
            </div>
          )}

          <aside className="rail" aria-label="Station telemetry">
            <div className="stat hero">
              <div className="k">Speed</div>
              <div className="v">{fmt(speedDisplay)}<span className="u">{speedUnit}</span></div>
            </div>
            <div className="stat">
              <div className="k">Latitude</div>
              <div className="v">{issNow ? `${issNow.lat.toFixed(2)}°` : "—"}</div>
            </div>
            <div className="stat">
              <div className="k">Longitude</div>
              <div className="v">{issNow ? `${issNow.lon.toFixed(2)}°` : "—"}</div>
            </div>
            <div className="stat">
              <div className="k">Altitude</div>
              <div className="v">{fmt(altDisplay)}<span className="u">{altUnit}</span></div>
            </div>
            <div className="stat">
              <div className="k">Orbital period</div>
              <div className="v">92<span className="u">min</span></div>
            </div>
            <div className="stat">
              <div className="k">Orbits per day</div>
              <div className="v">16</div>
            </div>

            <div className="footnote">
              <span>Source · <a href={iss?.source === "open-notify" ? "http://open-notify.org/" : "https://wheretheiss.at/"} target="_blank" rel="noopener noreferrer">{iss?.source === "open-notify" ? "Open Notify" : "Where the ISS at?"}</a></span>
              <span className="unit-toggle" role="group" aria-label="Units">
                <button
                  type="button"
                  className={settings.units === "imperial" ? "active" : ""}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, units: 'imperial' }));
                    amplitude.track("Units Changed", { units: "imperial", ...getDeviceContext() });
                  }}
                  aria-pressed={settings.units === "imperial"}
                >mi</button>
                <button
                  type="button"
                  className={settings.units === "metric" ? "active" : ""}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, units: 'metric' }));
                    amplitude.track("Units Changed", { units: "metric", ...getDeviceContext() });
                  }}
                  aria-pressed={settings.units === "metric"}
                >km</button>
              </span>
            </div>
          </aside>
        </div>

        {/* bottom — intentionally empty; Re-centre lives outside the overlay */}
        <div className="bottom" />
      </div>

      <PassPanel
        open={passPanel}
        onClose={() => setPassPanel(false)}
        observer={observer}
        setObserver={setObserver}
        clearObserver={clearObserver}
        propagator={propagator}
        issNow={issNow}
      />

    </>
  );
}

// ── Pass times panel ─────────────────────────────────────────────────────
function PassPanel({ open, onClose, observer, setObserver, clearObserver, propagator, issNow }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [hi, setHi] = useState(0);                // highlighted suggestion index
  // "viewer" — times in the user's browser timezone (default).
  // "observer" — times shifted to the observer location's approximate UTC offset.
  const [tzMode, setTzMode] = useState("viewer");

  // Viewer (browser) timezone label, e.g. "PDT" or "GMT-7".
  const viewerTzLabel = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });
      const parts = fmt.formatToParts(new Date());
      const tzPart = parts.find(p => p.type === "timeZoneName");
      return tzPart ? tzPart.value : "your time";
    } catch { return "your time"; }
  }, []);

  // Effective zone passed to fmtDate — null means "use viewer's browser zone".
  // Prefer the DST-aware IANA zone when we have one for the observer.
  const effectiveZone = tzMode === "observer"
    ? (observer?.tzIana ?? observer?.tzOffset ?? null)
    : null;
  const observerLabel = observer?.tzLabel || null;

  // City autocomplete — rank matches: exact > starts-with > contains, with
  // a stable tie-break on the (population-ordered) array position.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const list = CITIES;
    const exact = [], starts = [], contains = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const name = c[0].toLowerCase();
      const country = (c[1] || "").toLowerCase();
      if (name === q) exact.push(c);
      else if (name.startsWith(q)) starts.push(c);
      else if (name.includes(q) || country.startsWith(q)) contains.push(c);
      if (exact.length + starts.length + contains.length >= 30) break;
    }
    return [...exact, ...starts, ...contains].slice(0, 8);
  }, [query]);

  const passes = useMemo(() => {
    if (!observer || !propagator || !issNow) return [];
    try {
      return ISS.nextPasses(propagator, observer.lat, observer.lon, issNow.ts, 48, 5);
    } catch (e) { return []; }
  }, [observer, propagator, issNow?.ts]);

  useEffect(() => {
    if (!open || !observer || passes.length === 0) return;
    amplitude.track("Pass Times Viewed", {
      pass_count: passes.length,
      observer_label: observer.label || null,
      ...getDeviceContext(),
    });
  }, [open, observer, passes.length]);

  const useBrowserLocation = () => {
    if (!navigator.geolocation) return;
    setBusy(true); setErr(null);

    // Some embedded contexts (iframes without allow=geolocation, locked-down
    // mobile browsers, denied permissions that never surface) cause
    // getCurrentPosition to silently never fire either callback.
    let settled = false;
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      setBusy(false);
    }, 12000);

    const onPos = (pos) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const c = ISS.nearestCity(pos.coords.latitude, pos.coords.longitude);
      const zi = observerZoneInfo(pos.coords.latitude, pos.coords.longitude);
      setObserver({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        tzIana: zi.iana,
        tzOffset: zi.offset,                            // numeric fallback when iana is null
        tzLabel: zi.label,
        label: c ? `${c.name}, ${c.country}` : "your location",
      });
      amplitude.track("Observer Location Set", {
        method: "gps",
        nearest_city: c ? `${c.name}, ${c.country}` : null,
        location_error: null,
        ...getDeviceContext(),
      });
      setBusy(false);
    };
    const onErr = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      setBusy(false);
      const blocked = e && e.code === 1;
      if (blocked) setErr("Location blocked. Allow location in your browser settings, or type a city.");
      amplitude.track("Observer Location Set", {
        method: "gps",
        nearest_city: null,
        location_error: blocked ? "permission_denied" : "unavailable",
        ...getDeviceContext(),
      });
    };

    try {
      navigator.geolocation.getCurrentPosition(onPos, onErr, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,            // accept a cached fix up to a minute old
      });
    } catch (err) {
      onErr(err);
    }
  };

  const pickCity = (c) => {
    setErr(null);
    const zi = observerZoneInfo(c[2], c[3]);
    setObserver({
      lat: c[2], lon: c[3],
      tzIana: zi.iana, tzOffset: zi.offset, tzLabel: zi.label,
      label: `${c[0]}, ${c[1]}`,
    });
    amplitude.track("Observer Location Set", {
      method: "city_search",
      nearest_city: `${c[0]}, ${c[1]}`,
      location_error: null,
      ...getDeviceContext(),
    });
    setQuery("");
    setHi(0);
  };

  const useCityQuery = () => {
    if (suggestions.length) { pickCity(suggestions[hi] || suggestions[0]); return; }
    const q = query.trim();
    if (!q) return;
    setErr(`Couldn't find "${q}". Try a major city.`);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(i => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(i => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      useCityQuery();
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  if (!open) return null;

  return (
    <div className={`panel-scrim ${open ? "open" : ""}`} onClick={onClose}>
      <div className="panel" role="dialog" aria-modal="true" aria-label="Pass times over you" onKeyDown={e => { if (e.key === "Escape") onClose(); }} onClick={e => e.stopPropagation()}>
        <header>
          <h2>Pass times <em>over you</em></h2>
          <button className="close" onClick={onClose}>Close ×</button>
        </header>

        {observer ? (
          <>
            <div className="loc">
              <span>Observing from</span>
              <span className="where">{observer.label || `${observer.lat.toFixed(2)}°, ${observer.lon.toFixed(2)}°`}</span>
              <button className="change" onClick={() => {
                clearObserver();
                amplitude.track("Observer Location Cleared", { ...getDeviceContext() });
              }}>Change ↺</button>
            </div>

            {/* Timezone toggle — pick whether dates render in the viewer's
                browser zone or the observer location's approximate zone. */}
            {observerLabel && (
              <div className="tz-toggle" role="group" aria-label="Timezone">
                <span className="tz-label">Show times in</span>
                <button
                  type="button"
                  className={tzMode === "viewer" ? "active" : ""}
                  onClick={() => setTzMode("viewer")}
                  aria-pressed={tzMode === "viewer"}
                >Your time · {viewerTzLabel}</button>
                <button
                  type="button"
                  className={tzMode === "observer" ? "active" : ""}
                  onClick={() => setTzMode("observer")}
                  aria-pressed={tzMode === "observer"}
                >{observer.label ? observer.label.split(",")[0] : "Observer"} · {observerLabel}</button>
              </div>
            )}
            {passes.length === 0 ? (
              <div className="visibility-note">
                No passes above 10° in the next 48 hours from this location. The ISS misses high-latitude
                spots — its orbit only reaches 51.6° north or south.
              </div>
            ) : (
              <ol className="pass-list">
                {passes.map((p, i) => (
                  <li key={i}>
                    <span className="idx">0{i+1}</span>
                    <span className="when">
                      <span className="date">{fmtDate(p.start, effectiveZone)}</span>
                      <span className="rel">{fmtRel(p.start)} · visible for {fmtDuration(p.duration)}</span>
                    </span>
                    <span className="meta">
                      <span className="dir">{p.dirFrom} → {p.dirTo}</span><br/>
                      max <span className="elev">{Math.round(p.maxEl)}°</span> elevation
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="visibility-note">
              Visible passes only — elevation ≥ 10°. The ISS appears as a fast, bright star moving
              west-to-east. Best viewing is shortly before dawn or after dusk.
              {observerLabel && (
                <>
                  <br/><br/>
                  {tzMode === "viewer"
                    ? <>All times shown in <strong>your home time</strong> ({viewerTzLabel}). Switch to {observer.label ? observer.label.split(",")[0] : "observer"} time above to see times as a local would.</>
                    : observer?.tzIana
                      ? <>All times shown in <strong>{observer.label ? observer.label.split(",")[0] : "observer"} local time</strong> ({observerLabel}, daylight-saving aware).</>
                      : <>All times shown in <strong>{observer.label ? observer.label.split(",")[0] : "observer"} local time</strong> ({observerLabel}, no daylight saving adjustment).</>}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="loc-prompt">
            <div className="pq">First — <em>where are you watching from?</em></div>
            <button onClick={useBrowserLocation} disabled={busy}>
              {busy ? "Locating…" : "Use my location"}
            </button>
            <div className="or">— or —</div>
            <div className="row">
              <div className="combobox">
                <input
                  placeholder="Type a city (e.g. London, Tokyo, Lima)"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setHi(0); setErr(null); }}
                  onKeyDown={onKey}
                  autoComplete="off"
                  autoFocus
                />
                {suggestions.length > 0 && (
                  <ul className="suggestions" role="listbox">
                    {suggestions.map((c, i) => (
                      <li
                        key={`${c[0]}-${c[1]}-${i}`}
                        role="option"
                        aria-selected={i === hi}
                        className={i === hi ? "hi" : ""}
                        onMouseEnter={() => setHi(i)}
                        onMouseDown={(e) => { e.preventDefault(); pickCity(c); }}
                      >
                        <span className="name">{c[0]}</span>
                        <span className="country">{c[1]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="ghost" onClick={useCityQuery}>Set</button>
            </div>
            {err && <div className="visibility-note" style={{color:"#ff8a8a"}}>{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
