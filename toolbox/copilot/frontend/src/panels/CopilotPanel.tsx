import type { ToolPanelProps } from "@ek/tool-api";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { copilotT, type CopilotLocale, type CopilotStringKey } from "../i18n";
import { useCopilotLocale } from "../locale";
import { completeChat, listChats, loadChat, loadModuleChat, loadProviders, readModuleName, saveChat, saveModuleChat, stopChat, type ChatSummary, type ProviderView } from "../store";
import { contextMessage } from "../contextPrompt";
import { ContextDialog, defaultContextTags, type ContextTag } from "./ContextDialog";
import { PromptTemplateDialog } from "./PromptTemplateDialog";
import { activePromptBody, defaultPromptLibrary, type PromptLibrary } from "../promptTemplates";
import { CopilotEditorDialog } from "./Editor";
import { MarkdownText } from "./Markdown";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  prompt?: string;
  thinking?: string;
  thoughtSeconds?: number;
};

type ChatOrigin = { path: string; name: string };

function folderName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function sameModel(vendor: string, listed: string, saved: string) {
  const bare = (id: string) => (vendor === "gemini" ? id.replace(/^models\//, "") : id);
  return bare(listed) === bare(saved);
}

function samePath(a: string, b: string) {
  return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
}

function originFrom(path: string, name: string): ChatOrigin | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  return { path: trimmed, name: name.trim() || folderName(trimmed) };
}

function sameTags(left: ContextTag[], right: ContextTag[]) {
  return left.length === right.length && left.every((tag, index) => tag.kind === right[index]?.kind && tag.id === right[index]?.id && tag.label === right[index]?.label);
}

function visibleComposerText(root: HTMLElement | null) {
  return (root?.innerText ?? "").replaceAll("\u200B", "").replace(/\u00a0/g, " ");
}

function mentionText(root: HTMLElement | null) {
  if (!root) return "";
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? "").replaceAll("\u200B", "").replace(/\u00a0/g, " "));
      return;
    }
    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach(walk);
      return;
    }
    const kind = node.dataset.kind;
    const id = node.dataset.id;
    if (id && (kind === "scene" || kind === "actor" || kind === "article")) {
      const name = (node.textContent ?? "").replace(/^@/, "").trim();
      parts.push(`[[${kind}:${id}|${name}]]`);
      return;
    }
    if (node.tagName === "BR") {
      parts.push("\n");
      return;
    }
    if ((node.tagName === "DIV" || node.tagName === "P") && parts.length > 0 && !parts[parts.length - 1]?.endsWith("\n")) parts.push("\n");
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return parts.join("").trim();
}

function textBeforeCaret(root: HTMLElement | null) {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!root || !selection || selection.rangeCount === 0 || !node || !root.contains(node)) return "";
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(node, selection.anchorOffset);
  return range.toString().replaceAll("\u200B", "").replace(/\u00a0/g, " ");
}

function mentionChoices(tags: ContextTag[], query: string) {
  const needle = query.trim().toLowerCase();
  return tags.filter((tag) => tag.label.toLowerCase().includes(needle));
}

function chatStamp(updatedAt: number) {
  const date = new Date(updatedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function chatTitle(messages: Message[], fallback: string) {
  const text = messages.find((message) => message.role === "user")?.text.trim() ?? "";
  if (!text) return fallback;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function thoughtLabel(locale: CopilotLocale, seconds?: number) {
  if (!seconds) return locale === "zh" ? "思考过程" : "Thought";
  return locale === "zh" ? `思考了 ${seconds} 秒` : `Thought for ${seconds}s`;
}

function ThoughtRow({ label, text, live }: { label: string; text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className={live ? "animate-pulse" : ""}>{label}</span>
      </button>
      {open ? <p className="mt-1 whitespace-pre-wrap pl-4 text-xs text-muted-foreground">{text}</p> : null}
    </div>
  );
}

type Selection = {
  service: string;
  model: string;
};

export function CopilotPanel({ projectPath, modulePath, mode, loadModuleData }: ToolPanelProps) {
  const moduleDir = (modulePath?.trim() || (mode === "prep" ? projectPath.trim() : "")).replace(/[\\/]+$/, "");
  const [contextOpen, setContextOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptLibrary, setPromptLibrary] = useState<PromptLibrary>(defaultPromptLibrary);
  const [contextTags, setContextTags] = useState<ContextTag[]>([]);
  const contextCustom = useRef(false);
  const contextSceneId = useRef<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const locale = useCopilotLocale();
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [remembered, setRemembered] = useState<Selection | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const menuBoxRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatOrigin, setChatOrigin] = useState<ChatOrigin | null>(null);
  const [moduleName, setModuleName] = useState("");
  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{ id: string; title: string; updatedAt: number; messages: Message[]; modulePath: string; moduleName: string; service: string; model: string } | null>(null);
  const touchedRef = useRef(false);
  const [replying, setReplying] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    contextCustom.current = false;
    contextSceneId.current = null;
    let busy = false;
    let loadedScene: string | null = null;
    const refresh = async () => {
      if (busy) return;
      const source = await loadModuleData?.("ek.scenario");
      if (!alive) return;
      if (!source || !moduleDir) {
        setContextTags([]);
        loadedScene = null;
        return;
      }
      const current = await source.currentScene(moduleDir);
      if (!alive) return;
      const id = current?.id ?? "";
      if (contextSceneId.current !== id) {
        if (contextSceneId.current !== null) contextCustom.current = false;
        contextSceneId.current = id;
        loadedScene = null;
      }
      if (contextCustom.current || loadedScene === id) return;
      busy = true;
      try {
        const [tree, actors, articles] = await Promise.all([source.listScenes(moduleDir), source.listActors(moduleDir), source.listArticles(moduleDir)]);
        if (!alive || contextCustom.current) return;
        const latest = (await source.currentScene(moduleDir))?.id ?? "";
        if (!alive || contextCustom.current || latest !== id) return;
        const next = defaultContextTags(tree, actors, articles, latest);
        loadedScene = id;
        setContextTags((existing) => (sameTags(existing, next) ? existing : next));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loadModuleData, moduleDir]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadProviders()
        .then((loaded) => {
          if (alive) setProviders(loaded);
        })
        .catch(() => undefined);
    };
    load();
    let unlisten = () => {};
    void listen("copilot-providers-changed", load).then((stop) => {
      if (alive) unlisten = stop;
      else stop();
    });
    return () => {
      alive = false;
      unlisten();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const requestId = requestRef.current;
    if (requestId) void stopChat(requestId);
    touchedRef.current = false;
    flushChat();
    setMessages([]);
    setChatId(null);
    setChatOrigin(null);
    setHistoryOpen(false);
    void (async () => {
      const list = await listChats().catch(() => [] as ChatSummary[]);
      if (!alive) return;
      setChatList(list);
      const name = moduleDir ? await readModuleName(moduleDir).catch(() => folderName(moduleDir)) : "";
      if (!alive || touchedRef.current) return;
      setModuleName(name);
      if (!moduleDir) {
        setChatId(crypto.randomUUID());
        return;
      }
      const lastId = await loadModuleChat(moduleDir).catch(() => null);
      if (!alive || touchedRef.current) return;
      if (lastId) {
        try {
          const chat = await loadChat(lastId);
          if (!alive || touchedRef.current) return;
          setChatId(chat.id);
          setMessages(chat.messages);
          setChatOrigin(originFrom(chat.modulePath, chat.moduleName));
          restoreModel(chat.service, chat.model, chat.messages.length > 0);
          return;
        } catch {
          /* The module remembered a chat that is no longer on this machine. */
        }
      }
      if (!alive || touchedRef.current) return;
      setChatId(crypto.randomUUID());
      setChatOrigin(originFrom(moduleDir, name));
    })();
    return () => {
      alive = false;
    };
  }, [moduleDir]);

  function restoreModel(service: string, model: string, hasMessages: boolean) {
    if (service && model) {
      setRemembered({ service, model });
      return;
    }
    setRemembered(null);
    if (hasMessages) setSelection(null);
  }

  function flushChat() {
    const snapshot = pendingRef.current;
    if (!snapshot) return;
    pendingRef.current = null;
    void saveChat(snapshot).then(() =>
      setChatList((current) => [
        { id: snapshot.id, title: snapshot.title, updatedAt: snapshot.updatedAt },
        ...current.filter((item) => item.id !== snapshot.id),
      ]),
    );
  }

  useEffect(() => {
    if (!chatId || messages.length === 0) return;
    const title = chatTitle(messages, copilotT(locale, "newChat"));
    pendingRef.current = {
      id: chatId,
      title,
      updatedAt: Date.now(),
      messages,
      modulePath: chatOrigin?.path ?? "",
      moduleName: chatOrigin?.name ?? "",
      service: (remembered ?? selection)?.service ?? "",
      model: (remembered ?? selection)?.model ?? "",
    };
    const handle = window.setTimeout(flushChat, 300);
    return () => window.clearTimeout(handle);
  }, [chatId, messages, locale, chatOrigin, selection, remembered]);

  useEffect(() => {
    if (!remembered || providers.length === 0) return;
    const provider = providers.find((item) => item.name === remembered.service && item.models.some((model) => sameModel(item.vendor, model, remembered.model)));
    if (provider) {
      const model = provider.models.find((model) => sameModel(provider.vendor, model, remembered.model)) ?? remembered.model;
      setSelection({ service: provider.name, model });
    }
    else {
      setRemembered(null);
      setSelection(null);
    }
  }, [remembered, providers]);

  useEffect(() => {
    if (!moduleDir || !chatId) return;
    void saveModuleChat(moduleDir, chatId);
  }, [moduleDir, chatId]);

  useEffect(() => {
    const onHide = () => {
      const snapshot = pendingRef.current;
      if (snapshot) void saveChat(snapshot);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: MouseEvent) => {
      if (historyRef.current?.contains(event.target as Node)) return;
      setHistoryOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [historyOpen]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, replying]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      setHovered(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function keepCaretTarget() {
    const root = composerRef.current;
    if (!root || visibleComposerText(root).length > 0) return;
    if (root.childNodes.length === 0) root.appendChild(document.createElement("br"));
    const range = document.createRange();
    range.setStart(root, 0);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  useEffect(() => {
    if (!composerFocused) return;
    const frame = requestAnimationFrame(() => keepCaretTarget());
    return () => cancelAnimationFrame(frame);
  }, [composerFocused]);

  function stripCaretMarks() {
    const root = composerRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const offset = selection?.anchorOffset ?? 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const current = node;
      node = walker.nextNode() as Text | null;
      if (!current.data.includes("\u200B")) continue;
      const removedBefore = anchor === current ? current.data.slice(0, offset).split("\u200B").length - 1 : 0;
      current.data = current.data.replaceAll("\u200B", "");
      if (anchor === current && selection && current.data.length > 0) {
        const range = document.createRange();
        range.setStart(current, Math.min(Math.max(0, offset - removedBefore), current.data.length));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (!current.data) current.remove();
    }
  }

  function composerText() {
    return visibleComposerText(composerRef.current).trim() || draft.replaceAll("\u200B", "").trim();
  }

  function syncComposer() {
    const text = visibleComposerText(composerRef.current);
    setDraft(text);
    const before = textBeforeCaret(composerRef.current);
    const match = /@([^\s@]*)$/.exec(before);
    setMentionQuery(match && contextTags.length > 0 ? match[1] : null);
    setMentionIndex(0);
  }

  function insertMention(tag: ContextTag) {
    const root = composerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      const at = value.slice(0, range.startOffset).lastIndexOf("@");
      if (at >= 0) {
        range.setStart(node, at);
        range.deleteContents();
      }
    }
    const link = document.createElement("span");
    link.contentEditable = "false";
    link.dataset.kind = tag.kind;
    link.dataset.id = tag.id;
    link.className = "text-blue-500";
    link.textContent = `@${tag.label}`;
    range.insertNode(link);
    const space = document.createTextNode("\u00a0");
    link.after(space);
    const caret = document.createRange();
    caret.setStart(space, 1);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    setMentionQuery(null);
    setDraft(root.innerText.replace(/\u00a0/g, " "));
  }

  function send() {
    touchedRef.current = true;
    const text = composerText();
    const asked = mentionText(composerRef.current);
    const tags = contextTags;
    const template = activePromptBody(promptLibrary, locale);
    if (!text || replying) return;
    const userId = crypto.randomUUID();
    const user: Message = { id: userId, role: "user", text };
    const history = [...messages, user];
    setMessages(history);
    setDraft("");
    setMentionQuery(null);
    if (composerRef.current) composerRef.current.innerHTML = "";
    if (!selection) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: t("pickModel") }]);
      return;
    }
    const chosen = selection;
    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    requestRef.current = requestId;
    setMessages((current) => [...current, { id: assistantId, role: "assistant", text: "" }]);
    setReplying(true);
    const gate = { open: true };
    let thoughtStart: number | null = null;
    let thoughtSeconds: number | undefined;
    const freezeThought = () => {
      if (thoughtStart == null) return;
      thoughtSeconds = Math.max(1, Math.round((Date.now() - thoughtStart) / 1000));
      thoughtStart = null;
    };
    void listen<{ requestId: string; kind?: string; delta: string }>("copilot-stream", (event) => {
      if (!gate.open || event.payload.requestId !== requestId || !event.payload.delta) return;
      const kind = event.payload.kind ?? "text";
      if (kind === "thinking") {
        if (thoughtStart == null) thoughtStart = Date.now();
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, thinking: `${message.thinking ?? ""}${event.payload.delta}` } : message)));
        return;
      }
      freezeThought();
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, text: message.text + event.payload.delta, thoughtSeconds: thoughtSeconds ?? message.thoughtSeconds } : message,
        ),
      );
    }).then(async (unlisten) => {
      try {
        const source = await loadModuleData?.("ek.scenario");
        const prompt = await contextMessage(source, moduleDir, tags, asked, template);
        setMessages((current) => current.map((message) => (message.id === userId ? { ...message, prompt } : message)));
        const reply = await completeChat({
          requestId,
          service: chosen.service,
          model: chosen.model,
          messages: history.map((message, index) => ({
            role: message.role,
            text: index === history.length - 1 ? prompt : message.text,
          })),
        });
        gate.open = false;
        freezeThought();
        setMessages((current) => {
          const message = current.find((item) => item.id === assistantId);
          if (!reply.trim() && !message?.thinking) return current.filter((item) => item.id !== assistantId);
          return current.map((item) => (item.id === assistantId ? { ...item, text: reply, thoughtSeconds: thoughtSeconds ?? item.thoughtSeconds } : item));
        });
      } catch (error: unknown) {
        gate.open = false;
        freezeThought();
        const code = String(error);
        const text = code.includes("no-key") ? t("noKey") : code.includes("no-model") ? t("pickModel") : t("callFailed");
        setMessages((current) => current.map((message) => (message.id === assistantId && message.text === "" && !message.thinking ? { ...message, text } : message)));
      } finally {
        gate.open = false;
        if (requestRef.current === requestId) requestRef.current = null;
        unlisten();
        setReplying(false);
      }
    });
  }

  function startNewChat() {
    if (replying) return;
    touchedRef.current = true;
    flushChat();
    setHistoryOpen(false);
    setMessages([]);
    setChatOrigin(originFrom(moduleDir, moduleName));
    setChatId(crypto.randomUUID());
  }

  function openHistoryChat(id: string) {
    if (replying || id === chatId) {
      setHistoryOpen(false);
      return;
    }
    flushChat();
    void loadChat(id).then((chat) => {
      setChatId(chat.id);
      setMessages(chat.messages);
      setChatOrigin(originFrom(chat.modulePath, chat.moduleName));
      restoreModel(chat.service, chat.model, chat.messages.length > 0);
      setHistoryOpen(false);
    });
  }

  function stop() {
    const requestId = requestRef.current;
    if (requestId) void stopChat(requestId);
  }

  const hoveredProvider = providers.find((provider) => provider.name === hovered);
  const foreignModule = chatOrigin && moduleDir && !samePath(chatOrigin.path, moduleDir) ? chatOrigin.name : "";
  const mentionItems = mentionQuery === null ? [] : mentionChoices(contextTags, mentionQuery);
  const mentionActive = Math.min(mentionIndex, Math.max(mentionItems.length - 1, 0));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[13px] text-foreground">
      <div className="flex shrink-0 items-center justify-end gap-1 px-2 py-1">
        <button type="button" disabled={replying} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={startNewChat}>
          {t("newChat")}
        </button>
        <div ref={historyRef} className="relative">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {t("history")}
          </button>
          {historyOpen ? (
            <div className="absolute right-0 z-30 mt-1 w-[28rem] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
              <div className="max-h-[40rem] overflow-y-auto">
                {chatList.length === 0 ? <p className="px-3 py-2 text-muted-foreground">{t("emptyHistory")}</p> : null}
                {chatList.map((chat) => (
                  <button key={chat.id} type="button" className={`flex h-8 w-full items-center gap-3 px-3 text-left hover:bg-muted ${chat.id === chatId ? "bg-muted" : ""}`} onClick={() => openHistoryChat(chat.id)}>
                    <span className="min-w-0 flex-1 truncate">{chat.title || t("newChat")}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{chatStamp(chat.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div ref={threadRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {messages.length === 0 ? <p className="text-muted-foreground">{t("emptyChat")}</p> : null}
        <div className="flex flex-col gap-3">
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="max-w-[90%] self-end whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-1.5">
                {message.text}
              </div>
            ) : (
              <div key={message.id} className="max-w-[90%] min-w-0 self-start">
                {message.thinking ? (
                  <ThoughtRow
                    label={replying && message.id === messages.at(-1)?.id && message.thoughtSeconds == null ? t("thinking") : thoughtLabel(locale, message.thoughtSeconds)}
                    text={message.thinking}
                    live={replying && message.id === messages.at(-1)?.id && message.thoughtSeconds == null}
                  />
                ) : null}
                {message.text ? <MarkdownText text={message.text} /> : null}
              </div>
            ),
          )}
          {replying && messages.at(-1)?.text === "" && !messages.at(-1)?.thinking ? <p className="text-muted-foreground">{t("sending")}</p> : null}
        </div>
      </div>
      {foreignModule ? <p className="shrink-0 border-t border-border px-3 py-2 text-xs leading-5 text-destructive">{t("crossModule").replaceAll("{name}", foreignModule)}</p> : null}
      <form
        className="flex shrink-0 flex-col gap-2 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-3 py-2">
          <div className="relative min-w-0 overflow-hidden">
            {draft.trim() === "" && !composerFocused ? <span className="pointer-events-none absolute top-1 left-0 text-muted-foreground">{t("placeholder")}</span> : null}
            <div
              ref={composerRef}
              role="textbox"
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              className="max-h-32 min-h-[3.75rem] w-full min-w-0 cursor-text overflow-x-hidden overflow-y-auto bg-card py-1 pr-2 leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-foreground outline-none"
              style={{ caretColor: "var(--foreground)" }}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onInput={() => {
                if (visibleComposerText(composerRef.current).length > 0) stripCaretMarks();
                syncComposer();
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  setMentionQuery(null);
                  return;
                }
                if (mentionItems.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex((index) => (index + step + mentionItems.length) % mentionItems.length);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  const picked = mentionItems[mentionActive];
                  if (picked) {
                    event.preventDefault();
                    insertMention(picked);
                    return;
                  }
                  event.preventDefault();
                  send();
                }
              }}
            />
            {mentionItems.length > 0 ? (
              <div className="absolute bottom-full left-0 z-30 mb-1 max-h-40 w-56 overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
                {mentionItems.map((tag, index) => (
                  <button
                    key={`${tag.kind}:${tag.id}`}
                    type="button"
                    className={`block h-8 w-full truncate px-3 text-left hover:bg-muted ${index === mentionActive ? "bg-muted" : ""}`}
                    ref={index === mentionActive ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => insertMention(tag)}
                  >
                    @{tag.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
          <div ref={menuRef} className="relative shrink-0">
            <button type="button" aria-label={t("model")} aria-expanded={menuOpen} className="flex h-7 max-w-36 items-center gap-1 text-xs text-muted-foreground" onClick={() => setMenuOpen((open) => !open)}>
              <span className="truncate">{selection?.model ?? t("model")}</span>
              <svg viewBox="0 0 24 24" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {menuOpen ? (
              <div ref={menuBoxRef} className="absolute right-0 bottom-full z-20 mb-2" onMouseLeave={() => setHovered(null)}>
                <div className="relative min-w-44 rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
                  <div className="max-h-40 overflow-y-auto">
                    {providers.map((provider) => (
                      <button
                        key={provider.name}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-muted"
                        onMouseEnter={(event) => {
                          const box = menuBoxRef.current;
                          if (box) setFlyoutTop(event.currentTarget.getBoundingClientRect().top - box.getBoundingClientRect().top);
                          setHovered(provider.name);
                        }}
                      >
                        <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M15 6l-6 6 6 6" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                      </button>
                    ))}
                  </div>
                  {providers.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
                  <button
                    type="button"
                    className="block h-8 w-full px-3 text-left text-muted-foreground hover:bg-muted"
                    onMouseEnter={() => setHovered(null)}
                    onClick={() => {
                      setMenuOpen(false);
                      setHovered(null);
                      setEditorOpen(true);
                    }}
                  >
                    {t("editModels")}
                  </button>
                </div>
                {hoveredProvider ? (
                  <div className="absolute right-full z-20" style={{ top: hoveredProvider.models.length > 1 ? flyoutTop + 16 - Math.min(hoveredProvider.models.length, 5) * 16 : flyoutTop }}>
                  <div className="max-h-40 min-w-40 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                    {hoveredProvider.models.length === 0 ? <p className="px-3 py-1.5 text-muted-foreground">{t("noModels")}</p> : null}
                    {hoveredProvider.models.map((model) => {
                      const selected = selection?.service === hoveredProvider.name && selection.model === model;
                      return (
                        <button
                          key={model}
                          type="button"
                          className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-muted"
                          onClick={() => {
                            const next = { service: hoveredProvider.name, model };
                            setSelection(next);
                            setRemembered(next);
                            setMenuOpen(false);
                            setHovered(null);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{model}</span>
                          {selected ? (
                            <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <button type="button" aria-label={t("addContext")} className="grid size-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setContextOpen(true)}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type={replying ? "button" : "submit"}
            aria-label={replying ? t("stop") : t("send")}
            disabled={!replying && !draft.trim()}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:opacity-30"
            onClick={replying ? stop : undefined}
          >
            {replying ? (
              <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="M6 11l6-6 6 6" />
              </svg>
            )}
          </button>
          </div>
        </div>
      </form>
      {editorOpen ? <CopilotEditorDialog onClose={() => setEditorOpen(false)} /> : null}
      {advancedOpen ? (
        <PromptTemplateDialog
          library={promptLibrary}
          onApply={setPromptLibrary}
          onConfirm={(next) => {
            setPromptLibrary(next);
            setAdvancedOpen(false);
          }}
          onClose={() => setAdvancedOpen(false)}
        />
      ) : null}
      {contextOpen ? (
        <ContextDialog
          moduleDir={moduleDir}
          loadModuleData={loadModuleData}
          template={activePromptBody(promptLibrary, locale)}
          selected={contextTags}
          onClose={() => setContextOpen(false)}
          onAdvanced={() => setAdvancedOpen(true)}
          onConfirm={(tags) => {
            contextCustom.current = true;
            setContextTags(tags);
            setContextOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
