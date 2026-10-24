import { invoke } from "@tauri-apps/api/core";
import { serial } from "./serial";

/**
 * Project file access shared by tools. Paths are absolute; the host commands behind them are the
 * same for every tool. Outside the desktop app a `localStorage` stand-in keeps the browser preview
 * working; it is for debugging only.
 */

const BROWSER_FILES = "ek.browserFiles";
const BROWSER_DIRS = "ek.browserDirs";

/** True inside the desktop app. */
export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type BrowserFs = { files: Record<string, string>; dirs: string[] };

function browserFs(): BrowserFs {
  try {
    const files = JSON.parse(localStorage.getItem(BROWSER_FILES) ?? "{}") as Record<string, string>;
    const dirs = JSON.parse(localStorage.getItem(BROWSER_DIRS) ?? "[]") as string[];
    return {
      files: files && typeof files === "object" ? files : {},
      dirs: Array.isArray(dirs) ? dirs : [],
    };
  } catch {
    return { files: {}, dirs: [] };
  }
}

function saveBrowserFs(fs: BrowserFs) {
  localStorage.setItem(BROWSER_FILES, JSON.stringify(fs.files));
  localStorage.setItem(BROWSER_DIRS, JSON.stringify(fs.dirs));
}

/** Pure string join; the separator follows the parent so Windows paths stay Windows paths. */
export function joinPath(parent: string, name: string) {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export async function ensureDir(path: string) {
  if (isTauri()) {
    await invoke("ensure_dir", { path });
    return;
  }
  const fs = browserFs();
  if (!fs.dirs.includes(path)) fs.dirs.push(path);
  saveBrowserFs(fs);
}

/** File contents, or null when it cannot be read. */
export async function readTextFile(path: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>("read_text_file", { path });
    } catch {
      return null;
    }
  }
  const value = browserFs().files[path];
  return typeof value === "string" ? value : null;
}

/** Writes to one path are serialized so unawaited saves land in program order. */
export async function writeTextFile(path: string, contents: string) {
  if (isTauri()) {
    await serial(path, () => invoke("write_text_file", { path, contents }));
    return;
  }
  const fs = browserFs();
  fs.files[path] = contents;
  saveBrowserFs(fs);
}

export async function removeFile(path: string) {
  if (isTauri()) {
    await serial(path, () => invoke("remove_file", { path }));
    return;
  }
  const fs = browserFs();
  delete fs.files[path];
  saveBrowserFs(fs);
}

/** Base64 file contents without a data-URL prefix, or null when it cannot be read. */
export async function readBase64File(path: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>("read_base64_file", { path });
    } catch {
      return null;
    }
  }
  const value = browserFs().files[path];
  const encoded = typeof value === "string" ? /^data:[^;,]*;base64,(.*)$/.exec(value) : null;
  return encoded?.[1] ?? null;
}

/** `mime` only matters for the browser stand-in, which stores a data URL. */
export async function writeBase64File(path: string, contents: string, mime: string) {
  if (isTauri()) {
    await serial(path, () => invoke("write_base64_file", { path, contents }));
    return;
  }
  const fs = browserFs();
  fs.files[path] = `data:${mime};base64,${contents}`;
  saveBrowserFs(fs);
}

export function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBase64(contents: string) {
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
