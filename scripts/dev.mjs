#!/usr/bin/env node
/**
 * User entry for `pnpm dev`.
 * Prefers port 47231, then the next free port. Vite and the Tauri window use that same port.
 * Does not stop whatever is already listening.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, isPortInUse } from "./dev-ports.mjs";

const START_PORT = 47231;
const PORT_ATTEMPTS = 30;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function spawnGroup(args) {
  return spawn(args[0], args.slice(1), { cwd: root, detached: true, stdio: "inherit" });
}

function killGroup(child) {
  if (!child?.pid) return;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const children = [];
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killGroup(child);
  await sleep(300);
  for (const child of children) {
    if (!child?.pid) continue;
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
  process.exit(code);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

let port = START_PORT;
let vite = null;
let searchFrom = START_PORT;
while (searchFrom < START_PORT + PORT_ATTEMPTS) {
  try {
    port = await findFreePort(searchFrom, START_PORT + PORT_ATTEMPTS - searchFrom);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await stop(1);
  }
  if (port !== START_PORT) console.log(`port ${START_PORT} is in use, using ${port}`);
  console.log(`EasyKeeper dev http://127.0.0.1:${port}`);
  vite = spawnGroup([
    "pnpm",
    "--filter",
    "@ek/desktop",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ]);
  children.push(vite);
  const deadline = Date.now() + 20_000;
  let opened = false;
  while (Date.now() < deadline) {
    if (vite.exitCode != null) break;
    if (await isPortInUse(port)) {
      opened = true;
      break;
    }
    await sleep(200);
  }
  if (opened) break;
  console.error(`Vite did not stay on ${port}`);
  killGroup(vite);
  searchFrom = port + 1;
  vite = null;
}
if (!vite) {
  console.error(`no free port in ${START_PORT}–${START_PORT + PORT_ATTEMPTS - 1}`);
  await stop(1);
}

const override = JSON.stringify({
  build: { beforeDevCommand: "", devUrl: `http://127.0.0.1:${port}` },
});
const tauri = spawnGroup([
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
children.push(tauri);
vite.on("exit", () => {
  if (!stopping) void stop(1);
});
tauri.on("exit", (code) => void stop(code ?? 0));
