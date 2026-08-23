# ENSO Signal API

Pay-per-call live El Niño / La Niña status via the [x402](https://x402.org) protocol, with a computed
sector-impact layer on top of raw NOAA data.

## Endpoint

`GET /enso` — $0.02 per call (configurable via `PRICE_USD`)

Returns:
- `enso_status` — `el_nino` / `la_nina` / `neutral`
- `strength`, `strength_score` (0-100, scaled against the full 1950–present record)
- `trajectory` — strengthening / weakening / steady, plus a 6-season sparkline
- `persistence_empirical` — % of historical seasons in the same status that persisted 1 and 2 seasons later, computed live from the record (not a third-party forecast)
- `historical_analog` — the closest matching historical season and what happened next
- `sector_impacts` — agriculture, supply chain, insurance, and energy risk scores/hotspots synthesized from documented ENSO teleconnection patterns

## Data sources (free, public, no API key)

- NOAA CPC **RONI** (Relative Oceanic Niño Index) — official ENSO index, adopted Feb 2026
- NOAA CPC **ONI** (Oceanic Niño Index) — legacy cross-check, same Niño 3.4 region
- NOAA CPC weekly **sstoi.indices** — most recent weekly Niño-region readings

The raw numbers are free. The computed layer — sector risk scores, empirical persistence odds,
and historical analogs — is what makes this endpoint worth paying for.

## Local development

\`\`\`bash
npm install
cp .env.example .env   # fill in RECEIVER_ADDRESS
NODE_OPTIONS=--experimental-require-module npm start
\`\`\`

`NODE_OPTIONS=--experimental-require-module` is required for `@coinbase/cdp-sdk` (avoids `ERR_REQUIRE_ESM`).

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Set environment variables in the Vercel project settings:
   - `RECEIVER_ADDRESS` — your payout wallet on Base mainnet (must differ from any wallet used to test payments — self-payments are rejected)
   - `PRICE_USD` — e.g. `$0.02`
   - `X402_NETWORK` — `base` for mainnet, `base-sepolia` for testnet
   - `FACILITATOR_URL` — CDP mainnet facilitator URL once you have CDP API keys, otherwise the public facilitator
   - `NODE_OPTIONS` — `--experimental-require-module`
   - `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` — only if using the CDP facilitator
4. After changing env vars, push a trivial commit to force a real rebuild — Vercel's "Redeploy" button can silently reuse a cached build.

## Bazaar listing

Add `discoverable: true` and the `outputSchema` (already included in `server.js`'s route config) so
the endpoint surfaces in the x402 Bazaar. Cross-list on x402scan and other community directories too.
