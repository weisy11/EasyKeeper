import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";

const BROWSER_FILES = "ek.browserFiles";
const BROWSER_DIRS = "ek.browserDirs";
const PAGE_ID = /^[a-z0-9-]+$/;
const IMAGE_SRC = /^images\/([^/\\]+)$/;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function isTauri() {
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

async function joinPath(parent: string, name: string) {
  if (isTauri()) return invoke<string>("join_path", { parent, name });
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

async function ensureDir(path: string) {
  if (isTauri()) {
    await invoke("ensure_dir", { path });
    return;
  }
  const fs = browserFs();
  if (!fs.dirs.includes(path)) fs.dirs.push(path);
  saveBrowserFs(fs);
}

async function readText(path: string): Promise<string | null> {
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

async function writeText(path: string, contents: string) {
  if (isTauri()) {
    await invoke("write_text_file", { path, contents });
    return;
  }
  const fs = browserFs();
  fs.files[path] = contents;
  saveBrowserFs(fs);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(contents: string) {
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mimeForName(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function writeBytes(path: string, bytes: Uint8Array, mime: string) {
  const contents = encodeBase64(bytes);
  if (isTauri()) {
    await invoke("write_base64_file", { path, contents });
    return;
  }
  const fs = browserFs();
  fs.files[path] = `data:${mime};base64,${contents}`;
  saveBrowserFs(fs);
}

async function readBytes(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (isTauri()) {
    try {
      const contents = await invoke<string>("read_base64_file", { path });
      const filename = path.split(/[\\/]/).pop() ?? "";
      return { bytes: decodeBase64(contents), mime: mimeForName(filename) };
    } catch {
      return null;
    }
  }
  const value = browserFs().files[path];
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]*);base64,(.*)$/.exec(value);
  if (!match) return null;
  return { bytes: decodeBase64(match[2]), mime: match[1] || "application/octet-stream" };
}

export function fileExtension(file: File) {
  const named = file.name.match(/\.([A-Za-z0-9]+)$/);
  if (named) return named[1].toLowerCase();
  return EXT_BY_MIME[file.type] ?? "png";
}

/** Copy a pasted image into `{project}/images` and return the project-relative path. */
export async function savePastedImage(projectPath: string, file: File) {
  const ext = fileExtension(file);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const dir = await joinPath(projectPath, "images");
  await ensureDir(dir);
  const path = await joinPath(dir, filename);
  await writeBytes(path, new Uint8Array(await file.arrayBuffer()), file.type || mimeForName(filename));
  return `images/${filename}`;
}

export async function readPage(projectPath: string, pageId: string): Promise<JSONContent | null> {
  if (!projectPath || !PAGE_ID.test(pageId)) return null;
  const text = await readText(await joinPath(await joinPath(projectPath, "pages"), `${pageId}.json`));
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as JSONContent;
    if (!parsed || parsed.type !== "doc") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deletePage(projectPath: string, pageId: string) {
  if (!projectPath || !PAGE_ID.test(pageId)) return;
  const path = await joinPath(await joinPath(projectPath, "pages"), `${pageId}.json`);
  if (isTauri()) {
    await invoke("remove_file", { path });
    return;
  }
  const fs = browserFs();
  delete fs.files[path];
  saveBrowserFs(fs);
}

export async function writePage(projectPath: string, pageId: string, doc: JSONContent) {
  if (!projectPath || !PAGE_ID.test(pageId)) return;
  const dir = await joinPath(projectPath, "pages");
  await ensureDir(dir);
  await writeText(await joinPath(dir, `${pageId}.json`), JSON.stringify(doc));
}

/** Load a project image for display. The returned blob URL must be revoked by the caller. */
export async function loadImageObjectUrl(projectPath: string, src: string): Promise<string | null> {
  const match = IMAGE_SRC.exec(src);
  const filename = match?.[1];
  if (!projectPath || !filename || filename === "." || filename === "..") return null;
  const file = await readBytes(await joinPath(await joinPath(projectPath, "images"), filename));
  if (!file) return null;
  const copy = new Uint8Array(file.bytes);
  return URL.createObjectURL(new Blob([copy], { type: file.mime }));
}
