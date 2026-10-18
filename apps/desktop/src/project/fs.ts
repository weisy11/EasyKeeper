import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import type { ProjectKind } from "./types";

const SCENARIO_MARKER = "scenario.ezkp";
const RECORD_MARKER = "record.ezkp";

const BROWSER_FILES = "ek.browserFiles";
const BROWSER_DIRS = "ek.browserDirs";

export class ProjectError extends Error {
  code: "exists" | "invalid-name" | "not-project" | "wrong-kind" | "missing-parent" | "io";

  constructor(code: ProjectError["code"], message = code) {
    super(message);
    this.code = code;
  }
}

type BrowserFs = { files: Record<string, string>; dirs: string[] };

function browserFs(): BrowserFs {
  try {
    const files = JSON.parse(localStorage.getItem(BROWSER_FILES) ?? "{}") as Record<string, string>;
    const dirs = JSON.parse(localStorage.getItem(BROWSER_DIRS) ?? "[]") as string[];
    return { files, dirs };
  } catch {
    return { files: {}, dirs: [] };
  }
}

function saveBrowserFs(fs: BrowserFs) {
  localStorage.setItem(BROWSER_FILES, JSON.stringify(fs.files));
  localStorage.setItem(BROWSER_DIRS, JSON.stringify(fs.dirs));
}

export function validFolderName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== "." && trimmed !== ".." && !trimmed.includes("/") && !trimmed.includes("\\");
}

/** Full project path → parent directory + folder name. The folder name is the project name. */
export function splitProjectPath(path: string): { parent: string; name: string } | null {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return null;
  const name = trimmed.slice(idx + 1);
  if (!validFolderName(name)) return null;
  return { parent: trimmed.slice(0, idx), name };
}

export function samePath(a: string, b: string) {
  return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
}

export async function documentsDir(): Promise<string> {
  if (isTauri) return invoke<string>("documents_dir");
  return "Documents";
}

export async function joinPath(parent: string, name: string): Promise<string> {
  if (!validFolderName(name)) throw new ProjectError("invalid-name");
  if (isTauri) return invoke<string>("join_path", { parent, name: name.trim() });
  return `${parent.replace(/\/+$/, "")}/${name.trim()}`;
}

export async function ensureDir(path: string) {
  if (isTauri) {
    await invoke("ensure_dir", { path });
    return;
  }
  const fs = browserFs();
  if (!fs.dirs.includes(path)) fs.dirs.push(path);
  saveBrowserFs(fs);
}

/** Next free `scenario1` / `record1` name in `parent`. Does not create the directory. */
export async function nextNumberedName(parent: string, prefix: "scenario" | "record"): Promise<string> {
  for (let n = 1; n < 10000; n += 1) {
    const name = `${prefix}${n}`;
    if (!(await pathExists(await joinPath(parent, name)))) return name;
  }
  throw new ProjectError("exists");
}

export async function pathExists(path: string): Promise<boolean> {
  if (isTauri) return invoke<boolean>("path_exists", { path });
  const fs = browserFs();
  return fs.dirs.includes(path) || path in fs.files;
}

async function writeText(path: string, contents: string) {
  if (isTauri) {
    await invoke("write_text_file", { path, contents });
    return;
  }
  const fs = browserFs();
  fs.files[path] = contents;
  saveBrowserFs(fs);
}

export async function pickParentDirectory(defaultPath?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath });
  if (!picked || Array.isArray(picked)) return null;
  return picked;
}

export async function listChildDirs(path: string): Promise<string[]> {
  if (isTauri) return invoke<string[]>("list_child_dirs", { path });
  const prefix = path.replace(/[\\/]+$/, "");
  const names = new Set<string>();
  for (const dir of browserFs().dirs) {
    const normalized = dir.replace(/\\/g, "/");
    const base = prefix.replace(/\\/g, "/");
    if (normalized === base || !normalized.startsWith(`${base}/`)) continue;
    const name = normalized.slice(base.length + 1).split("/")[0];
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** Marker file only. Contents are intentionally empty until the file format is decided. */
export async function createProject(opts: {
  name: string;
  parent: string;
  kind: ProjectKind;
  /** Create `parent` first. Used only for the default EasyKeeper library. */
  createParent: boolean;
}): Promise<{ path: string; name: string }> {
  const name = opts.name.trim();
  if (!validFolderName(name)) throw new ProjectError("invalid-name");
  if (opts.createParent) await ensureDir(opts.parent);
  else if (!(await pathExists(opts.parent))) throw new ProjectError("missing-parent");
  const path = await joinPath(opts.parent, name);
  if (await pathExists(path)) throw new ProjectError("exists");
  await ensureDir(path);
  const marker = opts.kind === "scenario" ? SCENARIO_MARKER : RECORD_MARKER;
  await writeText(await joinPath(path, marker), "");
  return { path, name };
}

/**
 * Accept a folder when the marker this page needs is present.
 * The other marker is ignored when both exist. File contents are not read.
 */
export async function openProject(path: string, expected: ProjectKind): Promise<{ name: string }> {
  const name = splitProjectPath(path)?.name;
  if (!name) throw new ProjectError("not-project");
  const scenario = await pathExists(await joinPath(path, SCENARIO_MARKER));
  const record = await pathExists(await joinPath(path, RECORD_MARKER));
  if (expected === "scenario") {
    if (scenario) return { name };
    if (record) throw new ProjectError("wrong-kind");
    throw new ProjectError("not-project");
  }
  if (record) return { name };
  if (scenario) throw new ProjectError("wrong-kind");
  throw new ProjectError("not-project");
}
