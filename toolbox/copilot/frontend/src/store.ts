import { invoke } from "@tauri-apps/api/core";

export type ProviderView = {
  name: string;
  vendor: string;
  format: string;
  address: string;
  hasKey: boolean;
  models: string[];
  proxyId: string;
};

export type ProviderInput = {
  previousName?: string;
  name: string;
  vendor: string;
  format: string;
  address: string;
  apiKey?: string;
  models: string[];
  proxyId?: string;
};

export function loadProviders() {
  return invoke<ProviderView[]>("copilot_providers");
}

export function saveProvider(input: ProviderInput) {
  return invoke<ProviderView[]>("copilot_save_provider", { input });
}

export function deleteProvider(name: string) {
  return invoke<ProviderView[]>("copilot_delete_provider", { name });
}

export function completeChat(request: { requestId: string; service: string; model: string; messages: { role: string; text: string }[] }) {
  return invoke<string>("copilot_complete", { request });
}

export function stopChat(requestId: string) {
  return invoke<void>("copilot_stop", { requestId });
}

export function openCopilotEditor() {
  return invoke<void>("open_copilot_editor");
}

export function listModels(input: { service?: string; apiKey?: string; vendor: string; format: string; address: string; proxyId?: string }) {
  return invoke<string[]>("copilot_list_models", { input });
}

export type ProxyView = {
  id: string;
  name: string;
  protocol: "http" | "socks5";
  host: string;
  port: number;
  hasAuth: boolean;
};

export function loadProxies() {
  return invoke<ProxyView[]>("copilot_proxies");
}

export function saveProxy(input: { id: string; name: string; protocol: string; host: string; port: number; username?: string; password?: string }) {
  return invoke<ProxyView[]>("copilot_save_proxy", { input });
}

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Full prompt sent for this user turn. Not shown in the transcript. */
  prompt?: string;
  thinking?: string;
  thoughtSeconds?: number;
};

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

export type ChatRecord = ChatSummary & {
  messages: ChatMessageRecord[];
  /** Scenario this chat was started in. Empty when the chat has no module. */
  modulePath: string;
  moduleName: string;
  /** Provider service name and model id last used for this chat. Empty when none was chosen. */
  service: string;
  model: string;
};

export function listChats() {
  return invoke<ChatSummary[]>("copilot_chat_list");
}

export function loadChat(id: string) {
  return invoke<ChatRecord>("copilot_chat_load", { id });
}

export function saveChat(chat: ChatRecord) {
  return invoke<void>("copilot_chat_save", { chat });
}

export function loadModuleChat(modulePath: string) {
  return invoke<string | null>("copilot_module_chat_get", { modulePath });
}

export function saveModuleChat(modulePath: string, chatId: string) {
  return invoke<void>("copilot_module_chat_set", { modulePath, chatId });
}

export async function readModuleName(modulePath: string): Promise<string> {
  const fallback = folderName(modulePath);
  try {
    const file = await invoke<string>("join_path", { parent: modulePath, name: "scenario.ezkp" });
    const text = await invoke<string>("read_text_file", { path: file });
    const parsed = JSON.parse(text) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
  } catch {
    /* The folder name is enough when the manifest cannot be read. */
  }
  return fallback;
}

function folderName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
