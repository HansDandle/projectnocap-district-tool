# No Cap Calculator

An interactive tool for [Project No Cap](https://www.projectnocap.com) that shows your
U.S. House district — its real boundary and population — and what it would look like under
seven different apportionment rules.

Enter an address or ZIP code to see:

- Your current congressional district (119th Congress) boundary and population.
- How big the House would be, and how many seats your state would get, under each rule:
  **Current Law (435)**, **Wyoming Rule**, **Cube Root Rule**, **Wyoming Rule ÷2**,
  **1910 Average District**, **Global Median** (peer bicameral democracies), and
  **Madison's 1:30,000**.
- A redrawn, compact "what your district could look like" boundary built from real Census
  tracts to hit each rule's target population.

## How it works

- **Frontend:** a single static page (`public/index.html`) using Leaflet for the map and
  Turf.js for geometry.
- **Backend:** two API endpoints that proxy the U.S. Census services (geocoder, TIGERweb
  district + tract geometry). The proxy exists because the Census geocoder sends no CORS
  headers and TIGERweb requires a `Referer` header — neither works from the browser directly.
  The endpoint logic lives in `shared/api.js` and is wrapped by two thin adapters so it runs
  unchanged on both platforms:
  - `src/index.js` — Cloudflare Worker
  - `api/district.js`, `api/tracts.js` — Vercel Edge Functions
- **Apportionment** is computed in-browser with the real **Huntington–Hill** method, which
  reproduces the actual 2020 seat allocation exactly. District population is derived as
  `state population ÷ state seats` (the legal equal-population standard), so no extra
  population API is needed.

### Endpoints

- `GET /api/district?q=<address or ZIP>` → matched address, district id, and boundary GeoJSON.
- `GET /api/tracts?bbox=<minLng,minLat,maxLng,maxLat>&state=<FIPS>` → Census tracts with population.

## Develop

```sh
npm install
npm run dev      # wrangler dev — serves the page + API locally
```

## Deploy

The repo deploys to either platform unchanged.

**Cloudflare Workers**

```sh
npm run deploy   # wrangler deploy — serves page + API on one Worker
```

**Vercel**

Import the repo in Vercel (no build step needed). `vercel.json` serves `public/` as the
static site and Vercel turns `api/*.js` into Edge Functions automatically. Or from the CLI:

```sh
vercel        # preview
vercel --prod # production
```

## Data sources

- U.S. Census Bureau Geocoder (address → coordinates)
- U.S. Census TIGERweb (119th Congress district + 2020 tract geometry, with `POP100`)
- 2020 Census apportionment populations (bundled)
- Zippopotam.us (ZIP centroid fallback)

Population/apportionment data reflect the 2020 Census. Drawn districts are illustrative —
contiguous, compact, population-balanced, and within-state — not official maps.
