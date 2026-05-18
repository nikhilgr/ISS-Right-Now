<wizard-report>
# Amplitude post-wizard report

The wizard has integrated Amplitude into **ISS Right Now** — a React + Vite client-side ISS tracker. The `@amplitude/unified` SDK (v1.1.3) was installed, initialised in `src/main.jsx`, and 9 custom events were instrumented across `src/App.jsx`. Session Replay (100% sample rate) and Guides & Surveys are also enabled out of the box.

No existing analytics patterns were found in the codebase — this is a fresh integration.

## SDK initialisation

**File:** `src/main.jsx`

`amplitude.initAll()` is called once before the React root renders. It enables the full autocapture suite (page views, sessions, element clicks, form interactions, file downloads, frustration signals, network requests, web vitals), plus Session Replay and Guides & Surveys.

## Events instrumented

| Event | Description | File |
|---|---|---|
| Pass Panel Opened | User opens the ISS pass times panel for their location. | `src/App.jsx` |
| Observer Location Set | User sets observer location via GPS or city search, capturing method and any errors. | `src/App.jsx` |
| Observer Location Cleared | User clears their observer location from the pass panel. | `src/App.jsx` |
| Pass Times Viewed | User sees the list of upcoming ISS visible passes for their location. | `src/App.jsx` |
| Globe Drag Started | User begins manually dragging/rotating the 3D globe. | `src/App.jsx` |
| Globe Recentred | User clicks the Re-centre button to snap the globe back to the ISS. | `src/App.jsx` |
| Units Changed | User toggles between imperial and metric units. | `src/App.jsx` |
| Location Clicked | User clicks the Learn More link for the place below the ISS. | `src/App.jsx` |
| ISS Data Error Encountered | ISS telemetry feed fails and the app enters an error state. | `src/App.jsx` |

All events include device context: `screen_width`, `screen_height`, `device_pixel_ratio`, `is_mobile`, `user_agent`.

### Key event properties

- **Observer Location Set**: `method` (gps | city_search), `nearest_city`, `location_error` (null | permission_denied | unavailable)
- **Globe Recentred**: `layout` (desktop | mobile)
- **Units Changed**: `units` (imperial | metric)
- **Pass Times Viewed**: `pass_count`, `observer_label`
- **Location Clicked**: `place_name`, `iss_lat`, `iss_lon`
- **ISS Data Error Encountered**: `error_message`

## Analytics dashboard

Charts and dashboard creation are deferred to the `amplitude-wizard dashboard` command, which runs once event ingestion has caught up. Run `amplitude-wizard dashboard` from your project directory after triggering a few events.

## Environment variable configuration

The Amplitude API key is read from `VITE_AMPLITUDE_API_KEY` via Vite's built-in env-var convention (`import.meta.env.VITE_AMPLITUDE_API_KEY`).

- **Local dev**: the key was written to `.env.local` (git-ignored) — no action needed.
- **Production / CI**: add `VITE_AMPLITUDE_API_KEY=<your-amplitude-api-key>` to your deployment platform's environment variables (Vercel → Project Settings → Environment Variables; Netlify → Site settings → Environment variables; other platforms: equivalent location). The key value is in your Amplitude project settings under **Settings → Projects**.

The Amplitude host is `https://api2.amplitude.com` (US data region).

## Next steps

1. Run `pnpm dev` and open the app — you should see events appear in [Amplitude's event stream](https://app.amplitude.com) within ~30 seconds.
2. Open the pass times panel, set a location, and change units to verify the key flows fire.
3. Once you see events ingesting, run `amplitude-wizard dashboard` to auto-generate your starter analytics dashboard.
4. For production, set `VITE_AMPLITUDE_API_KEY` in your deployment platform's environment settings.

### Agent skill

The wizard has left integration skills in `.claude/skills/`. These provide context for further agent-assisted development in Claude Code.

</wizard-report>
