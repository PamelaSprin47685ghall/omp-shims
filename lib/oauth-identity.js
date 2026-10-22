// Stable account identities for plugin OAuth logins.
//
// OMP tells two logins of one provider apart by the identity of the stored
// credential: its `accountId`, else its `email`. A login with the same identity
// replaces the existing row. Some plugins store a placeholder e-mail when the
// account has none (Qoder: "user@qoder.com.cn"), so every login of that
// provider shares one identity and each new login silently overwrites the
// previous account.
//
// For those providers the placeholder is dropped and the provider's own user id
// becomes the `accountId`; a credential without a user id falls back to a
// digest of its first refresh token, which stays put across refreshes because
// a refresh keeps the accountId it was given.

import { createHash } from "node:crypto";

/** provider → the placeholder e-mail its plugin stores for accounts without one. */
export const PLACEHOLDER_EMAILS = Object.freeze({
  "qoder-cn": "user@qoder.com.cn",
  qoder: "user@qoder.com",
});

const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/**
 * The credential with a stable identity, or the credential unchanged when its
 * provider needs no correction.
 * @param {string} provider
 * @param {object} credential an OAuth credential as the plugin returned it
 * @param {object} [previous] the credential being refreshed, if any
 */
export function withStableIdentity(provider, credential, previous) {
  const placeholder = PLACEHOLDER_EMAILS[provider];
  if (!placeholder || !credential || typeof credential !== "object") return credential;
  const { email, ...rest } = credential;
  const realEmail =
    typeof email === "string" && email !== "" && email.toLowerCase() !== placeholder ? email : undefined;
  const accountId =
    rest.accountId ??
    previous?.accountId ??
    (rest.userID ? `${provider}:${rest.userID}` : undefined) ??
    (typeof rest.refresh === "string" && rest.refresh ? `${provider}:refresh-${digest(rest.refresh)}` : undefined);
  return { ...rest, ...(realEmail ? { email: realEmail } : {}), ...(accountId ? { accountId } : {}) };
}

/**
 * An OAuth provider config whose login and refresh results carry a stable identity.
 * @param {string} provider
 * @param {object} oauth the plugin's oauth config ({login, refreshToken, ...})
 */
export function stableIdentityOAuth(provider, oauth) {
  if (!PLACEHOLDER_EMAILS[provider] || !oauth || typeof oauth !== "object") return oauth;
  const wrapped = { ...oauth };
  if (typeof oauth.login === "function") {
    wrapped.login = async (...args) => withStableIdentity(provider, await oauth.login(...args));
  }
  if (typeof oauth.refreshToken === "function") {
    wrapped.refreshToken = async (credential, ...args) =>
      withStableIdentity(provider, await oauth.refreshToken(credential, ...args), credential);
  }
  return wrapped;
}
