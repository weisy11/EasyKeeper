import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { decodeBase64, encodeBase64, ensureDir, isTauri, joinPath, readBase64File, writeBase64File } from "./files";

/**
 * Images stored under `{project}/images` and referenced as `images/<file>`. Shared by every tool
 * that shows or pastes pictures (scenario pages, NPC portraits, maps, investigator portraits).
 */

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

function mimeForName(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function imageFilename(projectPath: string, src: string) {
  const match = IMAGE_SRC.exec(src);
  const filename = match?.[1];
  if (!projectPath || !filename || filename === "." || filename === "..") return null;
  return filename;
}

function imagePath(projectPath: string, filename: string) {
  return joinPath(joinPath(projectPath, "images"), filename);
}

export function fileExtension(file: File) {
  const named = file.name.match(/\.([A-Za-z0-9]+)$/);
  if (named) return named[1].toLowerCase();
  return EXT_BY_MIME[file.type] ?? "png";
}

/** Copy a pasted image into `{project}/images` and return the project-relative path. */
export async function savePastedImage(projectPath: string, file: File) {
  const ext = fileExtension(file);
  const contents = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  return writeProjectImageBase64(projectPath, contents, ext, file.type || undefined);
}

/** Read a project image as base64, without the data-URL prefix. */
export async function readProjectImageBase64(projectPath: string, src: string): Promise<string | null> {
  const filename = imageFilename(projectPath, src);
  if (!filename) return null;
  return readBase64File(imagePath(projectPath, filename));
}

/** Write base64 image bytes into `{project}/images` and return the project-relative path. */
export async function writeProjectImageBase64(projectPath: string, contents: string, ext: string, mime?: string): Promise<string> {
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "png";
  const filename = `${crypto.randomUUID()}.${safeExt}`;
  await ensureDir(joinPath(projectPath, "images"));
  await writeBase64File(imagePath(projectPath, filename), contents, mime ?? mimeForName(filename));
  return `images/${filename}`;
}

/**
 * URL the webview can load directly through Tauri's asset protocol. The file is streamed from
 * disk by the webview itself (no base64, no IPC) and cached by it. The host allows
 * `{project}/images` when the project opens, so only files under that folder resolve.
 * Null outside the desktop app.
 */
export function projectImageUrl(projectPath: string, src: string): string | null {
  if (!isTauri()) return null;
  const filename = imageFilename(projectPath, src);
  if (!filename) return null;
  return convertFileSrc(imagePath(projectPath, filename));
}

/** Browser-only fallback: read the stored data URL into a blob URL. Not used in the desktop app. */
export async function loadImageBlobUrl(projectPath: string, src: string): Promise<string | null> {
  const filename = imageFilename(projectPath, src);
  if (!filename) return null;
  const contents = await readBase64File(imagePath(projectPath, filename));
  if (contents == null) return null;
  const bytes = decodeBase64(contents);
  return URL.createObjectURL(new Blob([bytes], { type: mimeForName(filename) }));
}

/**
 * Display URL for a project image plus an error handler for the `<img>`. In the desktop app the
 * URL is computed synchronously (asset protocol); a load failure, such as a deleted file, hides
 * the image instead of showing the broken-image icon. The browser fallback reads a blob URL.
 */
export function useProjectImage(projectPath: string, src: string): { url: string | null; onError: () => void } {
  const direct = useMemo(() => projectImageUrl(projectPath, src), [projectPath, src]);
  const [blob, setBlob] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${projectPath}\n${src}`;

  useEffect(() => {
    if (isTauri()) return;
    let cancelled = false;
    void loadImageBlobUrl(projectPath, src).then((next) => {
      if (!cancelled) setBlob(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, src]);

  const url = failed === key ? null : (direct ?? blob);
  return { url, onError: () => setFailed(key) };
}
