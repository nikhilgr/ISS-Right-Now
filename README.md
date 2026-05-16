# ISS Right Now

ISS Right Now is a live, browser-based view of the International Space Station. It shows where the ISS is currently flying, how fast it is moving, and when it will next pass over a viewer's location.

The app is a static Vite + React site. There is no backend server: the browser fetches public ISS telemetry, renders the globe with Three.js, and calculates approximate future pass times locally.

## What It Does

- Shows the current ISS position on an interactive 3D Earth.
- Displays live telemetry including speed, latitude, longitude, altitude, orbital period, and orbits per day.
- Names the nearest major city or broad ocean region below the ISS.
- Lets users switch between imperial and metric units.
- Lets users search for a city or use browser geolocation to estimate upcoming visible ISS passes.
- Shows pass times, duration, max elevation, and direction of travel.
- Works as a fully static site, suitable for Cloudflare Pages.

## How It Works

The app fetches live ISS coordinates from public endpoints, then uses a lightweight circular-orbit approximation to keep the marker moving smoothly between live samples. This keeps the experience responsive without requiring a server, bundled orbital data files, or a full SGP4 propagator.

Pass-time estimates are calculated in the browser by scanning the propagated ISS path and finding windows where the ISS is above 10 degrees elevation for the observer. These are useful planning estimates; final skywatching should still be confirmed with a dedicated astronomy source.

## Project Structure

```text
src/
  App.jsx        Main React app, telemetry UI, pass-times panel, settings
  Globe.jsx      Three.js globe, ISS marker, orbit path, observer marker
  iss.js         ISS fetching, propagation, pass prediction, geo helpers
  cities.js      Bundled city lookup table
  main.jsx       React entrypoint
  styles.css     App styling

test/
  iss.test.js    Unit tests for ISS helpers and API normalization
```

## Local Development

Use pnpm for all Node dependency work.

```bash
pnpm install
pnpm run dev
```

Then open the local URL printed by Vite.

The app needs internet access in the browser for live ISS data, Google Fonts, the Earth texture, and external map/source links.

## Checks

Run the full local verification loop before pushing changes:

```bash
pnpm install --frozen-lockfile
pnpm run test
pnpm run build
pnpm run preview
```

The production build outputs static files to `dist/`.

## Package Security

This repo uses pnpm with exact pinned dependency versions. The workspace also enables pnpm supply-chain hardening:

- `minimumReleaseAge: 10080`
- `trustPolicy: no-downgrade`
- `pnpm install --frozen-lockfile` for reproducible installs

Use pnpm only. Do not use npm or yarn for dependency changes.

## Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages with:

- Framework preset: `Vite`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm run build`
- Output directory: `dist`

No server runtime or environment variables are required for the current app.

## Notes

- The app is intentionally static and client-side.
- Pass times are approximate because the propagator is lightweight.
- Browser geolocation is optional; users can search by city instead.
- The project includes a simple SVG favicon at `public/favicon.svg`.
