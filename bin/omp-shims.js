#!/usr/bin/env bun

// omp-shims control CLI.
//
//   omp-shims status              show every feature and its current state
//   omp-shims enable <feature>    turn a feature on
//   omp-shims disable <feature>   turn a feature off
//   omp-shims env                 print the environment a service unit needs
//   omp-shims systemd <unit>      print a ready-to-install unit file
//   omp-shims add-account <provider> <plugin-package>
//                                 log in with a token read from stdin, as a new account
//   omp-shims repair-identities <provider>
//                                 give accounts stored with a placeholder e-mail their own identity
//
// Toggles are written to ~/.omp/shims.json (override with OMP_SHIMS_CONFIG).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loginWithToken, pluginOAuth, repairIdentities, upsertCredential } from "../lib/account-import.js";
import { CONFIG_PATH, describeConfig, FEATURES, loadConfig, writeConfig } from "../lib/config.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const preloadEntry = join(packageRoot, "preload.js");
const captureEntry = join(packageRoot, "registry-capture.js");
const antigravityPreloadEntry = join(packageRoot, "antigravity-unpause.js");
const ompBin = process.env.OMP_BIN ?? join(homedir(), ".local", "bin", "omp");

/** True when the service units should load the opt-in Antigravity unpause preload. */
function antigravityUnpauseEnabled() {
  const value = (process.env.OMP_SHIMS_ANTIGRAVITY_UNPAUSE ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** The BUN_OPTIONS value for a service unit. */
function shimsBunOptions() {
  const entries = [captureEntry];
  if (antigravityUnpauseEnabled()) entries.push(antigravityPreloadEntry);
  entries.push(preloadEntry);
  for (const entry of entries) {
    if (/\s/.test(entry)) {
      fail(`the install path contains whitespace (${entry}); BUN_OPTIONS cannot quote a preload path`);
    }
  }
  return entries.map((entry) => `--preload ${entry}`).join(" ");
}

function usage() {
  console.log(`omp-shims

  status                list features and their state
  enable <feature>      enable a feature
  disable <feature>     disable a feature
  env                   environment exports for a service unit
  systemd <unit>        print a unit file (omp-auth-gateway|omp-auth-broker)
  add-account <provider> <plugin-package>
                        log in with a token read from stdin (never echoed) and
                        store it as its own account in agent.db
  antigravity-login     run "omp login google-antigravity" with the unpause preload
  antigravity-env       print the BUN_OPTIONS preload that re-enables google-antigravity
  repair-identities <provider>
                        give accounts stored with a placeholder e-mail their own identity
  help                  this text

config: ${CONFIG_PATH}`);
}

function fail(message) {
  console.error(`omp-shims: ${message}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const ompDir = join(homedir(), ".omp");
const agentDb = process.env.OMP_AGENT_DB ?? join(ompDir, "agent", "agent.db");

/** Add the unpause preload to BUN_OPTIONS without dropping the caller's value. */
function antigravityBunOptions() {
  if (/\s/.test(antigravityPreloadEntry)) {
    fail(`the install path contains whitespace (${antigravityPreloadEntry}); BUN_OPTIONS cannot quote a preload path`);
  }
  const existing = process.env.BUN_OPTIONS?.trim() ?? "";
  if (existing.includes(antigravityPreloadEntry)) return existing;
  return [existing, `--preload ${antigravityPreloadEntry}`].filter(Boolean).join(" ");
}

switch (command) {
  case "status": {
    const config = loadConfig();
    console.log(`config: ${CONFIG_PATH}\n`);
    for (const line of describeConfig(config)) console.log(line);
    const unknown = Object.keys(config.features).filter((name) => !(name in FEATURES));
    if (unknown.length > 0) console.log(`\nunknown in config: ${unknown.join(", ")}`);
    break;
  }

  case "enable":
  case "disable": {
    const name = rest[0];
    if (!name) fail(`usage: omp-shims ${command} <feature>`);
    if (!(name in FEATURES)) {
      fail(`unknown feature "${name}". Known: ${Object.keys(FEATURES).join(", ")}`);
    }
    writeConfig({ [name]: { enabled: command === "enable" } });
    console.log(`${name} ${command}d in ${CONFIG_PATH} (restart omp / the service to apply)`);
    break;
  }

  case "env": {
    console.log(`Environment="BUN_OPTIONS=${shimsBunOptions()}"`);
    break;
  }

  case "systemd": {
    const unit = rest[0] ?? "omp-auth-gateway";
    const template = join(packageRoot, "systemd", `${unit}.service`);
    let text;
    try {
      text = readFileSync(template, "utf8");
    } catch (error) {
      fail(`no template for "${unit}" (${error.message})`);
    }
    // Fill in the paths that differ per machine, so the unit can be installed
    // as-is on any host and user account.
    const home = homedir();
    console.log(
      text
        .replaceAll("@SHIMS_PRELOAD@", `Environment="BUN_OPTIONS=${shimsBunOptions()}"`)
        .replaceAll("@OMP_BIN@", join(home, ".local", "bin", "omp"))
        .replaceAll("HOME=/root", `HOME=${home}`)
        .replaceAll("WorkingDirectory=/root", `WorkingDirectory=${home}`)
        .replaceAll("/root/.local/bin", join(home, ".local", "bin"))
        .replaceAll("User=root", `User=${process.env.SUDO_USER ?? process.env.USER ?? "root"}`)
        .trimEnd(),
    );
    break;
  }

  case "add-account": {
    const [provider, packageName] = rest;
    if (!provider || !packageName) fail("usage: omp-shims add-account <provider> <plugin-package>  (token on stdin)");
    const token = (await Bun.stdin.text()).trim();
    if (!token) fail("no token on stdin");
    const oauth = await pluginOAuth(join(ompDir, "plugins"), packageName, provider);
    const credential = await loginWithToken(oauth, token);
    const { id, created } = upsertCredential(agentDb, provider, credential);
    console.log(`${provider}: ${created ? "added" : "updated"} account row ${id} (${credential.accountId})`);
    break;
  }

  case "antigravity-env": {
    console.log(`BUN_OPTIONS="${antigravityBunOptions()}"`);
    break;
  }

  case "antigravity-login": {
    console.error(
      "omp-shims: WARNING: Google may restrict accounts that use Antigravity outside its own apps; " +
        "re-enabling this provider can get the account banned.",
    );
    const env = { ...process.env, BUN_OPTIONS: antigravityBunOptions() };
    // A parent running this CLI through `BUN_BE_BUN=1 omp` must not make the
    // child `omp` behave like Bun and treat "login" as a script path.
    delete env.BUN_BE_BUN;
    const child = Bun.spawn([ompBin, "login", "google-antigravity"], {
      stdio: ["inherit", "inherit", "inherit"],
      env,
    });
    process.exit(await child.exited);
  }

  case "repair-identities": {
    const provider = rest[0];
    if (!provider) fail("usage: omp-shims repair-identities <provider>");
    const changed = repairIdentities(agentDb, provider);
    for (const { id, identity } of changed) console.log(`${provider}: row ${id} -> ${identity}`);
    if (changed.length === 0) console.log(`${provider}: nothing to repair`);
    break;
  }

  case "help":
  case undefined:
    usage();
    break;

  default:
    usage();
    process.exit(1);
}
