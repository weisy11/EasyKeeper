import { ensureDir, joinPath, readTextFile, removeFile, writeTextFile } from "@ek/tool-api";
import type { JSONContent } from "@tiptap/core";

/** Scene page documents under `{project}/pages/<id>.json`. Images live in `@ek/tool-api`. */

const PAGE_ID = /^[a-z0-9-]+$/;

function pagePath(projectPath: string, pageId: string) {
  return joinPath(joinPath(projectPath, "pages"), `${pageId}.json`);
}

export async function readPage(projectPath: string, pageId: string): Promise<JSONContent | null> {
  if (!projectPath || !PAGE_ID.test(pageId)) return null;
  const text = await readTextFile(pagePath(projectPath, pageId));
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
  await removeFile(pagePath(projectPath, pageId));
}

export async function writePage(projectPath: string, pageId: string, doc: JSONContent) {
  if (!projectPath || !PAGE_ID.test(pageId)) return;
  await ensureDir(joinPath(projectPath, "pages"));
  await writeTextFile(pagePath(projectPath, pageId), JSON.stringify(doc));
}
