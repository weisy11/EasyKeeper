import { invoke } from "@tauri-apps/api/core";
import { registerAppKv, type AppKv } from "@ek/tool-api";

/**
 * Host key/value settings backed by the `kv` table in `app.sqlite`.
 *
 * The whole table is loaded once at boot so reads are synchronous. Each write goes to Rust right
 * away as a single-key upsert; writes to the same key are chained so they reach the database in
 * program order. Outside Tauri (plain browser preview) the store falls back to `localStorage`.
 */

const cache = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
let backend: "sqlite" | "local" = "local";

function tauriReady() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function enqueue(key: string, work: () => Promise<void>) {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous
    .then(work)
    .catch((error: unknown) => {
      console.error(`[ek] app kv write failed for ${key}`, error);
    })
    .finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    });
  pending.set(key, next);
}

export const appKv: AppKv = {
  get(key) {
    if (backend === "local") return localStorage.getItem(key);
    return cache.get(key) ?? null;
  },
  set(key, value) {
    const text = String(value);
    if (backend === "local") {
      localStorage.setItem(key, text);
      return;
    }
    cache.set(key, text);
    enqueue(key, () => invoke<void>("app_kv_set", { key, value: text }));
  },
  remove(key) {
    if (backend === "local") {
      localStorage.removeItem(key);
      return;
    }
    cache.delete(key);
    enqueue(key, () => invoke<void>("app_kv_delete", { key }));
  },
};

/** Wait until every queued write has reached the database. Used before the window closes. */
export async function flushAppKv(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending.values()]);
  }
}

/**
 * Fill the cache from `app.sqlite` before any module reads a setting. On the first start after
 * the WebKit `localStorage` era, `ek.*` keys that only exist there are copied over.
 */
export async function installAppKv() {
  registerAppKv(appKv);
  if (!tauriReady()) return;
  try {
    const saved = await invoke<Record<string, string>>("app_kv_all");
    for (const key of Object.keys(saved)) cache.set(key, saved[key] ?? "");
    backend = "sqlite";
    if (cache.size === 0) seedFromWebKit();
  } catch (error) {
    console.error("[ek] app kv load failed; settings will not persist", error);
  }
}

function seedFromWebKit() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith("ek.") || key.startsWith("ek.dice.")) continue;
    const value = localStorage.getItem(key);
    if (value != null) appKv.set(key, value);
  }
}
