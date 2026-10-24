import { STATUS_EVENT, type StatusLevel, type StatusReport } from "@ek/tool-api";
import { appLog, createStore } from "./store";

export type StatusEntry = {
  key: string;
  level: StatusLevel;
  text: string;
  detail?: string;
  /** Epoch millis of the latest report for this key. */
  at: number;
};

/** Everything tools currently report. The status bar shows errors first, then the newest info line. */
export const statusStore = createStore<{ entries: Record<string, StatusEntry> }>({ entries: {} });

const expiry = new Map<string, number>();

function dropExpiry(key: string) {
  const timer = expiry.get(key);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    expiry.delete(key);
  }
}

export function setStatus(report: StatusReport) {
  dropExpiry(report.key);
  if (report.text === null) {
    if (!(report.key in statusStore.get().entries)) return;
    statusStore.set((s) => {
      const entries = { ...s.entries };
      delete entries[report.key];
      return { entries };
    });
    appLog(`status cleared: ${report.key}`);
    return;
  }
  const entry: StatusEntry = { key: report.key, level: report.level ?? "info", text: report.text, detail: report.detail, at: Date.now() };
  statusStore.set((s) => ({ entries: { ...s.entries, [report.key]: entry } }));
  appLog(`status ${entry.level}: ${report.key}: ${entry.text}${entry.detail ? ` (${entry.detail})` : ""}`);
  if (report.ttlMs && report.ttlMs > 0) {
    expiry.set(report.key, window.setTimeout(() => setStatus({ key: report.key, text: null }), report.ttlMs));
  }
}

function isReport(value: unknown): value is StatusReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<StatusReport>;
  return typeof report.key === "string" && report.key !== "" && (report.text === null || typeof report.text === "string");
}

let installed = false;

/** Route `ek:status` window events into the store. Pop-outs are same-realm portals, so one listener covers them. */
export function installStatusBridge() {
  if (installed) return;
  installed = true;
  window.addEventListener(STATUS_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isReport(detail)) setStatus(detail);
    else console.warn("[ek] ignored malformed status report", detail);
  });
}

/** Newest error, else newest info entry, else nothing. */
export function pickStatus(entries: Record<string, StatusEntry>): { shown: StatusEntry | null; errors: number } {
  let shown: StatusEntry | null = null;
  let errors = 0;
  for (const entry of Object.values(entries)) {
    if (entry.level === "error") errors += 1;
    if (!shown) {
      shown = entry;
      continue;
    }
    const outranks = entry.level === "error" && shown.level !== "error";
    const sameLevelNewer = entry.level === shown.level && entry.at > shown.at;
    if (outranks || sameLevelNewer) shown = entry;
  }
  return { shown, errors };
}
