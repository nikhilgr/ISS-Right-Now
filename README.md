# ISS Right Now

Live position and pass-time viewer for the International Space Station.

## Local Development

Use pnpm for all Node dependency work.

```bash
pnpm install
pnpm run dev
```

Then open the local URL printed by Vite.

## Checks

```bash
pnpm run test
pnpm run build
pnpm run preview
```

## Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages with:

- Framework preset: `Vite`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm run build`
- Output directory: `dist`

The app is fully static. Live data is fetched in the browser from public ISS endpoints.
