import { useSyncExternalStore } from "react";

export type Store<T> = {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore<T>(initial: T, persistKey?: string): Store<T> {
  let value = initial;
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) value = { ...initial, ...JSON.parse(raw) };
    } catch {
      /* ignore corrupt storage */
    }
  }
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      if (persistKey) localStorage.setItem(persistKey, JSON.stringify(value));
      subs.forEach((f) => f());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

export type Locale = "zh" | "en";
export type Theme = "dark" | "light";

export type GlobalSettings = { locale: Locale; fontScale: number; theme: Theme };

export const settingsStore = createStore<GlobalSettings>({ locale: "zh", fontScale: 1, theme: "dark" }, "ek.settings");

export type ToolState = { enabled: boolean; installed: boolean };
export const toolStateStore = createStore<Record<string, ToolState>>({}, "ek.toolState");

export function getToolState(id: string): ToolState {
  return toolStateStore.get()[id] ?? { enabled: true, installed: true };
}

export function setToolState(id: string, patch: Partial<ToolState>) {
  toolStateStore.set((s) => ({ ...s, [id]: { ...getToolState(id), ...patch } }));
}

/** Host-managed per-panel session state (architecture rule 1): survives remounts, moves, pop-outs. */
export const panelStateStore = createStore<Record<string, Record<string, unknown>>>({}, "ek.panelState");

export type ChromeState = { locked: boolean; focusMode: boolean; paletteOpen: boolean };
export const chromeStore = createStore<ChromeState>({ locked: false, focusMode: false, paletteOpen: false });

export type LogEntry = { t: number; msg: string };
export const logStore = createStore<LogEntry[]>([]);
export function appLog(msg: string) {
  logStore.set((l) => [...l.slice(-199), { t: Date.now(), msg }]);
  console.log("[ek]", msg);
}

export function TOOL_IDS_RESET() {
  toolStateStore.set({});
}
