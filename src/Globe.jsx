import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as ISS from "./iss";

// Three.js Earth globe with drag controls.
// - Textured sphere (Blue Marble) for the Google-Earth look
// - Soft atmosphere rim
// - ISS marker sitting at altitude on the sphere
// - Orbital ground-track as a Line that follows the propagator
// - Mouse / touch drag to rotate; auto-tracks ISS on initial load, then
//   stops the moment the user grabs it. A small Re-centre control re-enables.


const EARTH_RADIUS_UNITS = 1;          // scene units
const EARTH_RADIUS_KM = 6371;
const ALT_UNITS = (altKm) => EARTH_RADIUS_UNITS * (1 + altKm / EARTH_RADIUS_KM); // sphere radius at ISS altitude

// Texture URL — NASA Blue Marble day texture (public domain).
const TEX_DAY   = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r158/examples/textures/planets/earth_atmos_2048.jpg";

// lat/lon (deg) → THREE.Vector3 on sphere of given radius, aligned with
// the standard equirectangular blue-marble texture (Greenwich at u=0.5).
function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Sub-solar point (where the sun is directly overhead) for a given UTC time.
// Simplified model: solar declination from day-of-year (±23.44° sinusoid),
// hour-angle from UTC time-of-day. Good to a degree or so — plenty for a
// visual day/night terminator.
function subSolarPoint(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const decl = 23.44 * Math.sin(((dayOfYear - 81) / 365) * 2 * Math.PI);
  const utcHours = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600;
  const lon = -15 * (utcHours - 12); // sub-solar longitude
  return { lat: decl, lon };
}

export function Globe({ iss, propagator, observer, observerVisible, accent = "#5cf0ff", following, onDragStart }) {
  const wrapRef = useRef(null);
  const stateRef = useRef({});                  // mutable three.js state container
  const [size, setSize] = useState({ w: 800, h: 800 });
  const followingRef = useRef(following);
  followingRef.current = following;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;

  const liveRef = useRef({ iss, propagator });
  liveRef.current = { iss, propagator };
  const [renderError, setRenderError] = useState(false);

  // Resize observer
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── one-time scene setup ──
  useEffect(() => {
    if (!wrapRef.current) return;
    const wrap = wrapRef.current;

    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setRenderError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(800, 800);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0, 5.6);

    // Earth + everything that rotates with it lives in this group.
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // ── Earth ──
    // Preserve Blue Marble surface colours under time-based sunlight.
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const dayTex = loader.load(TEX_DAY, (t) => { t.colorSpace = THREE.SRGBColorSpace; });
    dayTex.colorSpace = THREE.SRGBColorSpace;
    dayTex.anisotropy = 8;

    const earthMat = new THREE.MeshPhongMaterial({ map: dayTex, shininess: 12, specular: new THREE.Color("#24465c") });
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 96, 64),
      earthMat
    );
    earthGroup.add(earth);

    // Subtle limb darkening (back-side fresnel painted near black) gives
    // the sphere depth without dimming the front face.
    const limbMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -normalize(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.5);
          gl_FragColor = vec4(0.0, 0.0, 0.0, fres * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const limb = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.001, 96, 48),
      limbMat
    );
    earthGroup.add(limb);


    // Earth-fixed sunlight tracks the UTC sub-solar point.
    const ambient = new THREE.AmbientLight(0x8faed1, 1.4);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(0xfff4df, 2.6);
    earthGroup.add(sunlight);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 n; varying vec3 v; void main(){ n=normalize(normalMatrix*normal); vec4 p=modelViewMatrix*vec4(position,1.); v=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
        fragmentShader: `varying vec3 n; varying vec3 v; void main(){ float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.); gl_FragColor=vec4(.25,.65,1.,rim*.42); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    earthGroup.add(atmosphere);

    // ── ISS marker ──
    const issGroup = new THREE.Group();
    earthGroup.add(issGroup);

    // Small bright sphere
    const issDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    issGroup.add(issDot);

    // Halo sprite
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 128;
    const hctx = haloCanvas.getContext("2d");
    const halo = hctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    halo.addColorStop(0, "rgba(255,255,255,0.9)");
    halo.addColorStop(0.2, "rgba(255,255,255,0.4)");
    halo.addColorStop(0.5, "rgba(255,255,255,0.08)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    hctx.fillStyle = halo;
    hctx.fillRect(0, 0, 128, 128);
    const haloTex = new THREE.CanvasTexture(haloCanvas);
    const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    haloSprite.scale.set(0.18, 0.18, 1);
    issGroup.add(haloSprite);

    // ── Orbital track ──
    const orbitMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.95,
    });
    const orbitGeo = new THREE.BufferGeometry();
    orbitGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 720), 3));
    const orbitLine = new THREE.Line(orbitGeo, orbitMat);
    orbitLine.renderOrder = 2;
    earthGroup.add(orbitLine);

    // ── Direction arrows along the orbit ──
    // Small cones placed along the FUTURE portion of the track, oriented
    // along the tangent so the tip points in the direction of travel.
    const ARROW_COUNT = 5;
    const arrowGeo = new THREE.ConeGeometry(0.012, 0.034, 8);
    arrowGeo.translate(0, 0.017, 0); // origin at base, tip at +Y
    const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent) });
    const arrows = [];
    for (let i = 0; i < ARROW_COUNT; i++) {
      const m = new THREE.Mesh(arrowGeo, arrowMat);
      m.renderOrder = 3;
      m.visible = false;
      arrows.push(m);
      earthGroup.add(m);
    }

    // ── Observer marker (white ring) ──
    const obsGroup = new THREE.Group();
    earthGroup.add(obsGroup);
    const obsRing = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.024, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    obsGroup.add(obsRing);
    const obsDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    obsGroup.add(obsDot);
    obsGroup.visible = false;

    // ── Rotation state: we drive earthGroup.quaternion ──
    // currentQuat eases toward targetQuat each frame. Drag updates targetQuat
    // directly (so rotation tracks the cursor with no lag).
    const targetQuat = new THREE.Quaternion();
    const tmpQuat = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);

    // Initial orientation — show ISS-ish region (default to Greenwich at front).
    targetQuat.identity();
    earthGroup.quaternion.copy(targetQuat);

    // ── Drag handlers ──
    let dragging = false;
    let prevX = 0, prevY = 0;
    let pitch = 0; // accumulated pitch so we can clamp poles
    const onDown = (e) => {
      dragging = true;
      if (followingRef.current) onDragStartRef.current?.();
      prevX = e.clientX; prevY = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX; prevY = e.clientY;
      const w = renderer.domElement.clientWidth || 800;
      // ~half rotation across the viewport width
      const yaw = (dx / w) * Math.PI;
      const wantedPitchDelta = (dy / w) * Math.PI;
      const nextPitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, pitch + wantedPitchDelta));
      const pitchDelta = nextPitch - pitch;
      pitch = nextPitch;
      // Yaw around world Y (so spin behaves like a globe), then pitch around current local X.
      tmpQuat.setFromAxisAngle(yAxis, yaw);
      targetQuat.premultiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, pitchDelta);
      targetQuat.premultiply(tmpQuat);
    };
    const onUp = (e) => {
      dragging = false;
      try { renderer.domElement.releasePointerCapture?.(e.pointerId); } catch {}
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // ── Render loop ──
    const facing = new THREE.Vector3(0, 0, 1);
    const direction = new THREE.Vector3();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lastSun = 0;
    let raf;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const live = liveRef.current;
      if (live.iss) {
        const point = live.propagator ? live.propagator(Date.now() / 1000) : live.iss;
        issGroup.position.copy(latLonToVec3(point.lat, point.lon, ALT_UNITS(live.iss.alt ?? 408)));
        if (followingRef.current && !dragging) {
          targetQuat.setFromUnitVectors(direction.copy(issGroup.position).normalize(), facing);
          pitch = 0;
        }
      }
      if (now - lastSun > 1000 || !lastSun) {
        const sun = subSolarPoint(new Date());
        sunlight.position.copy(latLonToVec3(sun.lat, sun.lon, 10));
        lastSun = now;
      }
      // Ease earthGroup quaternion toward targetQuat
      earthGroup.quaternion.slerp(targetQuat, motionQuery.matches ? 1 : 1 - Math.pow(0.001, dt));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { last = performance.now(); tick(); }
    };
    document.addEventListener("visibilitychange", visibility);
    tick();

    // expose for prop-driven updates
    stateRef.current = {
      renderer, scene, camera, earthGroup, earth, issGroup, issDot, haloSprite,
      orbitLine, orbitGeo, orbitMat, arrows, arrowMat, obsGroup, obsRing, obsDot,
      targetQuat, yAxis, xAxis, tmpQuat,
      setPitch: (p) => { pitch = p; },
      getPitch: () => pitch,
    };

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", visibility);
      const geometries = new Set(), materials = new Set(), textures = new Set([dayTex, haloTex]);
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
      stateRef.current = {};
      wrap.removeChild(renderer.domElement);
    };
  }, []);

  // ── handle resize ──
  useEffect(() => {
    const s = stateRef.current;
    if (!s.renderer || size.w <= 0 || size.h <= 0) return;
    s.renderer.setSize(size.w, size.h);
    const aspect = size.w / size.h;
    s.camera.aspect = aspect;
    // Keep the globe large on wide monitors, step it down on laptops, and
    // fill more of the dedicated in-flow globe slot on phones.
    const fovRad = s.camera.fov * Math.PI / 180;
    const targetFill = size.w <= 900 ? 0.82 : size.w <= 1350 ? 0.54 : size.w <= 1700 ? 0.58 : size.w <= 1900 ? 0.68 : 0.78;
    const dY = 1 / (Math.tan(fovRad / 2) * targetFill);
    const dX = 1 / (Math.tan(fovRad / 2) * aspect * targetFill);
    s.camera.position.z = Math.max(dY, dX, 3);
    s.camera.updateProjectionMatrix();
  }, [size.w, size.h]);

  // ── accent color updates ──
  useEffect(() => {
    const s = stateRef.current;
    if (!s.orbitMat) return;
    s.orbitMat.color = new THREE.Color(accent);
    if (s.arrowMat) s.arrowMat.color = new THREE.Color(accent);
  }, [accent]);

  // ── update orbital track when propagator changes ──
  useEffect(() => {
    const s = stateRef.current;
    if (!s.orbitGeo || !propagator || !iss) return;
    const SEGMENTS = 360;
    const before = ISS.PERIOD_S * 0.5;
    const after  = ISS.PERIOD_S * 1.2;
    const step = (before + after) / SEGMENTS;
    const r = ALT_UNITS(iss.alt || 408) * 0.998; // sit just below ISS marker so dot floats on top
    const positions = s.orbitGeo.getAttribute("position").array;
    let n = 0;
    for (let i = 0; i <= SEGMENTS && n < positions.length / 3; i++) {
      const t = iss.ts - before + i * step;
      const pt = propagator(t);
      const v = latLonToVec3(pt.lat, pt.lon, r);
      positions[n*3]   = v.x;
      positions[n*3+1] = v.y;
      positions[n*3+2] = v.z;
      n++;
    }
    s.orbitGeo.setDrawRange(0, n);
    s.orbitGeo.getAttribute("position").needsUpdate = true;
    s.orbitGeo.computeBoundingSphere();

    // Place direction arrows along the FUTURE arc (after current ts).
    // The future portion spans before/(before+after) -> 1.0 in normalized index.
    if (s.arrows && s.arrows.length) {
      const futureStart = before;                       // seconds offset where t = iss.ts
      const tip = new THREE.Vector3();
      const base = new THREE.Vector3();
      const tangent = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < s.arrows.length; k++) {
        // Spread arrows from ~5% to ~90% of the future arc.
        const frac = 0.06 + (k / (s.arrows.length - 1)) * 0.84;
        const tAt = iss.ts + frac * after;
        const pAt = propagator(tAt);
        const pNext = propagator(tAt + 30);             // 30s ahead for tangent
        base.copy(latLonToVec3(pAt.lat, pAt.lon, r * 1.004));
        tip.copy(latLonToVec3(pNext.lat, pNext.lon, r * 1.004));
        tangent.copy(tip).sub(base).normalize();
        const arrow = s.arrows[k];
        arrow.position.copy(base);
        arrow.quaternion.setFromUnitVectors(up, tangent);
        arrow.visible = true;
      }
    }
  }, [propagator]);

  // ── observer marker ──
  useEffect(() => {
    const s = stateRef.current;
    if (!s.obsGroup) return;
    if (!observer || !observerVisible) { s.obsGroup.visible = false; return; }
    s.obsGroup.visible = true;
    const r = EARTH_RADIUS_UNITS * 1.005;
    const p = latLonToVec3(observer.lat, observer.lon, r);
    s.obsGroup.position.copy(p);
    // Orient the ring to face outward from earth centre.
    s.obsGroup.lookAt(0, 0, 0);
    s.obsGroup.rotateY(Math.PI);
  }, [observer?.lat, observer?.lon, observerVisible]);

  return <div ref={wrapRef} role="img" aria-label="Interactive Earth showing the predicted ISS position and orbital path. Drag to rotate." style={{ position: "absolute", inset: 0 }}>
    {renderError && <p className="globe-error">3D view unavailable. Live telemetry is still available below.</p>}
  </div>;
}
