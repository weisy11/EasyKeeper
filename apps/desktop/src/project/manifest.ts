import type { EzkpManifest, ProjectKind } from "./types";

export function serializeManifest(manifest: EzkpManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManifest(text: string): EzkpManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  if (record.kind === "scenario") {
    return { kind: "scenario", name: record.name, version: 1 };
  }
  if (record.kind === "gameRecord" && typeof record.modulePath === "string" && record.modulePath.trim()) {
    return { kind: "gameRecord", name: record.name, version: 1, modulePath: record.modulePath };
  }
  return null;
}

export function isProjectKind(value: string): value is ProjectKind {
  return value === "scenario" || value === "gameRecord";
}
