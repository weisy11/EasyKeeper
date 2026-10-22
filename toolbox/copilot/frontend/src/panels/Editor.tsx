import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { copilotT, type CopilotStringKey } from "../i18n";
import { useCopilotLocale } from "../locale";
import { loadProviders, loadProxies, type ProviderView, type ProxyView } from "../store";
import { ProxyDialog } from "./Proxies";
import { ServiceForm, ServiceList } from "./Providers";

export function CopilotEditorDialog({ onClose }: { onClose: () => void }) {
  const locale = useCopilotLocale();
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [proxies, setProxies] = useState<ProxyView[]>([]);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderView | null | undefined>(undefined);

  useEffect(() => {
    void loadProviders().then(setProviders).catch(() => undefined);
    void loadProxies().then(setProxies).catch(() => undefined);
  }, []);

  const title = editing !== undefined ? (editing?.name || t("addService")) : t("editModels");
  const body =
    editing !== undefined ? (
      <ServiceForm
        key={editing?.name ?? "new"}
        locale={locale}
        provider={editing}
        proxies={proxies}
        onBack={() => setEditing(undefined)}
        onSaved={(next) => {
          setProviders(next);
          setEditing(undefined);
        }}
        onEditProxy={() => setProxyOpen(true)}
      />
    ) : (
      <ServiceList locale={locale} providers={providers} onAdd={() => setEditing(null)} onOpen={setEditing} onDeleted={setProviders} />
    );

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-full w-[min(440px,100%)] overflow-auto rounded-md border border-border bg-background p-4 text-[13px] text-foreground shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" aria-label={t("close")} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {body}
      </div>
      {proxyOpen ? (
        <ProxyDialog
          proxies={proxies}
          onClose={() => setProxyOpen(false)}
          onSaved={(next, close) => {
            setProxies(next);
            if (close) setProxyOpen(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
