import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copilotT, type CopilotStringKey } from "../i18n";
import { useCopilotLocale } from "../locale";
import { PROMPT_HELP, clonePromptLibrary, defaultPromptBody, type PromptLang, type PromptLibrary } from "../promptTemplates";

const button = "h-8 shrink-0 rounded-md border border-border px-3 hover:bg-muted disabled:opacity-40";
const list = "h-32 overflow-y-auto rounded-md border border-border";

export function PromptTemplateDialog({
  library,
  onApply,
  onConfirm,
  onClose,
}: {
  library: PromptLibrary;
  onApply: (next: PromptLibrary) => void;
  onConfirm: (next: PromptLibrary) => void;
  onClose: () => void;
}) {
  const locale = useCopilotLocale();
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [draft, setDraft] = useState(() => clonePromptLibrary(library));
  const [lang, setLang] = useState<PromptLang>(locale);
  const [langHelp, setLangHelp] = useState(false);
  const [promptHelp, setPromptHelp] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nameBeforeEdit = useRef("");
  const group = draft[lang];
  const current = group.templates.find((item) => item.id === group.activeId) ?? group.templates[0];

  function update(langKey: PromptLang, next: PromptLibrary[PromptLang]) {
    setDraft((value) => ({ ...value, [langKey]: next }));
  }

  function select(id: string) {
    update(lang, { ...group, activeId: id });
  }

  function beginRename(id: string, name: string) {
    nameBeforeEdit.current = name;
    setEditingId(id);
  }

  function editName(id: string, name: string) {
    update(lang, { ...group, templates: group.templates.map((item) => (item.id === id && !item.locked ? { ...item, name } : item)) });
  }

  function finishName(id: string) {
    const item = group.templates.find((template) => template.id === id);
    if (item && !item.name.trim()) editName(id, nameBeforeEdit.current);
    setEditingId(null);
  }

  function addCopy() {
    const count = group.templates.filter((item) => !item.locked).length + 1;
    const id = crypto.randomUUID();
    const name = lang === "zh" ? `默认的副本 ${count}` : `Copy of Default ${count}`;
    nameBeforeEdit.current = name;
    setEditingId(id);
    update(lang, { activeId: id, templates: [...group.templates, { id, name, body: defaultPromptBody(lang), locked: false }] });
  }

  function removeCurrent() {
    if (!current || current.locked) return;
    update(lang, { activeId: "default", templates: group.templates.filter((item) => item.id !== current.id) });
  }

  function editBody(body: string) {
    if (!current || current.locked) return;
    update(lang, { ...group, templates: group.templates.map((item) => (item.id === current.id ? { ...item, body } : item)) });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label={t("promptTemplates")}
        className="flex h-[min(884px,100%)] max-h-full w-[min(760px,100%)] flex-col rounded-md border border-border bg-background p-4 text-[13px] text-foreground shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("templateList")}</h2>
          <button type="button" aria-label={t("close")} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_auto] items-start gap-x-3 gap-y-1.5">
          <span className="relative z-10 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            {t("language")}
            <span className="grid size-3.5 place-items-center rounded-full border border-current text-[10px] leading-none" onMouseEnter={() => setLangHelp(true)} onMouseLeave={() => setLangHelp(false)}>
              ?
            </span>
            {langHelp ? <span className="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-border bg-popover px-2 py-1.5 text-xs leading-5 font-normal text-popover-foreground shadow-md">{t("languageHint")}</span> : null}
          </span>
          <span className="text-xs font-semibold text-muted-foreground">{t("templateList")}</span>
          <span />
          <div className={list}>
            {(["zh", "en"] as const).map((item) => (
              <button key={item} type="button" className={`block h-8 w-full px-3 text-left ${item === lang ? "bg-muted" : "hover:bg-muted"}`} onClick={() => { setEditingId(null); setLang(item); }}>
                {item === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
          <div className={list}>
            {group.templates.map((item) => {
              const on = item.id === group.activeId;
              return (
                <div key={item.id} className={`flex h-8 w-full items-center gap-2 px-3 text-left ${on ? "bg-muted" : "hover:bg-muted"}`} onClick={() => select(item.id)} onDoubleClick={() => { if (!item.locked) beginRename(item.id, item.name); }}>
                  <span className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${on ? "border-blue-500" : "border-border"}`}>{on ? <span className="size-2 rounded-full bg-blue-500" /> : null}</span>
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      value={item.name}
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => editName(item.id, event.target.value)}
                      onBlur={() => finishName(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          editName(item.id, nameBeforeEdit.current);
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  )}
                </div>
              );
            })}
          </div>
          <span className="flex flex-col gap-2">
            <button type="button" className={button} onClick={addCopy}>{t("add")}</button>
            <button type="button" className={button} disabled={!current || current.locked} onClick={removeCurrent}>{t("remove")}</button>
          </span>
        </div>
        <span className="relative z-10 mt-3 inline-flex items-center gap-1.5 text-[16px] leading-[24px] text-foreground">
          {t("promptTemplates")}
          <span className="grid size-4 place-items-center rounded-full border border-current text-[11px] leading-none text-muted-foreground" onMouseEnter={() => setPromptHelp(true)} onMouseLeave={() => setPromptHelp(false)}>
            ?
          </span>
          {promptHelp ? <span className="absolute top-full left-0 z-20 mt-1 w-[min(36rem,80vw)] rounded-md border border-border bg-popover px-2 py-1.5 text-[16px] leading-[24px] whitespace-pre-wrap text-popover-foreground shadow-md">{PROMPT_HELP[lang]}</span> : null}
        </span>
        <textarea
          readOnly={!current || current.locked}
          value={current?.body ?? ""}
          onChange={(event) => editBody(event.target.value)}
          className={`mt-3 min-h-0 w-full flex-1 resize-none rounded-md border border-border p-2.5 text-[16px] leading-[24px] outline-none ${current?.locked ? "bg-muted text-foreground" : "bg-background"}`}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={button} onClick={() => onApply(clonePromptLibrary(draft))}>{t("apply")}</button>
          <button type="button" className={button} onClick={onClose}>{t("cancel")}</button>
          <button type="button" className="h-8 shrink-0 rounded-md border border-foreground bg-foreground px-3 text-background" onClick={() => onConfirm(clonePromptLibrary(draft))}>{t("confirm")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
