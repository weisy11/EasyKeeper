import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/platform";
import type { SessionContext } from "./types";

function isSession(value: unknown): value is SessionContext {
  if (!value || typeof value !== "object") return false;
  const session = value as SessionContext;
  return (
    (session.mode === "prep" || session.mode === "play") &&
    typeof session.projectPath === "string" &&
    typeof session.name === "string" &&
    (session.kind === "scenario" || session.kind === "gameRecord") &&
    (session.modulePath === null || typeof session.modulePath === "string") &&
    typeof session.moduleEditable === "boolean"
  );
}

/** Copy the open project into the desktop process so a page reload can read it back. */
export async function rememberSession(session: SessionContext | null) {
  if (!isTauri) return;
  await invoke("session_set", { session });
}

/** Read the process copy. Empty after the app exits, or when the project folder is gone. */
export async function recallSession(): Promise<SessionContext | null> {
  if (!isTauri) return null;
  try {
    const session = await invoke<SessionContext | null>("session_get");
    return isSession(session) ? session : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}
