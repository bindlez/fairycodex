# FairyCodex Velocity — Phase 0 + Phase 1 (opt-in prototype)

**No production site is switched over.** This project is isolated from both published applications. The existing `bindlez/fairycodex` main branch, VersionBox and the supplied Central Market HTML remain unchanged. The prototype has **not** been deployed to Cloudflare.

## What exists

- `src/worker.js`: shared, read-only, versioned Arsha market API using the same `/v2/{region}/hot` and `/v2/{region}/GetWorldMarketList?mainCategory={id}` endpoints found in the supplied Central Market website.
- `GET /v1/health`: lightweight health response (does **not** prove Arsha connectivity).
- `GET /v1/market/{na|eu}/hot` and `/v1/market/{na|eu}/items?category=35`.
- Normalized item ID, name, price, stock, trades, and timestamps; errors are explicit rather than fake zero prices.
- Edge fresh cache (default 45 seconds) and stale cache (default 300 seconds). When fresh has expired but stale remains, return stale immediately and request background refresh via `ctx.waitUntil()`. During an outage, retain recently cached observations. In-isolate cold-request deduplication prevents concurrent fetch storms.
- Restricted browser CORS origins, input allowlists, no user-defined proxy targets, read-only routes, upstream timeout (4.5s), response-size checks.
- `examples/market-client.js`: separate opt-in client adapter; nothing wired into the public sites.
- `test/worker.test.mjs`: deterministic tests with mock Arsha and mock Cache API.
- `bench/worker-benchmark.mjs` and `bench/browser-baseline.py`: reproducible Phase 0 local experiments.

## Quick start

```bash
npm install
npm test
npm run bench
npx wrangler dev
```

After connecting a Cloudflare account with your own authorization:

```bash
npx wrangler login
npx wrangler deploy
```

**Do not deploy and switch both frontends simultaneously.** First test the Worker URL manually, check live NA and EU responses in your own browser, inspect CORS and quotas, then opt in only one frontend behind a feature toggle. Keep direct Arsha behavior as rollback.

## Known limitations

- No Cloudflare deployment or actual Arsha connectivity has been verified here.
- The Cache API is **data-center local**, not a global durable database; entries may evict and stale data is bounded by TTL. Cross-region durable resilience will need an optional D1/KV-backed last-good snapshot with an explicit retention policy. Avoid treating stale data as live.
- The Worker returns `Cache-Control: no-store` to browser callers to retain control of freshness. A production browser-side IndexedDB snapshot can provide an offline fallback, but it is not connected in this phase.
- Cached responses and timestamps are accurate only to the best upstream observation. Arsha itself is not an official live guarantee.
- There is no credentials/authentication or writable endpoint in Phase 1. Origin allowlists protect browser use but do not authenticate non-browser clients; production rate limiting should be added if abuse occurs.
- Unit tests and synthetic Node benchmark do not represent deployed p95 latency.

## Phase 0 performance comparison

See `bench/baseline_results.json`. Both apps are local HTML snapshots; the run uses Playwright `page.set_content` with external fetches blocked. It measures only local markup/JS initialization and excludes HTTP transfer, caching, round-trip latency and real-user devices. Treat it as a regression baseline **not** a real cold-start Core Web Vitals score.

## Recommended go-live sequence

1. Publish this source to an isolated `velocity/phase-0-1` branch.
2. Deploy Worker after explicit Cloudflare login by the owner; use the generated `workers.dev` URL.
3. Verify real Arsha and CORS from `https://bindlez.github.io` and test stale behavior during an outage.
4. Add a feature flag to *one* frontend, compare telemetry and rollback promptly if errors spike.
5. Only then migrate the other frontend; do not touch archived VersionBox builds.