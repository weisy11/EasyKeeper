import { useEffect, useState, type ReactNode } from "react";
import { copilotT, type CopilotLocale, type CopilotStringKey } from "../i18n";
import { deleteProvider, failureParts, listModels, saveProvider, type ProviderView, type ProxyView } from "../store";
import { FORMATS, VENDORS, addressFor, isFormat, isVendor } from "../vendors";

const vendorKey: Record<(typeof VENDORS)[number], CopilotStringKey> = {
  gemini: "vendorGemini",
  deepseek: "vendorDeepseek",
  "minimax-cn": "vendorMinimaxCn",
  minimax: "vendorMinimax",
  openai: "vendorOpenai",
  custom: "vendorCustom",
};

const formatKey: Record<(typeof FORMATS)[number], CopilotStringKey> = {
  chat: "formatChat",
  responses: "formatResponses",
  interactions: "formatInteractions",
  messages: "formatMessages",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-base text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const control = "h-8 rounded-md border border-border bg-background px-2 outline-none";
const savedKeyMask = "********";

function typedKey(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== savedKeyMask ? trimmed : undefined;
}

export function ServiceList({
  locale,
  providers,
  onAdd,
  onOpen,
  onDeleted,
}: {
  locale: CopilotLocale;
  providers: ProviderView[];
  onAdd: () => void;
  onOpen: (provider: ProviderView) => void;
  onDeleted: (providers: ProviderView[]) => void;
}) {
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="flex flex-col text-sm text-foreground">
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {providers.map((provider) => (
          <button
            key={provider.name}
            type="button"
            className={`flex h-8 w-full items-center px-2 text-left hover:bg-blue-500/15 ${selected === provider.name ? "bg-blue-500 text-white" : ""}`}
            onClick={() => setSelected(provider.name)}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelected(provider.name);
              setMenu({ name: provider.name, x: event.clientX, y: event.clientY });
            }}
          >
            <span className="truncate">{provider.name}</span>
          </button>
        ))}
      </div>
      <button type="button" className="mt-3 h-8 rounded-md border border-border px-2 text-left hover:bg-muted" onClick={onAdd}>
        {t("addService")}
      </button>
      {menu ? (
        <div className="fixed z-50 w-28 rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="block h-8 w-full px-3 text-left hover:bg-muted"
            onClick={() => {
              const provider = providers.find((item) => item.name === menu.name);
              setMenu(null);
              if (provider) onOpen(provider);
            }}
          >
            {t("edit")}
          </button>
          <button
            type="button"
            className="block h-8 w-full px-3 text-left hover:bg-muted"
            onClick={() => {
              const name = menu.name;
              setMenu(null);
              setSelected((current) => (current === name ? null : current));
              void deleteProvider(name).then(onDeleted).catch(() => undefined);
            }}
          >
            {t("remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const button = "h-8 rounded-md border border-border px-3 hover:bg-muted disabled:opacity-40";

export function ServiceForm({
  locale,
  provider,
  proxies,
  onBack,
  onSaved,
  onEditProxy,
}: {
  locale: CopilotLocale;
  provider: ProviderView | null;
  proxies: ProxyView[];
  onBack: () => void;
  onSaved: (providers: ProviderView[]) => void;
  onEditProxy: () => void;
}) {
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [previousName, setPreviousName] = useState(provider?.name);
  const [name, setName] = useState(provider?.name ?? "");
  const [vendor, setVendor] = useState(provider && isVendor(provider.vendor) ? provider.vendor : "gemini");
  const [format, setFormat] = useState(provider && isFormat(provider.format) ? provider.format : "chat");
  const [address, setAddress] = useState(provider?.address ?? addressFor("gemini", "chat"));
  const [apiKey, setApiKey] = useState(provider?.hasKey ? savedKeyMask : "");
  const [proxyId, setProxyId] = useState(provider?.proxyId ?? "");
  const [catalog, setCatalog] = useState(provider?.models ?? []);
  const [enabled, setEnabled] = useState(() => new Set(provider?.models ?? []));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    setError("");
    try {
      const ids = await listModels({
        service: provider?.name,
        apiKey: typedKey(apiKey),
        vendor,
        format,
        address,
        proxyId,
      });
      setCatalog(ids);
      setEnabled((current) => new Set(ids.filter((id) => current.has(id))));
    } catch (err) {
      setCatalog([]);
      setEnabled(new Set());
      const { code, detail } = failureParts(err);
      if (code.includes("no-key")) setError(t("noKey"));
      else setError(detail ? `${t("listFailed")} ${code}: ${detail}` : t("listFailed"));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (provider?.hasKey) void refresh();
    // Load once when this provider form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseVendor(next: string) {
    if (!isVendor(next)) return;
    if (next === "custom") {
      const preset = addressFor(vendor, format);
      setVendor(next);
      if (address === preset) setAddress("");
      return;
    }
    setVendor(next);
    setFormat("chat");
    setAddress(addressFor(next, "chat"));
  }

  function chooseFormat(next: string) {
    if (!isFormat(next)) return;
    setFormat(next);
    if (vendor === "custom") return;
    setAddress(addressFor(vendor, next));
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("emptyName"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const providers = await saveProvider({
        previousName,
        name: trimmed,
        vendor,
        format,
        address,
        apiKey: typedKey(apiKey),
        models: catalog.filter((id) => enabled.has(id)),
        proxyId,
      });
      setPreviousName(trimmed);
      onSaved(providers);
    } catch (err) {
      const code = String(err);
      if (code.includes("duplicate-name")) setError(t("duplicateName"));
      else if (code.includes("empty-name")) setError(t("emptyName"));
      else setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-foreground">
      <div className="flex flex-col gap-3">
        <Field label={t("name")}>
          <input className={control} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t("vendor")}>
          <select className={control} value={vendor} onChange={(event) => chooseVendor(event.target.value)}>
            {VENDORS.map((id) => (
              <option key={id} value={id}>
                {t(vendorKey[id])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("format")}>
          <select className={control} value={format} onChange={(event) => chooseFormat(event.target.value)}>
            {FORMATS.map((id) => (
              <option key={id} value={id}>
                {t(formatKey[id])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("address")}>
          <input className={control} value={address} onChange={(event) => setAddress(event.target.value)} />
        </Field>
        <Field label={t("apiKey")}>
          <input
            className={control}
            type={apiKey === savedKeyMask ? "text" : "password"}
            value={apiKey}
            autoComplete="off"
            onFocus={(event) => {
              if (apiKey === savedKeyMask) event.currentTarget.select();
            }}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <Field label={t("proxy")}>
          <select
            className={control}
            value={proxyId}
            onChange={(event) => {
              if (event.target.value === "__edit__") {
                onEditProxy();
                return;
              }
              setProxyId(event.target.value);
            }}
          >
            <option value="">{t("noProxy")}</option>
            {proxies.map((proxy) => (
              <option key={proxy.id} value={proxy.id}>
                {proxy.name}
              </option>
            ))}
            <option value="__edit__">{t("editProxy")}</option>
          </select>
        </Field>
        <div className="flex flex-col gap-1">
          <button type="button" className="h-8 self-start rounded-md border border-border px-2 hover:bg-muted disabled:opacity-40" disabled={refreshing} onClick={() => void refresh()}>
            {t("refreshList")}
          </button>
          <div>
            <div className="max-h-40 min-w-0 overflow-y-auto rounded-md border border-border">
              {catalog.length === 0 ? <p className="px-2 py-2 text-muted-foreground">{notice || t("listEmpty")}</p> : null}
              {catalog.map((id) => (
                <label key={id} className="flex h-8 items-center gap-2 px-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={enabled.has(id)}
                    onChange={(event) => {
                      setEnabled((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                  />
                  <span className="truncate">{id}</span>
                </label>
              ))}
            </div>
          </div>
          {catalog.length > 0 && notice ? <p className="text-muted-foreground">{notice}</p> : null}
        </div>
        {error ? <p className="text-destructive">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={button} onClick={onBack}>
            {t("cancel")}
          </button>
          <button type="button" className="h-8 rounded-md border border-foreground bg-foreground px-3 text-background disabled:opacity-40" disabled={saving} onClick={() => void save()}>
            {t("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
