# Contributing to omp-shims

Thanks for helping. omp-shims is small on purpose: each fix is one independent,
switchable feature, and the shared plumbing stays minimal. Please keep changes in
that spirit.

## Setup

You need [Bun](https://bun.sh) 1.2 or newer.

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git
cd omp-shims
bun install
```

## Checks

Run these before opening a pull request; CI runs the same ones.

```sh
bun run check    # Biome lint + format check
bun test         # test suite
```

`bun run format` applies formatting. The tests never touch your real `~/.omp`:
`test/setup.js` points the config at a temporary directory and clears every
`OMP_SHIMS_*` variable.

## Ground rules

- **Never break traffic.** A shim that fails must fall back to passing the
  request through untouched. Catch errors at the boundary and log them.
- **Diagnostics go to stderr**, never stdout: several omp subcommands parse stdout.
  Use `context.log` (shown with `OMP_SHIMS_VERBOSE=1`) for routine messages.
- **Public OMP surface only.** Hook documented exports and methods, never minified
  identifiers, so an OMP upgrade does not break the shims.
- **No credentials or personal data in the code.** Accounts, keys and tokens come
  from `~/.omp/shims.json`, the environment, or OMP's own credential store.
- **Keep features independent.** A feature must work, or cleanly do nothing,
  whatever else is enabled.

## Adding a feature

1. Create `features/<name>.js` exporting `install(config, context)`. `config` is
   the resolved feature entry; `context` provides `log`, `addFetchHandler`,
   `preserveResponseUrl` and `extraHosts`. Take `addFetchHandler` from the
   context so the feature can be tested in isolation.
2. Register it in `lib/config.js`: a `FEATURES` entry (summary and `OMP_SHIMS_*`
   toggle) and a `DEFAULTS` entry.
3. Add it to the load order in `lib/bootstrap.js`. For a fetch layer, the
   position matters: read the comment at the top of `lib/fetch-chain.js`.
4. Add tests under `test/` (see `test/helpers.js` for a fake context and fake
   upstream responses).
5. Document it in the README feature and configuration tables, and add a
   CHANGELOG entry.

## Commits and pull requests

- Keep each pull request focused, and each commit a logical step with a message
  that explains *why*. [Conventional Commits](https://www.conventionalcommits.org)
  prefixes (`fix:`, `feat:`, `docs:`, ...) are appreciated.
- Add an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md) for anything a
  user would notice.
- Call out any behaviour change in the pull request description.

## Reporting security issues

Please do not open a public issue for a vulnerability or a leaked credential;
see [SECURITY.md](SECURITY.md).
