import { useState } from "react";
import { createPortal } from "react-dom";
import { copilotT, type CopilotStringKey } from "../i18n";
import { useCopilotLocale } from "../locale";
import { saveProxy, type ProxyView } from "../store";

type Draft = {
  id: string;
  name: string;
  protocol: "http" | "socks5";
  host: string;
  port: string;
  username: string;
  password: string;
  hasAuth: boolean;
};

const control = "h-8 min-w-0 rounded border border-border bg-background px-2 outline-none";
const button = "h-8 rounded-md border border-border px-3 hover:bg-muted disabled:opacity-40";

function blank(): Draft {
  return { id: crypto.randomUUID(), name: "", protocol: "socks5", host: "127.0.0.1", port: "7897", username: "", password: "", hasAuth: false };
}

function fromProxy(proxy: ProxyView): Draft {
  return {
    id: proxy.id,
    name: proxy.name,
    protocol: proxy.protocol === "http" ? "http" : "socks5",
    host: proxy.host,
    port: String(proxy.port),
    username: "",
    password: "",
    hasAuth: proxy.hasAuth,
  };
}

export function ProxyDialog({ proxies, onClose, onSaved }: { proxies: ProxyView[]; onClose: () => void; onSaved: (proxies: ProxyView[], close: boolean) => void }) {
  const locale = useCopilotLocale();
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [items, setItems] = useState(proxies);
  const [draft, setDraft] = useState<Draft>(blank);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function rememberDraft(current: ProxyView[]) {
    const port = Number(draft.port);
    return current.map((item) =>
      item.id === draft.id ? { ...item, name: draft.name, protocol: draft.protocol, host: draft.host, port: Number.isInteger(port) ? port : item.port, hasAuth: draft.hasAuth } : item,
    );
  }

  function choose(proxy: ProxyView) {
    setItems(rememberDraft);
    setDraft(fromProxy(proxy));
    setAuthOpen(false);
    setError("");
  }

  async function commit(close: boolean) {
    const name = draft.name.trim();
    const host = draft.host.trim();
    const port = Number(draft.port);
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      if (close && !name && !host && !draft.port && !items.some((item) => item.id === draft.id)) {
        onClose();
        return;
      }
      setError(t("badProxy"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await saveProxy({
        id: draft.id,
        name,
        protocol: draft.protocol,
        host,
        port,
        username: draft.username,
        password: draft.password,
      });
      setItems((current) => {
        const pending = current.filter((item) => !next.some((saved) => saved.id === item.id));
        return [...next, ...pending];
      });
      const saved = next.find((item) => item.id === draft.id);
      if (saved) setDraft(fromProxy(saved));
      onSaved(next, close);
    } catch (err) {
      const code = String(err);
      if (code.includes("duplicate-name")) setError(t("duplicateName"));
      else if (code.includes("empty-name")) setError(t("emptyName"));
      else setError(t("badProxy"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label={t("editProxy")}
        className="w-[min(560px,100%)] rounded-md border border-border bg-background p-4 text-[13px] text-foreground shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">{t("editProxy")}</h2>
        <div className="h-32 overflow-y-auto rounded-md border border-border">
          {items.map((proxy) => (
            <button key={proxy.id} type="button" className={`block h-8 w-full truncate px-2 text-left hover:bg-blue-500/15 ${proxy.id === draft.id ? "bg-blue-500 text-white" : ""}`} onClick={() => choose(proxy)}>
              {(proxy.id === draft.id ? draft.name : proxy.name) || t("unnamed")}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 h-8 rounded-md border border-border px-2 text-left hover:bg-muted"
          onClick={() => {
            const created = blank();
            setItems((current) => [...rememberDraft(current), { id: created.id, name: "", protocol: created.protocol, host: created.host, port: Number(created.port), hasAuth: false }]);
            setDraft(created);
            setAuthOpen(false);
            setError("");
          }}
        >
          {t("addProxy")}
        </button>
        <div className="mt-3 grid grid-cols-[1fr_6.5rem_1.2fr_4.5rem_1.75rem] gap-x-2 gap-y-1">
          <span className="text-muted-foreground">{t("name")}</span>
          <span className="text-muted-foreground">{t("proxyProtocol")}</span>
          <span className="text-muted-foreground">{t("proxyHost")}</span>
          <span className="text-muted-foreground">{t("proxyPort")}</span>
          <span />
          <input className={control} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <select className={control} value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value === "http" ? "http" : "socks5" })}>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
          <input className={control} value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
          <input className={control} value={draft.port} inputMode="numeric" onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
          <button type="button" className="grid h-8 w-7 place-items-center rounded border border-border text-muted-foreground hover:bg-muted" aria-label={t("auth")} aria-pressed={authOpen} onClick={() => setAuthOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="1.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </button>
        </div>
        {authOpen ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t("proxyUser")}</span>
              <input className={control} value={draft.username} placeholder={draft.hasAuth ? t("savedKey") : ""} autoComplete="off" onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t("proxyPassword")}</span>
              <input className={control} type="password" value={draft.password} placeholder={draft.hasAuth ? t("savedKey") : ""} autoComplete="off" onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            </label>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-destructive">{error}</p> : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" className={button} disabled={saving} onClick={() => void commit(false)}>
            {t("apply")}
          </button>
          <button type="button" className={button} onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="button" className="h-8 rounded-md border border-foreground bg-foreground px-3 text-background disabled:opacity-40" disabled={saving} onClick={() => void commit(true)}>
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
