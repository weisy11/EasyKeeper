import { reportStatus } from "@ek/tool-api";

/** How long a failed list write (NPC, clue...) stays in the host status bar. There is no retry. */
export const WRITE_ERROR_TTL_MS = 10_000;

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Put a failed database write in the host status bar and the console.
 * `key` identifies the record (for example `actor.<id>`) so a later success can clear it.
 */
export function reportWriteError(key: string, text: string, error: unknown) {
  console.error(`[ek.scenario] ${text} (${key})`, error);
  reportStatus({ key: `ek.scenario.${key}`, level: "error", text, detail: errorText(error), ttlMs: WRITE_ERROR_TTL_MS });
}

export function clearWriteError(key: string) {
  reportStatus({ key: `ek.scenario.${key}`, text: null });
}
