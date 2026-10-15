import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import { controllers } from "@/layout";
import { loadedToolsStore } from "@/tools/allowed";
import { closeTool } from "@/tools/loader";
import { rememberSession } from "./launchSession";
import { sessionStore } from "./sessionStore";

let closing = false;

/** Leave the open project, release its runtime, and return to the welcome page. */
export async function closeOpenProject() {
  if (closing) return;
  const session = sessionStore.get();
  if (!session) return;
  closing = true;
  try {
    const pending: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent("ek:flush-pages", { detail: { pending } }));
    await Promise.all(pending);
    for (const controller of controllers.values()) controller.beginClose();
    for (const id of Object.keys(loadedToolsStore.get().byId)) {
      await closeTool(id);
    }
    if (isTauri) {
      const paths = [session.projectPath];
      if (session.modulePath && session.modulePath !== session.projectPath) paths.push(session.modulePath);
      await invoke("close_project_connections", { paths });
      await invoke("close_popout_windows");
    }
    sessionStore.set(null);
    await rememberSession(null);
  } finally {
    closing = false;
  }
}
