#!/usr/bin/env bun

// omp-shims control CLI.
//
// Every command reads the same resolved configuration as the runtime:
//   defaults -> ~/.omp/shims.json -> OMP_SHIMS_<FEATURE>
//
// Diagnostics go to stderr. stdout carries data only, because scripts parse it.

import { Database } from "bun:sqlite";
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_PATH,
  FEATURE_CATALOG,
  FEATURE_ENV_VARS,
  listLegacyShimEnvVars,
  loadConfig,
  readRawConfig,
  validateConfig,
  writeConfig,
} from "../lib/config.mjs";
import { VERSION } from "../lib/contracts.mjs";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CAPTURE_ENTRY = join(PACKAGE_ROOT, "registry-capture.mjs");
const PRELOAD_ENTRY = join(PACKAGE_ROOT, "preload.mjs");
const ANTIGRAVITY_UNPAUSE_ENTRY = join(PACKAGE_ROOT, "antigravity-unpause.mjs");
const TARGET_USER = targetUser();
const TARGET_HOME = homeOf(TARGET_USER);
const OMP_DIR = join(TARGET_HOME, ".omp");
const AGENT_DB = process.env.OMP_AGENT_DB ?? join(OMP_DIR, "agent", "agent.db");
const STATE_DB_NAME = "omp-shims-state.sqlite";

/** A command error with an exit code. */
class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/** Feature settings that accept free-form keys. Keep in sync with lib/config.mjs. */
const OPEN_MAP_SETTINGS = {
  "lazy-router": new Set(["providerHeaderTimeoutMs", "upstreamHosts", "maxInFlight", "testFaults"]),
  "cline-pin-upstream": new Set(["modelChannels"]),
};

/** True for a JSON object (not null, not an array). */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The configured state database, relative to the home directory by default. */
function stateDbPath(config) {
  const configured = config?.stateDbPath;
  return typeof configured === "string" && configured !== "" ? configured : join(OMP_DIR, STATE_DB_NAME);
}

/** The user that should run the service units. */
function targetUser() {
  return process.env.OMP_USER ?? process.env.SUDO_USER ?? process.env.USER ?? userInfo().username;
}

/** The home directory of one account. */
function homeOf(user) {
  if (!user || user === userInfo().username) return homedir();
  if (user === process.env.USER && process.env.HOME) return process.env.HOME;
  if (user === "root") return "/root";

  const getent = Bun.spawnSync(["getent", "passwd", user], { stdout: "pipe", stderr: "ignore" });
  if (getent.exitCode === 0) {
    const home = getent.stdout.toString().trim().split(":")[5];
    if (home) return home;
  }
  const dscl = Bun.spawnSync(["dscl", ".", "-read", `/Users/${user}`, "NFSHomeDirectory"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (dscl.exitCode === 0) {
    const match = dscl.stdout.toString().match(/NFSHomeDirectory:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return join("/home", user);
}

/** The omp executable for the current account. */
function ompBinary(home) {
  return process.env.OMP_BIN ?? join(home, ".local", "bin", "omp");
}

/** Quote one systemd word only when it needs quoting. */
function systemdWord(value) {
  if (/^[\w@%+=:,./~-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The live preload assignment for one service unit. */
function preloadLine() {
  const entries = [CAPTURE_ENTRY];
  const unpause = (process.env.OMP_SHIMS_ANTIGRAVITY_UNPAUSE ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(unpause)) entries.push(ANTIGRAVITY_UNPAUSE_ENTRY);
  entries.push(PRELOAD_ENTRY);
  for (const path of entries) {
    if (/\s/.test(path)) {
      throw new CliError(
        `the install path contains whitespace (${path}); BUN_OPTIONS cannot quote a preload path. ` +
          "Move omp-shims to a path without spaces.",
      );
    }
  }
  return `Environment="BUN_OPTIONS=${entries.map((entry) => `--preload ${entry}`).join(" ")}"`;
}

/** Replace every unit placeholder with a computed value. */
function fillUnit(template, unit) {
  const home = TARGET_HOME;
  const binary = ompBinary(home);
  const values = {
    "@OMP_USER@": TARGET_USER,
    "@OMP_HOME@": systemdWord(home),
    "@OMP_BIN_DIR@": systemdWord(dirname(binary)),
    "@OMP_BIN@": systemdWord(binary),
    "@SHIMS_PRELOAD@": preloadLine(),
  };
  return template.replace(/@[A-Z_]+@/g, (placeholder) => {
    if (!Object.hasOwn(values, placeholder)) {
      throw new CliError(`unit ${unit} contains an unknown placeholder ${placeholder}`);
    }
    return values[placeholder];
  });
}

/** Feature state and its source: default, config, or env. */
function featureStatus(config) {
  const status = {};
  for (const name of Object.keys(FEATURE_CATALOG)) {
    const source = config.sources?.[name] ?? "default";
    status[name] = {
      enabled: Boolean(config.features[name]?.enabled),
      source: source === "file" ? "config" : source,
      summary: FEATURE_CATALOG[name].summary,
    };
  }
  return status;
}

/** Every OMP_SHIMS_* variable that v2 does not read. */
function ignoredEnv() {
  return listLegacyShimEnvVars(process.env);
}

/** Dotted paths of keys in the raw file that v2 does not define. */
function unknownKeys(raw) {
  if (!isPlainObject(raw)) return [];
  const unknown = [];
  for (const key of Object.keys(raw)) {
    if (!["version", "stateDbPath", "runtime", "features", "pluginBridge"].includes(key)) unknown.push(key);
  }
  if (isPlainObject(raw.runtime)) {
    for (const key of Object.keys(raw.runtime)) if (key !== "thinkingLoopGuard") unknown.push(`runtime.${key}`);
  }
  if (isPlainObject(raw.pluginBridge)) {
    for (const key of Object.keys(raw.pluginBridge)) if (key !== "tokens") unknown.push(`pluginBridge.${key}`);
  }
  if (isPlainObject(raw.features)) {
    for (const [name, entry] of Object.entries(raw.features)) {
      if (!Object.hasOwn(FEATURE_CATALOG, name)) {
        unknown.push(`features.${name}`);
        continue;
      }
      if (isPlainObject(entry)) {
        collectUnknownSettings(entry, FEATURE_CATALOG[name].defaults, `features.${name}`, name, [], unknown);
      }
    }
  }
  return unknown.sort();
}

/** Collect setting keys missing from the defaults, recursively. */
function collectUnknownSettings(value, defaults, path, feature, segments, unknown) {
  const openMaps = OPEN_MAP_SETTINGS[feature] ?? new Set();
  for (const [key, item] of Object.entries(value)) {
    if (segments.length === 0 && openMaps.has(key)) continue;
    if (!isPlainObject(defaults) || !Object.hasOwn(defaults, key)) {
      unknown.push(`${path}.${key}`);
      continue;
    }
    if (isPlainObject(item) && isPlainObject(defaults[key])) {
      collectUnknownSettings(item, defaults[key], `${path}.${key}`, feature, [...segments, key], unknown);
    }
  }
}

/** Read the raw file, or undefined when it is absent. */
function readRawOrUndefined() {
  if (!existsSync(CONFIG_PATH)) return undefined;
  return readRawConfig(CONFIG_PATH);
}

/** A file mode as four octal digits. */
function modeText(path) {
  return (statSync(path).mode & 0o777).toString(8).padStart(4, "0");
}

/** Print one ignored-legacy-env line per variable. */
function reportIgnoredEnv() {
  for (const name of ignoredEnv()) {
    console.error(`ignored legacy env: ${name} (v2 does not read it; move the setting into ${CONFIG_PATH})`);
  }
}

function usage() {
  console.log(`omp-shims ${VERSION}

  status [--json]        show every feature, its state and its source
  doctor                 check the config, its permissions, the state DB and host exports
  enable <feature>       enable a feature in the config file
  disable <feature>      disable a feature in the config file
  env                    print the systemd preload line
  systemd [unit]         print a unit file
                         (omp-auth-gateway, omp-auth-gateway@, omp-auth-broker)
  add-account <provider> <plugin-package>
                         read a token from stdin without echo and add it as an account
  antigravity-login      run "omp login google-antigravity" with the unpause preload
  antigravity-env        print the BUN_OPTIONS preload that re-enables google-antigravity
  repair-identities <provider>
                         give accounts with a placeholder identity their own identity
  uninstall [--dry-run|--clean] [--yes]
                         list generated state, or remove it after --clean --yes
  help                   this text
  --version, -v          print the version

config: ${CONFIG_PATH}`);
}

/** status [-—json] */
function commandStatus(args) {
  const json = args.includes("--json");
  for (const flag of args) {
    if (flag !== "--json") throw new CliError(`unknown option "${flag}" (usage: omp-shims status [--json])`, 2);
  }

  const raw = readRawOrUndefined();
  const unknown = unknownKeys(raw ?? {});
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify(
          {
            name: "omp-shims",
            version: VERSION,
            configPath: CONFIG_PATH,
            configExists: raw !== undefined,
            error: error.message,
            ignoredEnv: ignoredEnv(),
            unknownKeys: unknown,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`omp-shims: ${error.message}`);
      if (unknown.length > 0) {
        console.log("\nunknown keys in the config file:");
        for (const key of unknown) console.log(`  ${key}`);
      }
      reportIgnoredEnv();
    }
    return 1;
  }
  const features = featureStatus(config);

  if (json) {
    console.log(
      JSON.stringify(
        {
          name: "omp-shims",
          version: VERSION,
          configPath: CONFIG_PATH,
          configExists: raw !== undefined,
          configMode: raw === undefined ? null : modeText(CONFIG_PATH),
          runtime: config.runtime,
          features,
          ignoredEnv: ignoredEnv(),
          unknownKeys: unknown,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`omp-shims ${VERSION}`);
  if (raw === undefined) console.log(`config: ${CONFIG_PATH} (absent; defaults apply)`);
  else console.log(`config: ${CONFIG_PATH} (${modeText(CONFIG_PATH)})`);
  console.log(`state:  ${stateDbPath(config)}\n`);

  for (const [name, entry] of Object.entries(features)) {
    const state = entry.enabled ? "on " : "off";
    console.log(`${state}  ${name.padEnd(22)} [${entry.source}]  ${entry.summary}`.trimEnd());
  }

  if (unknown.length > 0) {
    console.log("\nunknown keys in the config file:");
    for (const key of unknown) console.log(`  ${key}`);
  }
  reportIgnoredEnv();
  return 0;
}

/** One doctor check. A thrown error is a FAIL with its message. */
function runCheck(label, check) {
  try {
    const detail = check();
    console.log(`PASS  ${label}${detail ? `: ${detail}` : ""}`);
    return true;
  } catch (error) {
    console.log(`FAIL  ${label}: ${error.message}`);
    return false;
  }
}

/** doctor */
function commandDoctor() {
  let ok = true;
  const raw = readRawOrUndefined();

  ok =
    runCheck("config readable", () => {
      if (raw === undefined) return "absent; defaults apply";
      readFileSync(CONFIG_PATH, "utf8");
      return CONFIG_PATH;
    }) && ok;

  ok =
    runCheck("config permissions", () => {
      if (raw === undefined) return "absent";
      const mode = modeText(CONFIG_PATH);
      if ((statSync(CONFIG_PATH).mode & 0o077) !== 0) {
        throw new Error(`mode ${mode}; expected 0600`);
      }
      return `${mode} (owner only)`;
    }) && ok;

  let config;
  ok =
    runCheck("config schema", () => {
      config = validateConfig(raw ?? {}, { path: CONFIG_PATH });
      return `version 2, ${Object.keys(config.features).length} features`;
    }) && ok;

  const dbPath = stateDbPath(config);
  ok =
    runCheck("state database", () => {
      if (!existsSync(dbPath)) return `${dbPath} (absent; the gateway creates it)`;
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.query("PRAGMA quick_check").all();
        const verdict = rows.map((row) => Object.values(row)[0]).join(", ");
        if (verdict !== "ok") throw new Error(`${dbPath}: ${verdict}`);
        const version = db.query("PRAGMA user_version").get()?.user_version;
        if (version !== 2) throw new Error(`${dbPath}: user_version ${version}, expected 2`);
        return `${dbPath} (ok, user_version 2)`;
      } finally {
        db.close();
      }
    }) && ok;

  ok =
    runCheck("host exports", () => {
      const host = globalThis.__OMP_SHIMS_HOST__;
      if (host && typeof host === "object") return "globalThis.__OMP_SHIMS_HOST__ is present";
      if (process.argv.some((arg) => arg === "auth-gateway" || arg === "auth-broker")) {
        throw new Error("globalThis.__OMP_SHIMS_HOST__ is missing; start the process through preload.mjs");
      }
      return "not installed in this standalone process (PASS; required only under preload)";
    }) && ok;

  reportIgnoredEnv();
  return ok ? 0 : 1;
}

/** enable|disable <feature> */
function commandToggle(command, args) {
  const name = args[0];
  if (!name) throw new CliError(`usage: omp-shims ${command} <feature>`, 2);
  if (!Object.hasOwn(FEATURE_CATALOG, name)) {
    throw new CliError(`unknown feature "${name}". Known: ${Object.keys(FEATURE_CATALOG).join(", ")}`);
  }
  if (args.length > 1) throw new CliError(`usage: omp-shims ${command} <feature>`, 2);

  writeConfig({ [name]: { enabled: command === "enable" } });
  console.log(`${name} ${command}d in ${CONFIG_PATH} (restart omp or the service to apply)`);

  const config = loadConfig();
  if (config.sources?.[name] === "env") {
    console.error(
      `warning: ${FEATURE_ENV_VARS[name]} is set and overrides the file; unset it for this change to take effect.`,
    );
  }
  return 0;
}

/** env */
function commandEnv(args) {
  if (args.length > 0) throw new CliError("usage: omp-shims env", 2);
  console.log(preloadLine());
  return 0;
}

/** systemd [unit] */
function commandSystemd(args) {
  if (args.length > 1) throw new CliError("usage: omp-shims systemd [unit]", 2);
  const requested = (args[0] ?? "omp-auth-gateway").replace(/\.service$/, "");
  const known = new Set(["omp-auth-gateway", "omp-auth-gateway@", "omp-auth-broker"]);
  if (!known.has(requested)) {
    throw new CliError(`no template for "${requested}". Known: ${[...known].join(", ")}`);
  }
  const template = readFileSync(join(PACKAGE_ROOT, "systemd", `${requested}.service`), "utf8");
  console.log(fillUnit(template, requested).trimEnd());
  return 0;
}

/** Read one line from a TTY without echo. */
async function readSecretToken() {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).trim();

  const saved = Bun.spawnSync(["stty", "-g"], { stdio: ["inherit", "pipe", "inherit"] });
  const settings = saved.exitCode === 0 ? saved.stdout.toString().trim() : "";
  process.stderr.write("token: ");
  try {
    Bun.spawnSync(["stty", "-echo"], { stdio: ["inherit", "inherit", "inherit"] });
    const reader = Bun.stdin.stream().getReader();
    const decoder = new TextDecoder();
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes("\n")) break;
      }
    } finally {
      reader.releaseLock();
    }
    return text.split("\n")[0].trim();
  } finally {
    const restore = settings === "" ? ["stty", "echo"] : ["stty", settings];
    Bun.spawnSync(restore, { stdio: ["inherit", "inherit", "inherit"] });
    process.stderr.write("\n");
  }
}

/** Copy agent.db and its WAL sidecars before a write. Return the backup path. */
function backupAgentDb() {
  if (!existsSync(AGENT_DB)) throw new Error(`agent database not found: ${AGENT_DB}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backup = `${AGENT_DB}.bak-${stamp}`;
  copyFileSync(AGENT_DB, backup);
  chmodSync(backup, 0o600);
  for (const suffix of ["-wal", "-shm"]) {
    if (!existsSync(`${AGENT_DB}${suffix}`)) continue;
    copyFileSync(`${AGENT_DB}${suffix}`, `${backup}${suffix}`);
    chmodSync(`${backup}${suffix}`, 0o600);
  }
  return backup;
}

/** Import the v2 account helper module. Never fall back to a v1 file. */
async function loadAccountImport() {
  try {
    return await import("../lib/account-import.mjs");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new CliError("lib/account-import.mjs is missing; reinstall omp-shims");
    }
    throw error;
  }
}

/** add-account <provider> <plugin-package> */
async function commandAddAccount(args) {
  const [provider, packageName] = args;
  if (!provider || !packageName || args.length > 2) {
    throw new CliError("usage: omp-shims add-account <provider> <plugin-package>  (token on stdin)", 2);
  }
  const token = await readSecretToken();
  if (!token) throw new CliError("no token on stdin");
  if (!existsSync(AGENT_DB)) throw new CliError(`agent database not found: ${AGENT_DB}`);

  const { loginWithToken, pluginOAuth, upsertCredential } = await loadAccountImport();
  const oauth = await pluginOAuth(join(OMP_DIR, "plugins"), packageName, provider);
  const credential = await loginWithToken(oauth, token);
  const backup = backupAgentDb();
  const { id, created } = upsertCredential(AGENT_DB, provider, credential);
  console.log(`${provider}: ${created ? "added" : "updated"} account row ${id}`);
  console.log(`backup: ${backup}`);
  return 0;
}

/** Add the unpause preload to BUN_OPTIONS without dropping the caller's value. */
function antigravityBunOptions() {
  if (/\s/.test(ANTIGRAVITY_UNPAUSE_ENTRY)) {
    throw new CliError(
      `the install path contains whitespace (${ANTIGRAVITY_UNPAUSE_ENTRY}); BUN_OPTIONS cannot quote a preload path`,
    );
  }
  const existing = process.env.BUN_OPTIONS?.trim() ?? "";
  if (existing.includes(ANTIGRAVITY_UNPAUSE_ENTRY)) return existing;
  return [existing, `--preload ${ANTIGRAVITY_UNPAUSE_ENTRY}`].filter(Boolean).join(" ");
}

/** antigravity-login: the terminal `/login` path, with the paused provider re-enabled. */
async function commandAntigravityLogin(args) {
  if (args.length > 0) throw new CliError("usage: omp-shims antigravity-login", 2);
  const binary = ompBinary(TARGET_HOME);
  if (!existsSync(binary)) throw new CliError(`omp not found: ${binary}`);
  console.error(
    "[omp-shims] WARNING: Google may restrict accounts that use Antigravity outside its own apps; " +
      "re-enabling this provider can get the account banned.",
  );
  const env = { ...process.env, BUN_OPTIONS: antigravityBunOptions() };
  // A parent running this CLI through `BUN_BE_BUN=1 omp` must not make the
  // child `omp` behave like Bun and treat "login" as a script path.
  delete env.BUN_BE_BUN;
  const child = Bun.spawn([binary, "login", "google-antigravity"], {
    stdio: ["inherit", "inherit", "inherit"],
    env,
  });
  return await child.exited;
}

/** antigravity-env: print the preload for any other `omp` command. */
function commandAntigravityEnv(args) {
  if (args.length > 0) throw new CliError("usage: omp-shims antigravity-env", 2);
  console.log(`BUN_OPTIONS="${antigravityBunOptions()}"`);
  return 0;
}

/** repair-identities <provider> */
async function commandRepairIdentities(args) {
  const provider = args[0];
  if (!provider || args.length > 1) throw new CliError("usage: omp-shims repair-identities <provider>", 2);
  if (!existsSync(AGENT_DB)) throw new CliError(`agent database not found: ${AGENT_DB}`);
  const { repairIdentities } = await loadAccountImport();
  const backup = backupAgentDb();
  const changed = repairIdentities(AGENT_DB, provider);
  for (const { id, identity } of changed) console.log(`${provider}: row ${id} -> ${identity}`);
  if (changed.length === 0) console.log(`${provider}: nothing to repair`);
  console.log(`backup: ${backup}`);
  return 0;
}

/** Files this package generated. Never include agent.db. */
function generatedState() {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = undefined;
  }
  const db = stateDbPath(config);
  return [
    { path: CONFIG_PATH, note: "configuration" },
    { path: db, note: "state database" },
    { path: `${db}-wal`, note: "state database WAL" },
    { path: `${db}-shm`, note: "state database shared memory" },
    { path: join(OMP_DIR, "logs", "lazy-router.jsonl"), note: "router log" },
    { path: join(OMP_DIR, "logs", "lazy-router.jsonl.1"), note: "rotated router log" },
    { path: join(OMP_DIR, "logs", "antigravity-continuation.jsonl"), note: "Antigravity continuation log" },
    { path: join(OMP_DIR, "logs", "antigravity-streams.jsonl"), note: "Antigravity capture log" },
    { path: join(OMP_DIR, "logs", "antigravity-accounts.jsonl"), note: "Antigravity account log" },
    { path: join(OMP_DIR, "gateway-logs"), note: "traffic log directory" },
  ].filter((entry) => existsSync(entry.path));
}

/** uninstall [--dry-run|--clean] [--yes] */
function commandUninstall(args) {
  let clean = false;
  let yes = false;
  let dryRun = false;
  for (const flag of args) {
    if (flag === "--clean") clean = true;
    else if (flag === "--dry-run") dryRun = true;
    else if (flag === "--yes") yes = true;
    else throw new CliError(`unknown option "${flag}"`, 2);
  }
  if (clean && dryRun) throw new CliError("--clean and --dry-run cannot be combined", 2);
  if (clean && !yes) throw new CliError("--clean removes files; add --yes to confirm", 2);

  const entries = generatedState();
  if (entries.length === 0) console.log("no generated state found");
  for (const entry of entries) {
    console.log(`${clean ? "remove" : "would remove"}: ${entry.path}  (${entry.note})`);
  }

  if (clean) {
    for (const entry of entries) rmSync(entry.path, { recursive: true, force: true });
    console.log(`removed ${entries.length} item(s)`);
  }

  console.log(`
to stop and remove the service units:
  sudo systemctl disable --now omp-auth-gateway.service omp-auth-gateway@*.service omp-auth-broker.service
  sudo rm -f /etc/systemd/system/omp-auth-gateway.service /etc/systemd/system/omp-auth-gateway@.service /etc/systemd/system/omp-auth-broker.service
  sudo systemctl daemon-reload

to remove the package from the OMP plugin workspace:
  cd ${join(OMP_DIR, "plugins")} && bun remove omp-shims`);
  return 0;
}

/**
 * Run one command.
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      usage();
      return 0;
    }
    if (command === "--version" || command === "-v") {
      console.log(`omp-shims ${VERSION}`);
      return 0;
    }

    switch (command) {
      case "status":
        return commandStatus(args);
      case "doctor":
        if (args.length > 0) throw new CliError("usage: omp-shims doctor", 2);
        return commandDoctor();
      case "enable":
      case "disable":
        return commandToggle(command, args);
      case "env":
        return commandEnv(args);
      case "systemd":
        return commandSystemd(args);
      case "add-account":
        return await commandAddAccount(args);
      case "antigravity-login":
        return await commandAntigravityLogin(args);
      case "antigravity-env":
        return commandAntigravityEnv(args);
      case "repair-identities":
        return await commandRepairIdentities(args);
      case "uninstall":
        return commandUninstall(args);
      default: {
        usage();
        throw new CliError(`unknown command "${command}"`, 2);
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      if (error.code === 2) usage();
      console.error(`omp-shims: ${error.message}`);
      return error.code;
    }
    console.error(`omp-shims: ${error?.message ?? error}`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exitCode = code;
}
