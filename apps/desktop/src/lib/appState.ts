import { invoke } from "@tauri-apps/api/core";

const cache = new Map<string, string>();
let installed = false;
let timer = 0;

function tauriReady() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function flush() {
  window.clearTimeout(timer);
  timer = 0;
  const state = Object.fromEntries(cache);
  void invoke("app_state_save", { state }).catch((error: unknown) => {
    console.error("[ek] app state save failed", error);
  });
}

function schedule() {
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, 200);
}

function seedFromWebKit() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith("ek.")) continue;
    const value = localStorage.getItem(key);
    if (value != null) cache.set(key, value);
  }
}

function installShim() {
  const storage = Storage.prototype;
  const getItem = storage.getItem;
  const setItem = storage.setItem;
  const removeItem = storage.removeItem;
  storage.getItem = function (key: string) {
    if (key.startsWith("ek.")) return cache.get(key) ?? null;
    return getItem.call(this, key);
  };
  storage.setItem = function (key: string, value: string) {
    if (key.startsWith("ek.")) {
      cache.set(key, String(value));
      schedule();
      return;
    }
    setItem.call(this, key, value);
  };
  storage.removeItem = function (key: string) {
    if (key.startsWith("ek.")) {
      cache.delete(key);
      schedule();
      return;
    }
    removeItem.call(this, key);
  };
  window.addEventListener("pagehide", flush);
}

/** Load `app-state.json` before any module reads `localStorage`. */
export async function installAppState() {
  if (installed || !tauriReady()) return;
  installed = true;
  try {
    const saved = await invoke<Record<string, string>>("app_state_load");
    const keys = Object.keys(saved);
    if (keys.length === 0) seedFromWebKit();
    else for (const key of keys) cache.set(key, saved[key] ?? "");
    installShim();
    if (keys.length === 0 && cache.size > 0) flush();
  } catch (error) {
    installed = false;
    console.error("[ek] app state load failed", error);
  }
}
