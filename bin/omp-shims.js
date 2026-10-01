#!/usr/bin/env bun
// omp-shims control CLI.
//
//   omp-shims status              show every feature and its current state
//   omp-shims enable <feature>    turn a feature on
//   omp-shims disable <feature>   turn a feature off
//   omp-shims env                 print the environment a service unit needs
//   omp-shims systemd <unit>      print a ready-to-install unit file
//
// Toggles are written to ~/.omp/shims.json (override with OMP_SHIMS_CONFIG).

import { loadConfig, describeConfig, writeConfig, FEATURES, CONFIG_PATH } from "../lib/config.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const preloadEntry = join(packageRoot, "preload.js");
const captureEntry = join(packageRoot, "registry-capture.js");

function usage() {
  console.log(`omp-shims

  status                list features and their state
  enable <feature>      enable a feature
  disable <feature>     disable a feature
  env                   environment exports for a service unit
  systemd <unit>        print a unit file (omp-auth-gateway|omp-auth-broker)
  help                  this text

config: ${CONFIG_PATH}`);
}

function fail(message) {
  console.error(`omp-shims: ${message}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

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
    console.log(`Environment="BUN_OPTIONS=--preload ${captureEntry} --preload ${preloadEntry}"`);
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
        .replaceAll("@SHIMS_PRELOAD@", `Environment="BUN_OPTIONS=--preload ${captureEntry} --preload ${preloadEntry}"`)
        .replaceAll("@OMP_BIN@", join(home, ".local", "bin", "omp"))
        .replaceAll("HOME=/root", `HOME=${home}`)
        .replaceAll("WorkingDirectory=/root", `WorkingDirectory=${home}`)
        .replaceAll("/root/.local/bin", join(home, ".local", "bin"))
        .replaceAll("User=root", `User=${process.env.SUDO_USER ?? process.env.USER ?? "root"}`)
        .trimEnd(),
    );
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
