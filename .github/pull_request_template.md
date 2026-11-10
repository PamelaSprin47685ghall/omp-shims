## What and why

<!-- What does this change, and what problem does it solve? -->

## Feature and contract

- Feature(s) touched:
- Install phase (`edge` / `outbound` / `process` / `background` / none):
- New or changed `FEATURE_CATALOG` defaults:
- Config keys a user must set:

## Behaviour changes

<!-- Anything a user would notice: defaults, config keys, CLI output, state files. "None" is fine. -->

## Checklist

- [ ] `bun run ci` passes (Biome + `bun test`)
- [ ] Tests cover the enabled and disabled paths
- [ ] The feature uses the shared inbound/outbound/SSE pipelines; no new `Bun.serve` or `globalThis.fetch` wrapper
- [ ] `FEATURE_CATALOG`, README, and CHANGELOG are updated
- [ ] Migration is handled when a v1 key changes or disappears
- [ ] No new per-feature environment variable was added (v2 has a fixed allow-list)
- [ ] No credentials, account addresses, tokens, or other personal data in the diff
