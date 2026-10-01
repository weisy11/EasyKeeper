import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type Box = { x?: number; y?: number; width?: number; height?: number };

export function log(line: string) {
  console.log(line);
  if (isTauri) invoke("log_line", { line }).catch(() => {});
}

export async function queuePopout(tag: string, box: Box, relativeToMain = false) {
  if (isTauri) await invoke("queue_popout", { pending: { tag, ...box, relative: relativeToMain } });
}

export async function clearPopoutQueue() {
  if (isTauri) await invoke("clear_popout_queue");
}

export async function destroyWindow(label: string) {
  if (isTauri) return invoke<boolean>("destroy_window", { label });
  return false;
}

export async function focusWindow(label: string) {
  if (isTauri) return invoke<boolean>("focus_window", { label });
  return false;
}

export function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(event, (e) => cb(e.payload));
}

export async function resetMainWindowState() {
  if (isTauri) await invoke("reset_main_window_state");
}

export async function setMainWindowSize(width: number, height: number) {
  if (!isTauri) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function saveTextFile(defaultName: string, contents: string) {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: "EasyKeeper layout", extensions: ["json"] }] });
    if (!path) return null;
    await invoke("write_text_file", { path, contents });
    return path;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  a.download = defaultName;
  a.click();
  return defaultName;
}

export async function openTextFile(): Promise<{ path: string; contents: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "EasyKeeper layout", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return null;
    return { path, contents: await invoke<string>("read_text_file", { path }) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, contents: await f.text() } : null);
    };
    input.click();
  });
}
