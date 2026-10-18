#!/usr/bin/env node
/**
 * Debug-only dev supervisor. Does not change `pnpm dev`.
 *
 * User `pnpm dev` picks a free port from 47231 upward.
 * This script picks a free port from 47241 upward and only stops processes it spawned.
 *
 * The long-running process is `supervise`. Later commands only write
 * `.ek-dev/command`, because a new shell cannot signal an older sandbox.
 *
 *   node scripts/ek-dev.mjs supervise
 *   node scripts/ek-dev.mjs web
 *   node scripts/ek-dev.mjs client
 *   node scripts/ek-dev.mjs stop
 *   node scripts/ek-dev.mjs status
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, isPortInUse } from "./dev-ports.mjs";

const DEBUG_PORT_START = 47241;
const USER_PORT = 47231;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".ek-dev");
const stateFile = path.join(dir, "supervisor.json");
const commandFile = path.join(dir, "command");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A new sandbox cannot signal the supervisor, but EPERM means it is still running.
    return error?.code === "EPERM";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortInUse(port)) return;
    await sleep(200);
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`);
}

function writeCommand(command) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${commandFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, command);
  fs.renameSync(tmp, commandFile);
}

function supervisorAlive() {
  const state = readState();
  return state && alive(state.pid) ? state : null;
}

async function request(mode) {
  const state = supervisorAlive();
  if (!state) {
    console.error("no supervisor is running; start `node scripts/ek-dev.mjs supervise` first");
    process.exit(1);
  }
  writeCommand(mode);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const next = readState();
    if (next?.mode === mode && next.ready) {
      console.log(JSON.stringify(next));
      return;
    }
    if (!supervisorAlive()) {
      console.error("supervisor exited before becoming ready");
      process.exit(1);
    }
    await sleep(300);
  }
  console.error(`timed out waiting for mode ${mode}`);
  process.exit(1);
}

async function requestStop() {
  const state = supervisorAlive();
  if (!state) {
    console.log(JSON.stringify({ running: false, portStart: DEBUG_PORT_START }));
    return;
  }
  writeCommand("stop");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!alive(state.pid)) {
      console.log(JSON.stringify({ running: false, portStart: DEBUG_PORT_START }));
      return;
    }
    await sleep(200);
  }
  console.error(`supervisor ${state.pid} did not exit`);
  process.exit(1);
}

function printStatus() {
  const state = readState();
  const running = !!(state && alive(state.pid));
  console.log(JSON.stringify({ running, userPort: USER_PORT, ...(running ? state : { portStart: DEBUG_PORT_START }) }));
}

function spawnGroup(args) {
  return spawn(args[0], args.slice(1), {
    cwd: root,
    detached: true,
    stdio: "inherit",
  });
}

function killGroup(child) {
  if (!child?.pid || !alive(child.pid)) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function supervise() {
  const existing = supervisorAlive();
  if (existing) {
    console.error(`supervisor already running (pid ${existing.pid})`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  let mode = "web";
  let ready = false;
  let vite = null;
  let tauri = null;
  let debugPort = null;
  let shuttingDown = false;

  const publish = () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        pid: process.pid,
        port: debugPort,
        portStart: DEBUG_PORT_START,
        mode,
        ready,
        userPort: USER_PORT,
      }),
    );
  };

  const shutdown = async (exitCode) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    publish();
    killGroup(tauri);
    killGroup(vite);
    await sleep(400);
    for (const child of [tauri, vite]) {
      if (child?.pid && alive(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }
    }
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(commandFile, { force: true });
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  publish();

  const ensureVite = async () => {
    if (vite?.pid && alive(vite.pid)) return;
    debugPort = await findFreePort(DEBUG_PORT_START, 30);
    if (debugPort !== DEBUG_PORT_START) {
      console.log(`debug port ${DEBUG_PORT_START} is in use, using ${debugPort}`);
    }
    ready = false;
    publish();
    vite = spawnGroup([
      "pnpm",
      "--filter",
      "@ek/desktop",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(debugPort),
      "--strictPort",
    ]);
    await waitPort(debugPort, 20_000);
  };

  const ensureTauri = async () => {
    await ensureVite();
    if (tauri?.pid && alive(tauri.pid)) return;
    ready = false;
    publish();
    const override = JSON.stringify({
      build: { beforeDevCommand: "", devUrl: `http://127.0.0.1:${debugPort}` },
    });
    tauri = spawnGroup([
      "pnpm",
      "--filter",
      "@ek/desktop",
      "exec",
      "tauri",
      "dev",
      "-c",
      override,
      "--no-dev-server-wait",
    ]);
  };

  try {
    for (;;) {
      if (fs.existsSync(commandFile)) {
        const command = fs.readFileSync(commandFile, "utf8").trim();
        fs.rmSync(commandFile, { force: true });
        if (command === "stop") await shutdown(0);
        if (command === "web" || command === "client") {
          if (command !== mode) ready = false;
          mode = command;
        }
      }
      if (mode === "web") {
        await ensureVite();
        if (tauri) {
          killGroup(tauri);
          tauri = null;
        }
        ready = true;
      } else if (mode === "client") {
        await ensureTauri();
        ready = !!(tauri?.pid && alive(tauri.pid));
      }
      publish();
      await sleep(300);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await shutdown(1);
  }
}

const command = process.argv[2] ?? "status";
if (command === "supervise") await supervise();
else if (command === "web" || command === "start") await request("web");
else if (command === "client") await request("client");
else if (command === "stop") await requestStop();
else if (command === "status") printStatus();
else {
  console.error("usage: node scripts/ek-dev.mjs supervise|web|client|stop|status");
  process.exit(1);
}
