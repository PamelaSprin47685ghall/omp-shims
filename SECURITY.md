# Security policy

omp-shims runs inside the OMP auth-gateway and broker, next to your provider
credentials, so security reports are taken seriously.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/PamelaSprin47685ghall/omp-shims/security/advisories/new)
rather than a public issue. Include what you found, how to reproduce it, and the
version or commit you tested.

## Supported versions

Only the latest release on `main` receives fixes.

## Handling credentials

omp-shims never needs credentials in its code or in systemd units. Accounts and
keys belong in `~/.omp/shims.json`, the environment, or OMP's credential store
(`omp /login`). If you spot a credential committed to this repository, report it
as above so it can be revoked.
