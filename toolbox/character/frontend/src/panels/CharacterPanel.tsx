import { Calculator, ImagePlus, Plus, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { savePastedImage, useProjectImage, type ToolPanelProps } from "@ek/tool-api";
import {
  canSaveInvestigators,
  deleteInvestigator,
  emptyInvestigator,
  loadInvestigators,
  saveInvestigator,
  type Fellow,
  type Investigator,
  type Skill,
  type Weapon,
} from "../db";
import { investigatorDerived } from "../derived";
import { characterT, type CharacterLocale, type CharacterStringKey } from "../i18n";
import { useCharacterLocale } from "../locale";
import { createTimestampedFolder, pickExportFolder, pickFolder, readInvestigatorFolder, writeInvestigatorFolder } from "../transfer";

const STATS = ["str", "con", "siz", "dex", "app", "edu", "int", "pow"] as const;
const POOLS = ["hp", "mp", "luck", "san", "sanStart"] as const;
const BACKSTORY = ["description", "ideology", "traits", "injuries", "people", "locations", "possessions", "phobias", "tomes", "spells"] as const;

export function CharacterPanel({ projectPath }: ToolPanelProps) {
  const locale = useCharacterLocale();
  const t = (key: CharacterStringKey) => characterT(locale, key);
  const [people, setPeople] = useState<Investigator[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"compact" | "edit" | "brief">("edit");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState<Investigator | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const ready = useRef(false);
  const chains = useRef<Record<string, Promise<void>>>({});

  useEffect(() => {
    ready.current = false;
    let cancelled = false;
    void loadInvestigators(projectPath).then((rows) => {
      if (cancelled) return;
      ready.current = true;
      setPeople(rows);
      setOpenId(null);
      setDraft(null);
      setMode("edit");
    }).catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  function enqueue(id: string, job: () => Promise<void>) {
    if (!ready.current || !canSaveInvestigators() || !projectPath) return Promise.resolve();
    const previous = chains.current[id] ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(job);
    chains.current[id] = next;
    void next.catch((error: unknown) => console.error(error));
    return next;
  }

  useEffect(() => {
    const flush = (event: Event) => {
      const detail = (event as CustomEvent<{ pending: Promise<void>[] }>).detail;
      detail?.pending.push(...Object.values(chains.current));
    };
    window.addEventListener("ek:flush", flush);
    window.addEventListener("ek:flush-pages", flush);
    return () => {
      window.removeEventListener("ek:flush", flush);
      window.removeEventListener("ek:flush-pages", flush);
    };
  }, []);

  function beginEdit(id: string, nextMode: "edit" | "brief") {
    const person = people.find((row) => row.id === id);
    if (!person) return;
    setDraft(structuredClone(person));
    setSaveFailed(false);
    setMode(nextMode);
    setOpenId(id);
  }

  function openCompact(id: string) {
    const person = people.find((row) => row.id === id);
    if (!person) return;
    setDraft(structuredClone(person));
    setSaveFailed(false);
    setMode("compact");
    setOpenId(id);
  }

  function add(nextMode: "edit" | "brief") {
    const next = emptyInvestigator(crypto.randomUUID(), people.length);
    setDraft(next);
    setSaveFailed(false);
    setMode(nextMode);
    setOpenId(next.id);
  }

  function discard() {
    if (savingRef.current) return;
    setDraft(null);
    setSaveFailed(false);
    setOpenId(null);
  }

  async function saveDraft(close: boolean) {
    if (!draft || savingRef.current) return;
    if (!ready.current || !canSaveInvestigators() || !projectPath) {
      setSaveFailed(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    const next = structuredClone(draft);
    try {
      await enqueue(next.id, () => saveInvestigator(projectPath, next));
      setPeople((rows) => rows.some((row) => row.id === next.id)
        ? rows.map((row) => row.id === next.id ? next : row)
        : [...rows, next]);
      if (close) {
        setDraft(null);
        setOpenId(null);
      }
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!menu && !addMenu) return;
    const close = () => {
      setMenu(null);
      setAddMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu, addMenu]);

  function remove(id: string) {
    setPeople((rows) => rows.filter((row) => row.id !== id));
    setOpenId((currentId) => (currentId === id ? null : currentId));
    enqueue(id, () => deleteInvestigator(projectPath, id));
  }

  function openExport() {
    setAddMenu(null);
    setPicked([]);
    setExporting(true);
  }

  async function confirmExport() {
    const chosen = people.filter((person) => picked.includes(person.id));
    setExporting(false);
    if (chosen.length === 0 || !projectPath) return;
    const parent = await pickExportFolder();
    if (!parent) return;
    const folder = await createTimestampedFolder(parent, "investigators");
    await writeInvestigatorFolder(folder, projectPath, chosen).catch((error: unknown) => console.error(error));
  }

  async function importFile() {
    if (!projectPath) return;
    const path = await pickFolder();
    if (!path) return;
    const rows = await readInvestigatorFolder(path, projectPath);
    if (!rows || rows.length === 0) return;
    const imported = rows.map((row, index) => ({ ...row, id: crypto.randomUUID(), position: people.length + index }));
    await Promise.all(imported.map((row) => enqueue(row.id, () => saveInvestigator(projectPath, row))));
    setPeople((current) => [...current, ...imported]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-sm text-foreground">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-base font-semibold">
        <span className="min-w-0 flex-1 truncate">{t("investigators")}</span>
        <button
          type="button"
          title={t("addInvestigator")}
          aria-label={t("addInvestigator")}
          data-investigator-add=""
          className="grid size-6 place-items-center rounded hover:bg-muted"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu(null);
            setAddMenu({ x: bounds.right, y: bounds.bottom + 4 });
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {people.map((person) => (
          <button
            key={person.id}
            type="button"
            data-investigator={person.id}
            className={`block h-7 w-full cursor-default truncate px-2 text-left select-none ${openId === person.id ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"}`}
            onClick={() => openCompact(person.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setAddMenu(null);
              setMenu({ id: person.id, x: event.clientX, y: event.clientY });
            }}
          >
            {person.name.trim() || t("untitled")}
          </button>
        ))}
      </div>
      {addMenu && (
        <div
          data-investigator-add-menu=""
          className="fixed z-50 min-w-40 -translate-x-full rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
          style={{ left: addMenu.x, top: addMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-muted" onClick={() => { setAddMenu(null); add("edit"); }}>
            {t("addInvestigatorFull")}
          </button>
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-muted" onClick={() => { setAddMenu(null); add("brief"); }}>
            {t("addInvestigatorBrief")}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1 text-left hover:bg-muted"
            onClick={openExport}
          >
            {t("exportInvestigators")}
          </button>
          <button type="button" className="block w-full px-3 py-1 text-left hover:bg-muted" onClick={() => { setAddMenu(null); void importFile(); }}>
            {t("importInvestigators")}
          </button>
        </div>
      )}
      {menu && (
        <div
          data-investigator-menu=""
          className="fixed z-50 min-w-36 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1 text-left hover:bg-muted"
            onClick={() => {
              beginEdit(menu.id, "edit");
              setMenu(null);
            }}
          >
            {t("editInvestigator")}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1 text-left hover:bg-muted"
            onClick={() => {
              beginEdit(menu.id, "brief");
              setMenu(null);
            }}
          >
            {t("editInvestigatorBrief")}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-destructive hover:bg-muted"
            onClick={() => {
              remove(menu.id);
              setMenu(null);
            }}
          >
            {t("deleteInvestigator")}
          </button>
        </div>
      )}
      {exporting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6">
          <div
            role="dialog"
            aria-label={t("exportInvestigators")}
            data-investigator-export=""
            className="flex max-h-full w-[min(360px,100%)] flex-col rounded-md border border-border bg-background shadow-lg"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 className="border-b border-border px-3 py-2 text-base font-semibold">{t("exportInvestigators")}</h2>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {people.length === 0 ? <p className="px-3 py-2 text-muted-foreground">{t("exportEmpty")}</p> : people.map((person) => (
                <label key={person.id} className="flex h-7 cursor-default items-center gap-2 px-3 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={picked.includes(person.id)}
                    onChange={(event) => {
                      setPicked((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id));
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{person.name.trim() || t("untitled")}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
              <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={() => setExporting(false)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={picked.length === 0}
                className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                onClick={() => void confirmExport()}
              >
                {t("exportAction")}
              </button>
            </div>
          </div>
        </div>
      )}
      {draft && mode === "compact" && (
        <CompactSheet projectPath={projectPath} locale={locale} investigator={draft} onChange={setDraft} onClose={discard}
          saving={saving} saveFailed={saveFailed} onApply={() => void saveDraft(false)} onConfirm={() => void saveDraft(true)} />
      )}
      {draft && (mode === "edit" || mode === "brief") && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6">
          <div
            role="dialog"
            aria-label={draft.name.trim() || t("untitled")}
            className={`flex max-h-full flex-col overflow-hidden rounded-md border border-border bg-background shadow-lg ${mode === "brief" ? "w-[min(810px,100%)]" : "w-[min(1080px,100%)]"}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
              <button type="button" aria-label={t("close")} disabled={saving} className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" onClick={discard}>
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Sheet projectPath={projectPath} locale={locale} investigator={draft} brief={mode === "brief"} onChange={setDraft} saving={saving} />
            </div>
            <FormActions locale={locale} saving={saving} saveFailed={saveFailed} onCancel={discard} onApply={() => void saveDraft(false)} onConfirm={() => void saveDraft(true)} />
          </div>
        </div>
      )}
    </div>
  );
}

function CompactSheet({
  projectPath,
  locale,
  investigator,
  onChange,
  onClose,
  saving,
  saveFailed,
  onApply,
  onConfirm,
}: {
  projectPath: string;
  locale: CharacterLocale;
  investigator: Investigator;
  onChange: (next: Investigator) => void;
  onClose: () => void;
  saving: boolean;
  saveFailed: boolean;
  onApply: () => void;
  onConfirm: () => void;
}) {
  const t = (key: CharacterStringKey) => characterT(locale, key);
  const [hp, setHp] = useState(String(investigator.hp));
  const [mp, setMp] = useState(String(investigator.mp));
  const [san, setSan] = useState(String(investigator.san));
  const [luck, setLuck] = useState(String(investigator.luck));
  useEffect(() => {
    setHp(String(investigator.hp));
    setMp(String(investigator.mp));
    setSan(String(investigator.san));
    setLuck(String(investigator.luck));
  }, [investigator]);

  function commit(field: "hp" | "mp" | "san" | "luck", value: string) {
    onChange({ ...investigator, [field]: wholeAtLeastZero(value) });
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label={investigator.name.trim() || t("untitled")}
        data-investigator-sheet="compact"
        className="relative flex max-h-full w-[min(660px,100%)] flex-col rounded-md border border-border bg-background text-sm shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-end border-b border-border px-3 py-2">
          <button type="button" disabled={saving} aria-label={t("close")} className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <fieldset disabled={saving} className="min-h-0 overflow-auto p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_11.25rem] items-start gap-x-6">
            <div className="min-w-0">
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 border-b border-border pb-3">
                <Fact label={t("name")} value={investigator.name} />
                <Fact label={t("occupation")} value={investigator.occupation} />
                <Fact label={t("gender")} value={investigator.gender} />
                <Fact label={t("age")} value={investigator.age} />
                <Fact label={t("damage")} value={investigator.damage} />
                <Fact label={t("build")} value={String(investigator.build)} />
                <Fact label={t("mov")} value={String(investigator.mov)} />
                <Fact label={t("dodge")} value={String(investigator.dodge)} />
                {STATS.map((key) => (
                  <Fact key={key} label={t(key)} value={String(investigator[key])} />
                ))}
                <Vital label={t("hp")} value={hp} onChange={setHp} onCommit={(value) => commit("hp", value)} />
                <Vital label={t("mp")} value={mp} onChange={setMp} onCommit={(value) => commit("mp", value)} />
                <Vital label={t("san")} value={san} onChange={setSan} onCommit={(value) => commit("san", value)} />
                <Vital label={t("luck")} value={luck} onChange={setLuck} onCommit={(value) => commit("luck", value)} />
              </div>
            </div>
            <div className="min-w-0">
              {investigator.portrait ? (
                <StoredPortrait projectPath={projectPath} src={investigator.portrait} className="h-36 w-full rounded-md object-contain" />
              ) : (
                <div className="grid h-36 w-full place-items-center rounded-md bg-sky-100 text-sky-600">
                  <User className="size-16" strokeWidth={1.5} />
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-base text-muted-foreground">{t("skills")}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base">
              {investigator.skills.length === 0 ? <span>—</span> : investigator.skills.map((skill, index) => (
                <span key={`${skill.name}-${index}`}>{skill.name} {skill.value}</span>
              ))}
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-base text-muted-foreground">{t("weapons")}</div>
            <div className="mt-1 space-y-2">
              {investigator.weapons.length === 0 ? <span className="text-base">—</span> : investigator.weapons.map((weapon, index) => (
                <div key={`${weapon.name}-${index}`} className="flex flex-wrap gap-x-4 gap-y-1">
                  <Fact label={t("weaponName")} value={weapon.name} />
                  <Fact label={t("weaponSkill")} value={weapon.skill} />
                  <Fact label={t("weaponDamage")} value={weapon.damage} />
                  <Fact label={t("weaponAttacks")} value={weapon.attacks} />
                  <Fact label={t("weaponRange")} value={weapon.range} />
                  <Fact label={t("weaponAmmo")} value={weapon.ammo} />
                  <Fact label={t("weaponMalfunction")} value={weapon.malfunction} />
                </div>
              ))}
            </div>
          </div>
        </fieldset>
        <FormActions locale={locale} saving={saving} saveFailed={saveFailed} onCancel={onClose} onApply={onApply} onConfirm={onConfirm} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="text-base text-muted-foreground">{label}</span>
      <span className="text-base">{value.trim() ? value : "—"}</span>
    </span>
  );
}

function Vital({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="shrink-0 text-base text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        aria-label={label}
        className="w-12 max-w-12 shrink border-b border-border bg-transparent text-base outline-none"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw !== "" && !/^\d+$/.test(raw)) return;
          onChange(raw);
          if (/^\d+$/.test(raw)) onCommit(raw);
        }}
        onBlur={(event) => {
          const next = event.target.value.trim() === "" ? "0" : String(wholeAtLeastZero(event.target.value));
          onChange(next);
          onCommit(next);
        }}
      />
    </span>
  );
}

function Sheet({
  projectPath,
  locale,
  investigator,
  brief = false,
  onChange,
  saving,
}: {
  projectPath: string;
  locale: CharacterLocale;
  investigator: Investigator;
  brief?: boolean;
  onChange: (next: Investigator) => void;
  saving: boolean;
}) {
  const t = (key: CharacterStringKey) => characterT(locale, key);
  const set = (patch: Partial<Investigator>) => onChange({ ...investigator, ...patch });
  const weaponFields = brief
    ? ["name", "skill", "damage", "attacks"] as const
    : ["name", "skill", "damage", "attacks", "range", "ammo", "malfunction"] as const;
  const weaponColumns = brief
    ? "grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_auto]"
    : "grid-cols-[1.2fr_0.7fr_0.8fr_0.6fr_0.7fr_0.7fr_0.7fr_auto]";

  return (
    <fieldset disabled={saving} className="mx-auto flex min-w-0 max-w-[1080px] flex-col gap-4 p-4" data-character-sheet={investigator.id} data-character-form={brief ? "brief" : "full"}>
      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("about")}</h2>
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-stretch gap-3">
        <div className={`grid gap-2 ${brief ? "grid-cols-3" : "grid-cols-6"}`}>
          <Field className="col-span-2" label={t("name")} value={investigator.name} onChange={(name) => set({ name })} />
          {brief && <Field label={t("age")} value={investigator.age} onChange={(age) => set({ age })} />}
          <Field className="col-span-2" label={t("occupation")} value={investigator.occupation} onChange={(occupation) => set({ occupation })} />
          {!brief && <Field label={t("age")} value={investigator.age} onChange={(age) => set({ age })} />}
          <Field label={t("gender")} value={investigator.gender} onChange={(gender) => set({ gender })} />
          {!brief && <Field className="col-span-2" label={t("player")} value={investigator.player} onChange={(player) => set({ player })} />}
          {!brief && <Field className="col-span-2" label={t("birthplace")} value={investigator.birthplace} onChange={(birthplace) => set({ birthplace })} />}
          {!brief && <Field className="col-span-2" label={t("residence")} value={investigator.residence} onChange={(residence) => set({ residence })} />}
        </div>
        <PortraitPicker projectPath={projectPath} src={investigator.portrait} label={t("portrait")} onChange={(portrait) => set({ portrait })} />
        </div>
      </section>

      <section className="rounded-md border border-border p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-muted-foreground">{t("characteristics")}</h2>
          <button
            type="button"
            title={t("calculateDerived")}
            aria-label={t("calculateDerived")}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => set(investigatorDerived(investigator))}
          >
            <Calculator className="size-4" />
          </button>
        </div>
        <div className={`grid gap-2 ${brief ? "grid-cols-4" : "grid-cols-8"}`}>
          {STATS.map((key) => (
            <NumberField key={key} label={t(key)} value={investigator[key]} onChange={(value) => set({ [key]: value })} />
          ))}
        </div>
        <div className={`mt-3 grid gap-2 border-t border-border pt-3 ${brief ? "grid-cols-4" : "grid-cols-9"}`}>
          {(brief ? ["hp", "mp", "luck", "san"] as const : POOLS).map((key) => (
            <NumberField key={key} label={t(key)} value={investigator[key]} onChange={(value) => set({ [key]: value })} />
          ))}
          <NumberField label={t("mov")} value={investigator.mov} onChange={(mov) => set({ mov })} />
          <NumberField label={t("build")} value={investigator.build} allowNegative onChange={(build) => set({ build })} />
          <Field label={t("damage")} value={investigator.damage} onChange={(damage) => set({ damage })} />
          <NumberField label={t("dodge")} value={investigator.dodge} onChange={(dodge) => set({ dodge })} />
        </div>
      </section>

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("skills")}</h2>
        <div className={`grid gap-x-4 gap-y-3 ${brief ? "grid-cols-3" : "grid-cols-5"}`}>
          {investigator.skills.map((skill, index) => (
            <div key={index} className="flex min-w-0 items-center gap-1">
              <input
                value={skill.name}
                placeholder={t("skillName")}
                aria-label={t("skillName")}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2"
                onChange={(event) => {
                  const skills = investigator.skills.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item);
                  set({ skills });
                }}
              />
              <input
                value={String(skill.value)}
                placeholder={t("skillValue")}
                inputMode="numeric"
                aria-label={t("skillValue")}
                className="h-8 w-16 shrink-0 rounded-md border border-border bg-background px-2"
                onChange={(event) => {
                  const skills = investigator.skills.map((item, itemIndex) => itemIndex === index ? { ...item, value: wholeNumber(event.target.value) } : item);
                  set({ skills });
                }}
              />
              <button
                type="button"
                title={t("removeSkill")}
                aria-label={t("removeSkill")}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
                onClick={() => set({ skills: investigator.skills.filter((_, itemIndex) => itemIndex !== index) })}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              title={t("addSkill")}
              aria-label={t("addSkill")}
              className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted"
              onClick={() => set({ skills: [...investigator.skills, blankSkill()] })}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("weapons")}</h2>
        <div className={`grid gap-1 text-base text-muted-foreground ${weaponColumns}`}>
          {weaponFields.map((key) => <span key={key}>{t(weaponLabel(key))}</span>)}
          <span />
        </div>
        {investigator.weapons.map((weapon, index) => (
          <div key={index} className={`mt-1 grid gap-1 ${weaponColumns}`}>
            {weaponFields.map((key) => (
              <input
                key={key}
                value={weapon[key]}
                aria-label={t(weaponLabel(key))}
                className="h-8 min-w-0 rounded-md border border-border bg-background px-2"
                onChange={(event) => {
                  const weapons = investigator.weapons.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item);
                  set({ weapons });
                }}
              />
            ))}
            <button
              type="button"
              title={t("removeWeapon")}
              aria-label={t("removeWeapon")}
              className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted"
              onClick={() => set({ weapons: investigator.weapons.filter((_, itemIndex) => itemIndex !== index) })}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
          onClick={() => set({ weapons: [...investigator.weapons, blankWeapon()] })}
        >
          <Plus className="size-3.5" /> {t("addWeapon")}
        </button>
      </section>

      {!brief && <Area label={t("story")} value={investigator.story} onChange={(story) => set({ story })} />}

      {!brief && <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("backstory")}</h2>
        <div className="grid grid-cols-2 gap-2">
          {BACKSTORY.map((key) => (
            <Area key={key} label={t(key)} value={investigator[key]} onChange={(value) => set({ [key]: value })} />
          ))}
          <div className="col-span-2">
            <Area label={t("encounters")} value={investigator.encounters} onChange={(encounters) => set({ encounters })} />
          </div>
        </div>
      </section>}

      {!brief && <Area label={t("gear")} value={investigator.gear} onChange={(gear) => set({ gear })} />}

      {!brief && <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("wealth")}</h2>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t("spendingLevel")} value={investigator.spendingLevel} onChange={(spendingLevel) => set({ spendingLevel })} />
          <Field label={t("cash")} value={investigator.cash} onChange={(cash) => set({ cash })} />
          <Field label={t("assets")} value={investigator.assets} onChange={(assets) => set({ assets })} />
        </div>
      </section>}

      {!brief && <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-base font-semibold text-muted-foreground">{t("fellows")}</h2>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1 text-base text-muted-foreground">
          <span>{t("playerName")}</span>
          <span>{t("investigatorName")}</span>
          <span />
        </div>
        {investigator.fellows.map((fellow, index) => (
          <div key={index} className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1">
            <input
              value={fellow.player}
              aria-label={t("playerName")}
              className="h-8 rounded-md border border-border bg-background px-2"
              onChange={(event) => set({ fellows: replaceFellow(investigator.fellows, index, { player: event.target.value }) })}
            />
            <input
              value={fellow.investigator}
              aria-label={t("investigatorName")}
              className="h-8 rounded-md border border-border bg-background px-2"
              onChange={(event) => set({ fellows: replaceFellow(investigator.fellows, index, { investigator: event.target.value }) })}
            />
            <button
              type="button"
              title={t("removeWeapon")}
              aria-label={t("removeWeapon")}
              className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted"
              onClick={() => set({ fellows: investigator.fellows.filter((_, itemIndex) => itemIndex !== index) })}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
          onClick={() => set({ fellows: [...investigator.fellows, { player: "", investigator: "" }] })}
        >
          <Plus className="size-3.5" /> {t("addFellow")}
        </button>
      </section>}

    </fieldset>
  );
}

function FormActions({ locale, saving, saveFailed, onApply, onCancel, onConfirm }: {
  locale: CharacterLocale;
  saving: boolean;
  saveFailed: boolean;
  onApply: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = (key: CharacterStringKey) => characterT(locale, key);
  return (
    <div className="shrink-0 border-t border-border bg-background px-4 py-3">
      {saveFailed && <p role="alert" className="mb-2 text-sm text-destructive">{t("saveFailed")}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" data-ek-save disabled={saving} className="rounded-md px-3 py-1 hover:bg-muted disabled:opacity-50" onClick={onApply}>{t("apply")}</button>
        <button type="button" disabled={saving} className="rounded-md px-3 py-1 hover:bg-muted disabled:opacity-50" onClick={onCancel}>{t("cancel")}</button>
        <button type="button" disabled={saving} className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50" onClick={onConfirm}>{t("confirm")}</button>
      </div>
    </div>
  );
}

function weaponLabel(key: keyof Weapon): CharacterStringKey {
  if (key === "name") return "weaponName";
  if (key === "skill") return "weaponSkill";
  if (key === "damage") return "weaponDamage";
  if (key === "attacks") return "weaponAttacks";
  if (key === "range") return "weaponRange";
  if (key === "ammo") return "weaponAmmo";
  return "weaponMalfunction";
}

function blankSkill(): Skill {
  return { name: "", value: 0 };
}

function wholeAtLeastZero(raw: string) {
  const next = Number(raw);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.trunc(next));
}

function wholeNumber(raw: string) {
  const text = raw.trim();
  if (text === "" || text === "-") return 0;
  const next = Number(text);
  return Number.isFinite(next) ? Math.trunc(next) : 0;
}

function blankWeapon(): Weapon {
  return { name: "", skill: "", damage: "", attacks: "", range: "", ammo: "", malfunction: "" };
}

function replaceFellow(fellows: Fellow[], index: number, patch: Partial<Fellow>) {
  return fellows.map((fellow, itemIndex) => (itemIndex === index ? { ...fellow, ...patch } : fellow));
}

function PortraitPicker({
  projectPath,
  src,
  label,
  onChange,
}: {
  projectPath: string;
  src: string;
  label: string;
  onChange: (src: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file || !file.type.startsWith("image/") || !projectPath) return;
    onChange(await savePastedImage(projectPath, file));
  }

  return (
    <div className="min-h-28">
      <button
        type="button"
        title={label}
        aria-label={label}
        data-portrait=""
        className={`grid h-full w-full place-items-center overflow-hidden rounded-md border text-sm text-muted-foreground hover:bg-muted ${src ? "border-solid border-border" : "border-dashed border-border"}`}
        onClick={() => inputRef.current?.click()}
      >
        {src ? <StoredPortrait projectPath={projectPath} src={src} className="h-full w-full object-cover" /> : (
          <span className="flex flex-col items-center gap-1 px-1 text-center">
            <ImagePlus className="size-5" />
            {label}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
    </div>
  );
}

function StoredPortrait({ projectPath, src, className }: { projectPath: string; src: string; className: string }) {
  const { url, onError } = useProjectImage(projectPath, src);
  return url ? <img src={url} alt="" className={className} onError={onError} /> : null;
}

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-base text-muted-foreground">{label}</span>
      <input value={value} className="h-8 w-full rounded-md border border-border bg-background px-2" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange, allowNegative = false }: { label: string; value: number; onChange: (value: number) => void; allowNegative?: boolean }) {
  const shown = Number.isFinite(value) ? value : 0;
  // The text is kept locally so a lone "-" can survive until the digits arrive.
  const [text, setText] = useState(String(shown));
  useEffect(() => {
    setText((current) => (current !== "" && wholeNumber(current) === shown ? current : String(shown)));
  }, [shown]);
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-base text-muted-foreground">{label}</span>
      <input
        value={text}
        inputMode={allowNegative ? "text" : "numeric"}
        className="h-8 w-full rounded-md border border-border bg-background px-2"
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "" || (raw === "-" && allowNegative)) {
            setText(raw);
            onChange(0);
            return;
          }
          const next = Number(raw);
          if (!Number.isFinite(next) || (!allowNegative && next < 0)) return;
          const whole = Math.trunc(next);
          setText(/^-?\d+$/.test(raw) ? raw : String(whole));
          onChange(whole);
        }}
      />
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-base text-muted-foreground">{label}</span>
      <textarea value={value} rows={3} className="w-full resize-y rounded-md border border-border bg-background px-2 py-1" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
