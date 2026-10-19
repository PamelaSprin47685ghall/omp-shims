import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.js";

const cli = join(import.meta.dir, "..", "bin", "omp-shims.js");

function run(args, env = {}) {
  const home = tempDir();
  const config = join(home, "shims.json");
  const { SUDO_USER: _sudo, ...inherited } = process.env;
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

describe("omp-shims CLI", () => {
  test("help is the default", () => {
    const { code, stdout } = run([]);
    expect(code).toBe(0);
    expect(stdout).toContain("enable <feature>");
  });

  test("status lists every feature", () => {
    const { code, stdout } = run(["status"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^on +ipv6-first/m);
    expect(stdout).toMatch(/^off +native-loop-guard/m);
  });

  test("enable and disable write the config file", () => {
    const { code, config } = run(["disable", "ipv6-first"]);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({ features: { "ipv6-first": { enabled: false } } });
  });

  test("unknown features and commands fail", () => {
    expect(run(["enable", "nope"]).code).toBe(1);
    expect(run(["enable"]).code).toBe(1);
    expect(run(["frobnicate"]).code).toBe(1);
  });

  test("env prints the preload line in the right order", () => {
    const { stdout } = run(["env"]);
    expect(stdout.trim()).toMatch(
      /^Environment="BUN_OPTIONS=--preload \S+registry-capture\.js --preload \S+preload\.js"$/,
    );
  });

  test("systemd fills in every placeholder for the current account", () => {
    const { code, stdout, home } = run(["systemd", "omp-auth-gateway"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain("@OMP_BIN@");
    expect(stdout).not.toContain("@SHIMS_PRELOAD@");
    expect(stdout).toContain(`ExecStart=${home}/.local/bin/omp auth-gateway serve`);
    expect(stdout).toContain("User=tester");
    // The preload line must be live, not commented out, or the unit runs without the shims.
    expect(stdout).toMatch(/^Environment="BUN_OPTIONS=--preload \S+registry-capture\.js --preload \S+preload\.js"$/m);
    expect(stdout).toContain(`WorkingDirectory=${home}`);
  });

  test("both units load the shims", () => {
    for (const unit of ["omp-auth-broker", "omp-auth-gateway"]) {
      expect(run(["systemd", unit]).stdout).toMatch(/^Environment="BUN_OPTIONS=--preload /m);
    }
  });

  test("systemd rejects unknown units", () => {
    expect(run(["systemd", "nope"]).code).toBe(1);
  });
});
