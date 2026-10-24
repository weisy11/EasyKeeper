import { invoke } from "@tauri-apps/api/core";
import { controllers } from "@/layout";
import { flushAppKv } from "./appKv";

/**
 * Rust holds the window open until `finish_app_close` is called (or a short grace period ends).
 * Flush every debounced writer here: layout autosave, rich-text pages, tool buffers, then app settings.
 * Tools that buffer writes listen for `ek:flush` and push their promises into `detail.pending`.
 */
export async function flushBeforeClose() {
  for (const controller of controllers.values()) controller.saveNow();
  const pending: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent("ek:flush-pages", { detail: { pending } }));
  window.dispatchEvent(new CustomEvent("ek:flush", { detail: { pending } }));
  await Promise.allSettled(pending);
  await flushAppKv();
}

export async function onAppClosing() {
  try {
    await flushBeforeClose();
  } catch (error) {
    console.error("[ek] flush before close failed", error);
  } finally {
    await invoke("finish_app_close").catch(() => undefined);
  }
}
