// Opt-in bypass for OMP's paused `google-antigravity` provider.
//
// OMP 18.18.6 added a catalog `disabled` rule for Google Antigravity:
//
//   "Google may restrict accounts that use Antigravity outside its own apps,
//    so this provider is paused for now."
//
// That rule hides the provider from every login list, makes `assertProviderEnabled`
// reject it, and refuses every credential source. The code and the stored
// credentials are still present. This preload re-enables the provider without
// touching the OMP build:
//
//   BUN_OPTIONS="--preload /path/to/this/file.mjs" omp login google-antigravity
//
// It works by removing the catalog's `disabled` flag and registering the
// provider's own built-in OAuth definition as a runtime (custom) provider.
// OMP's gate treats a runtime provider as enabled, so stored credentials,
// `/login`, model discovery, and `omp token` work again.
//
// RISK: OMP paused this provider because Google has restricted accounts that
// use Antigravity outside Google's own apps. Re-enabling it can get an account
// banned. `index.mjs` imports this file, so the plugin entry always unpauses;
// the service units add it to BUN_OPTIONS only when
// OMP_SHIMS_ANTIGRAVITY_UNPAUSE is true. `omp-shims antigravity-login` and
// `omp-shims antigravity-env` set the same preload for terminal commands.

import { readdirSync } from "node:fs";

const PROVIDER = "google-antigravity";
const CHUNKS_DIR = "/$bunfs/root/chunks";
const SOURCE_ID = "omp-shims:antigravity-unpause";

/**
 * Build the `apiKey` the Google transport expects.
 *
 * A runtime (custom) OAuth provider without `getApiKey` falls back to the bare
 * access token in `tryOAuth`, and the Google transport then rejects it as
 * "Invalid Google Cloud Code Assist credentials". The built-in provider path
 * builds this JSON from `apiKeyFormat: "structured"`; do the same here.
 */
function structuredApiKey(core, credential) {
  if (core.Jl?.(PROVIDER)?.apiKeyFormat !== "structured") return credential.access;
  return JSON.stringify({
    apiEndpoint: credential.apiEndpoint,
    token: credential.access,
    enterpriseUrl: credential.enterpriseUrl,
    projectId: credential.projectId,
    refreshToken: credential.refresh,
    expiresAt: credential.expires,
    email: credential.email,
    accountId: credential.accountId,
  });
}

/** Load the bundled auth core. The symbols are minified, so accept the whole set. */
async function loadBundledCore() {
  let names;
  try {
    names = readdirSync(CHUNKS_DIR).filter((name) => name.endsWith(".js"));
  } catch {
    return undefined;
  }
  for (const name of names) {
    try {
      const module = await import(`${CHUNKS_DIR}/${name}`);
      if (
        typeof module.$de === "function" &&
        typeof module.Cl === "function" &&
        typeof module.iRe === "function" &&
        typeof module.uB === "function" &&
        typeof module.Yi === "function"
      ) {
        return module;
      }
    } catch {}
  }
  return undefined;
}

/** Load the source-tree packages when this preload runs outside a compiled omp. */
async function loadSourceCore() {
  try {
    const [oauth, catalog] = await Promise.all([import("@oh-my-pi/pi-ai"), import("@oh-my-pi/pi-catalog/compat/auth")]);
    if (typeof oauth.registerOAuthProvider !== "function" || typeof oauth.getProviderDefinition !== "function") {
      return undefined;
    }
    return {
      $de: oauth.registerOAuthProvider.bind(oauth),
      Cl: oauth.getProviderDefinition.bind(oauth),
      uB: oauth.getOAuthProvider?.bind(oauth),
      Yi: oauth.getOAuthProviders.bind(oauth),
      iRe: catalog.authProviders.bind(catalog),
    };
  } catch {
    return undefined;
  }
}

const core = (await loadBundledCore()) ?? (await loadSourceCore());

if (!core) {
  console.error("[omp-shims] antigravity-unpause: no OMP auth core found; leaving the provider paused");
} else {
  const entry = core.iRe().find((provider) => provider?.id === PROVIDER);
  if (!entry) {
    console.error(`[omp-shims] antigravity-unpause: OMP has no ${PROVIDER} auth entry; nothing to do`);
  } else {
    const alreadyRegistered = typeof core.uB === "function" && Boolean(core.uB(PROVIDER));
    // The catalog flag is read by the model-list path; the runtime registration
    // is what `assertProviderEnabled` checks.
    delete entry.disabled;

    if (alreadyRegistered) {
      console.error(`[omp-shims] antigravity-unpause: ${PROVIDER} is already registered`);
    } else {
      const definition = core.Cl(PROVIDER);
      if (!definition?.login) {
        console.error(`[omp-shims] antigravity-unpause: ${PROVIDER} has no built-in login definition`);
      } else {
        // Keep the catalog policy on the runtime provider. OMP's Google
        // transport needs `apiKeyFormat: "structured"` to receive the token and
        // project as one JSON document; a bare token fails with "Invalid Google
        // Cloud Code Assist credentials".
        const policy = core.Jl?.(PROVIDER) ?? {};
        core.$de({
          ...policy,
          ...definition,
          id: PROVIDER,
          sourceId: SOURCE_ID,
          getApiKey: (credential) => structuredApiKey(core, credential),
        });
        console.error(
          `[omp-shims] antigravity-unpause: ${PROVIDER} re-enabled. ` +
            "Google may restrict accounts that use Antigravity outside its own apps; use at your own risk.",
        );
      }
    }
  }
}
