import type { ToolDefinition } from "@ek/tool-api";
import { createStore } from "@/lib/store";
import { BUILTIN_CATALOG, CATALOG_MAP } from "./catalog";

const KEY = "ek.allowedTools";

function defaultAllowed(): string[] {
  return BUILTIN_CATALOG.filter((t) => t.defaultAllowed).map((t) => t.id);
}

function loadInitial(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((id) => !!CATALOG_MAP[id]);
        if (!ids.includes("ek.scenario")) {
          ids.push("ek.scenario");
          localStorage.setItem(KEY, JSON.stringify(ids));
        }
        return ids;
      }
    }
  } catch {
    /* ignore */
  }
  return defaultAllowed();
}

export const allowedToolsStore = createStore<{ ids: string[] }>({ ids: loadInitial() });

allowedToolsStore.subscribe(() => {
  localStorage.setItem(KEY, JSON.stringify(allowedToolsStore.get().ids));
});

export function isAllowed(id: string) {
  return allowedToolsStore.get().ids.includes(id);
}

export function setAllowed(id: string, on: boolean) {
  allowedToolsStore.set((s) => {
    const has = s.ids.includes(id);
    if (on && !has) return { ids: [...s.ids, id] };
    if (!on && has) return { ids: s.ids.filter((x) => x !== id) };
    return s;
  });
}

/** Currently loaded tool definitions (thin entries). */
export const loadedToolsStore = createStore<{
  byId: Record<string, ToolDefinition>;
  errors: Record<string, string>;
}>({ byId: {}, errors: {} });

export function getLoadedTool(id: string) {
  return loadedToolsStore.get().byId[id];
}

export function getToolError(id: string) {
  return loadedToolsStore.get().errors[id];
}
