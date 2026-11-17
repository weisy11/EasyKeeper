import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "../lib/platform";
import { settingsStore, type GlobalSettings } from "../lib/store";

let started = false;
export function installSettingsSync() {
  if (started || !isTauri) return;
  started = true;
  settingsStore.subscribe(() => { void emit("ek:settings-updated", settingsStore.get()); });
  void listen<GlobalSettings>("ek:settings-updated", ({ payload }) => {
    if (JSON.stringify(settingsStore.get()) !== JSON.stringify(payload)) settingsStore.set(payload);
  });
}

export function applySettings(doc: Document) {
  const settings = settingsStore.get();
  doc.documentElement.lang = settings.locale === "zh" ? "zh-CN" : "en";
  doc.documentElement.classList.toggle("dark", settings.theme === "dark");
  doc.documentElement.style.fontSize = `${16 * settings.fontScale}px`;
  doc.documentElement.dataset.diceMuted = String(settings.diceMuted);
  doc.body.classList.add("bg-background", "text-foreground");
}
