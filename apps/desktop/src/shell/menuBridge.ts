import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { activeController, allDocuments, onEachDocument } from "../layout";
import { isTauri } from "../lib/platform";
import { settingsStore } from "../lib/store";
import { recentStore } from "../project/recent";
import { sessionStore } from "../project/sessionStore";
import { closeOpenProject } from "../project/closeProject";
import { applyCurrentForm, currentSaveButton, hasOpenForm } from "./formCommands";
import { projectActionStore, type ProjectAction } from "./projectActions";
import { installSettingsSync } from "./settingsSync";

let started = false;
let navigating = false;
export function installMenuBridge() {
  if (started || !isTauri) return;
  started = true;
  installSettingsSync();
  let frame = 0;
  let lastState = "";
  const refresh = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const recent = recentStore.get();
      const state = {
        ...settingsStore.get(), projectOpen: sessionStore.get() !== null,
        canSave: currentSaveButton(allDocuments()) !== null,
        recent: [...recent.recentScenario, ...recent.recentRecords].sort((a, b) => b.openedAt - a.openedAt),
      };
      const serialized = JSON.stringify(state);
      if (serialized === lastState) return;
      lastState = serialized;
      void invoke("update_app_menu", { state }).catch((error) => { lastState = ""; console.error(error); });
    });
  };
  settingsStore.subscribe(refresh);
  recentStore.subscribe(refresh);
  sessionStore.subscribe(refresh);
  onEachDocument((doc) => {
    const observer = new MutationObserver(refresh);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "data-ek-save"] });
    doc.addEventListener("focusin", refresh);
    doc.addEventListener("ek:dice-muted-change", ((event: CustomEvent<boolean>) => {
      if (settingsStore.get().diceMuted !== event.detail) settingsStore.set((state) => ({ ...state, diceMuted: event.detail }));
    }) as EventListener);
  });
  void listen("ek:save-form", () => applyCurrentForm(allDocuments()));
  void listen<{ id: string; path?: string; kind?: "scenario" | "gameRecord" }>("ek:menu-action", ({ payload }) => {
    const { id } = payload;
    if (id === "dice") { void activeController()?.openDice(); return; }
    if (id === "theme-light" || id === "theme-dark") { lastState = ""; settingsStore.set((state) => ({ ...state, theme: id === "theme-light" ? "light" : "dark" })); return; }
    if (id === "dice-mute") { settingsStore.set((state) => ({ ...state, diceMuted: !state.diceMuted })); return; }
    if (id.startsWith("font-")) {
      settingsStore.set((state) => ({ ...state, fontScale: id === "font-reset" ? 1 : Math.max(0.8, Math.min(1.4, +(state.fontScale + (id === "font-increase" ? 0.1 : -0.1)).toFixed(2))) }));
      return;
    }
    if (!["create-scenario", "open-scenario", "create-record", "open-record", "close-project"].includes(id) && !id.startsWith("recent-")) return;
    if (navigating || projectActionStore.get()) return;
    navigating = true;
    void (async () => {
      try {
        if (hasOpenForm(allDocuments())) {
          const en = settingsStore.get().locale === "en";
          const proceed = await confirm(en ? "Switching projects closes the current editing form. Any changes not yet saved will be discarded. Continue?" : "切换项目会关闭当前编辑表单，尚未保存的修改将被丢弃。是否继续？", {
            title: en ? "Close Editing Form" : "关闭当前表单", kind: "warning", okLabel: en ? "Continue" : "继续", cancelLabel: en ? "Cancel" : "取消",
          });
          if (!proceed) return;
        }
        if (id === "close-project") await closeOpenProject();
        else projectActionStore.set({ ...payload, id: id.startsWith("recent-") ? "recent" : id as ProjectAction["id"], token: crypto.randomUUID() });
      } finally { navigating = false; }
    })().catch(console.error);
  });
  refresh();
}
