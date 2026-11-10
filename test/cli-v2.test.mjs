import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "bin", "omp-shims.mjs");

/** A fresh temporary directory. */
function tempDir(prefix = "omp-shims-cli-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Run the CLI with an isolated home and config path. */
function run(args, { home = tempDir(), env = {} } = {}) {
  const config = join(home, ".omp", "shims.json");
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) if (key.startsWith("OMP_SHIMS_")) delete inherited[key];
  for (const key of ["SUDO_USER", "OMP_USER", "OMP_BIN", "OMP_AGENT_DB"]) delete inherited[key];
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...inherited, HOME: home, OMP_SHIMS_CONFIG: config, USER: "tester", ...env },
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    home,
    config,
  };
}

/** Write one config file with the given mode. */
function writeConfig(path, value, mode = 0o600) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(path, mode);
}

describe("omp-shims v2 CLI", () => {
  test("--version exits 0", () => {
    const { code, stdout } = run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("omp-shims 2.0.0");
  });

  test("--help exits 0 and lists the commands", () => {
    const { code, stdout } = run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("status [--json]");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("uninstall");
  });

  test("an unknown command exits 2 with usage", () => {
    const { code, stderr } = run(["frobnicate"]);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command "frobnicate"');
  });

  test("status --json reports the resolved state, source, and ignored legacy env", () => {
    const home = tempDir();
    const config = join(home, ".omp", "shims.json");
    writeConfig(config, {
      version: 2,
      features: {
        "lazy-router": { enabled: true },
      },
    });

    const plain = run(["status", "--json"], { home });
    expect(plain.code).toBe(0);
    const report = JSON.parse(plain.stdout);
    expect(report.version).toBe("2.0.0");
    expect(report.configPath).toBe(config);
    expect(report.features["lazy-router"]).toMatchObject({ enabled: true, source: "config" });
    expect(report.features["ipv6-first"]).toMatchObject({ enabled: true, source: "default" });
    expect(report.ignoredEnv).toEqual([]);

    const overridden = run(["status", "--json"], {
      home,
      env: { OMP_SHIMS_LAZY_ROUTER: "off", OMP_SHIMS_AG_CONTINUE_MAX: "5" },
    });
    const overriddenReport = JSON.parse(overridden.stdout);
    expect(overriddenReport.features["lazy-router"]).toMatchObject({ enabled: false, source: "env" });
    expect(overriddenReport.ignoredEnv).toEqual(["OMP_SHIMS_AG_CONTINUE_MAX"]);
  });

  test("enable refuses an unknown feature", () => {
    const { code, stderr } = run(["enable", "not-a-feature"]);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown feature "not-a-feature"');
  });

  test("status lists unknown keys from the raw file", () => {
    const home = tempDir();
    writeConfig(join(home, ".omp", "shims.json"), {
      version: 2,
      features: { "not-a-feature": true },
    });
    const { code, stdout } = run(["status"], { home });
    expect(code).toBe(1);
    expect(stdout).toContain("unknown keys in the config file");
    expect(stdout).toContain("features.not-a-feature");
  });

  test("doctor FAILs on a config readable by other users", () => {
    const home = tempDir();
    writeConfig(join(home, ".omp", "shims.json"), { version: 2 }, 0o644);
    const { code, stdout } = run(["doctor"], { home });
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL  config permissions");
  });

  test("doctor FAILs on a corrupt state database", () => {
    const home = tempDir();
    const dbPath = join(home, "omp-shims-state.sqlite");
    writeFileSync(dbPath, "this is not a sqlite database");
    writeConfig(join(home, ".omp", "shims.json"), {
      version: 2,
      stateDbPath: dbPath,
    });
    const { code, stdout } = run(["doctor"], { home });
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL  state database");
  });

  test("doctor PASSes on a clean home", () => {
    const { code, stdout } = run(["doctor"]);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS  config schema");
  });

  test("enable writes the config with mode 0600", () => {
    const home = tempDir();
    const { code, config } = run(["disable", "ipv6-first"], { home });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
      version: 2,
      features: { "ipv6-first": { enabled: false } },
    });
    expect(readFileSync(config, "utf8").length).toBeGreaterThan(0);
  });

  test("systemd fills every placeholder and sets UMask", () => {
    const { code, stdout, home } = run(["systemd", "omp-auth-gateway@"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain("@OMP_BIN@");
    expect(stdout).not.toContain("@SHIMS_PRELOAD@");
    expect(stdout).toContain("User=tester");
    expect(stdout).toContain(`WorkingDirectory=${home}`);
    expect(stdout).toContain("UMask=0077");
    expect(stdout).toContain("EnvironmentFile=-/etc/omp-shims/%i.env");
    expect(stdout).toContain("OMP_SHIMS_REUSE_PORT=1");
  });
});
