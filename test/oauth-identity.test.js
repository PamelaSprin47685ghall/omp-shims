import { describe, expect, test } from "bun:test";
import { stableIdentityOAuth, withStableIdentity } from "../lib/oauth-identity.js";

describe("stable OAuth identities", () => {
  test("the Qoder placeholder e-mail gives way to the user id", () => {
    const fixed = withStableIdentity("qoder-cn", {
      access: "a",
      refresh: "r",
      userID: "u-1",
      email: "user@qoder.com.cn",
    });
    expect(fixed).toEqual({ access: "a", refresh: "r", userID: "u-1", accountId: "qoder-cn:u-1" });
  });

  test("two accounts no longer share an identity; a real e-mail is kept", () => {
    const a = withStableIdentity("qoder-cn", { refresh: "r1", userID: "u-1", email: "user@qoder.com.cn" });
    const b = withStableIdentity("qoder-cn", { refresh: "r2", userID: "u-2", email: "real@example.com" });
    expect(a.accountId).not.toBe(b.accountId);
    expect(b.email).toBe("real@example.com");
  });

  test("without a user id the first refresh token decides, and a refresh keeps it", async () => {
    let n = 0;
    const oauth = stableIdentityOAuth("qoder-cn", {
      login: async () => ({ refresh: "first", email: "user@qoder.com.cn" }),
      refreshToken: async () => ({ refresh: `next-${++n}`, email: "user@qoder.com.cn" }),
    });
    const login = await oauth.login();
    expect(login.accountId).toMatch(/^qoder-cn:refresh-[0-9a-f]{24}$/);
    const refreshed = await oauth.refreshToken(login);
    expect(refreshed.accountId).toBe(login.accountId);
    expect("email" in refreshed).toBe(false);
  });

  test("other providers are untouched", () => {
    const credential = { access: "a", email: "user@qoder.com.cn" };
    expect(withStableIdentity("openai-codex", credential)).toBe(credential);
  });
});
