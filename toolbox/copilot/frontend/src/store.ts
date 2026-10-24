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

/** Backend failures look like `code:detail`. The code picks the message; the detail (status line, body excerpt) is shown as-is. */
export function failureParts(error: unknown): { code: string; detail: string } {
  const text = String(error);
  const split = text.indexOf(":");
  if (split < 0) return { code: text, detail: "" };
  return { code: text.slice(0, split), detail: text.slice(split + 1).trim() };
}

/** The newest user turn must already be appended; Rust reads the context from the chat. */
export function completeChat(request: { requestId: string; chatId: string; service: string; model: string }) {
  return invoke<string>("copilot_complete", { request });
}

export function stopChat(requestId: string) {
  return invoke<void>("copilot_stop", { requestId });
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

export type StoredMessage = ChatMessageRecord & { pos: number };

/** Chat-level fields, sent with every append so the row exists before its first message. */
export type ChatMeta = {
  id: string;
  title: string;
  /** Scenario this chat was started in. Empty when the chat has no module. */
  modulePath: string;
  moduleName: string;
  /** Provider service name and model id last used for this chat. Empty when none was chosen. */
  service: string;
  model: string;
};

/** The latest rolling summary: everything up to `coversTo` is sent to the model as this text. */
export type ContextSummary = { coversTo: number; text: string };

export type ChatOpen = ChatMeta & {
  updatedAt: number;
  total: number;
  /** Newest page, in chat order. */
  messages: StoredMessage[];
  summary: ContextSummary | null;
};

export function listChats() {
  return invoke<ChatSummary[]>("copilot_chat_list");
}

/** `null` when the chat does not exist on this machine. */
export function openChatRecord(id: string) {
  return invoke<ChatOpen | null>("copilot_chat_open", { id });
}

/** Delete a chat with its messages and summaries. False when there was nothing to delete. */
export function deleteChat(id: string) {
  return invoke<boolean>("copilot_chat_delete", { id });
}

/** Up to one page of messages older than `before`, in chat order. */
export function olderMessages(id: string, before: number) {
  return invoke<StoredMessage[]>("copilot_chat_messages", { id, before });
}

/** Append one turn; returns its position. Messages are never edited afterwards. */
export function appendMessage(meta: ChatMeta, message: ChatMessageRecord) {
  return invoke<number>("copilot_message_append", { meta, message });
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
