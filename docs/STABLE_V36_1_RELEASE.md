# FairyCodex V36.1 — Stable rollback release

This package restores the preserved V36.1 build. V37/V38 equipment experiments are archived in the GitHub repository rather than mixed into the stable release.

## What changed

- Restored the V36.1 `index.html` byte-for-byte from the existing `releases/v36_1_before_gear.html` GitHub archive.
- Reset the `VERSION` file on GitHub main to `V36.1`.
- Added a reproducible offline smoke test for the eight navigation tabs at 390, 768 and 1440px.
- No Cloudflare Worker, new gear catalog, or new dependencies were introduced to this stable application.

## Running

Open `index.html` in a browser or deploy it on GitHub Pages. For live-market requests, serve over HTTPS from the production origin. Browser localStorage is origin-specific; exporting your existing data before switching origins is advisable.

## Fast regression check

With Python Playwright and Chromium installed, run `python smoke_test.py`. This tests UI availability, clicking all eight tabs, startup JavaScript exceptions and horizontal layout overflow at three viewport widths, with external requests intentionally blocked. Network-backed features are **not** certified by this offline test.

## Unverified production checks

Before calling this fully production-hardened, manually test live Arsha data, imported/exported storage state, market alerts, permissions and browser notification behavior on the deployed GitHub Pages origin. V36.1 may still have market connectivity or data accuracy limitations. Automated UI smoke tests do not certify all calculations or security concerns.

## Rollback archives

- `releases/v36_1_before_gear.html` — exact stable baseline
- `releases/v37_before_equipment_database.html` — V37
- `releases/v38_before_rollback.html` — V38

Do not overwrite these archived releases. Continue new experiments on a separate branch with a test gate before promoting to main.