import { DicesIcon, Filter, ImagePlus, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { applyActorArticles, publishActorIndex, publishArticles, readArticles, subscribeArticles } from "../articleStore";
import { derive, rollCharacteristics, type Characteristics, type Derived } from "../cocSheet";
import {
  ensureScenarioSchema,
  insertScenarioActor,
  loadScenarioActors,
  deleteScenarioActor,
  loadScenarioArticles,
  projectDatabaseAvailable,
  setActorArticles,
  setScenarioActorTrashed,
  updateScenarioActor,
  type ScenarioActor,
  type ScenarioArticle,
} from "../db";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { ListTrash } from "./ListTrash";
import { presentSceneIds, readSceneCatalog, sceneLinkRows, subscribeSceneCatalog, type SceneCatalog } from "../sceneLinks";
import { loadImageObjectUrl, savePastedImage } from "../storage";

type Kind = "npc" | "monster";

type Actor = ScenarioActor;

type Draft = { kind: Kind; actor: Actor | null };

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
const ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"] as const;

const EMPTY_STATS: Characteristics = { str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0, luck: 0 };

const EMPTY_STAT_TEXT = { str: "", con: "", siz: "", dex: "", app: "", int: "", pow: "", edu: "", luck: "" };

type DerivedText = { hp: string; mp: string; san: string; damage: string; build: string; mov: string };

type SkillDraft = { key: string; name: string; value: string };

type AttackDraft = { key: string; name: string; chance: string; damage: string; uses: string; note: string };

const EMPTY_DERIVED_TEXT: DerivedText = { hp: "", mp: "", san: "", damage: "", build: "", mov: "" };

export function NpcColumn({ locale, projectPath, selected }: { locale: ScenarioLocale; projectPath: string; selected: string }) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [actors, setActors] = useState<Actor[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; trashed: boolean; x: number; y: number } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [linkedOnly, setLinkedOnly] = useState(false);
  const titleId = useId();
  const usingDb = projectDatabaseAvailable() && projectPath !== "";

  useEffect(() => {
    if (!usingDb) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureScenarioSchema(projectPath);
        const rows = await loadScenarioActors(projectPath);
        if (!cancelled) setActors(rows);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, usingDb]);

  useEffect(() => {
    publishActorIndex(actors.map((actor) => ({ id: actor.id, name: actor.name, kind: actor.kind, trashed: actor.trashed })));
  }, [actors]);

  useEffect(() => {
    if (!menu && !rowMenu) return;
    const close = () => {
      setMenu(null);
      setRowMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu, rowMenu]);

  function openForm(kind: Kind) {
    setMenu(null);
    setDraft({ kind, actor: null });
  }

  async function save(actor: Actor, articleIds: string[]) {
    if (usingDb) {
      await ensureScenarioSchema(projectPath);
      if (draft?.actor) await updateScenarioActor(projectPath, actor);
      else await insertScenarioActor(projectPath, actor);
      await setActorArticles(projectPath, actor.id, articleIds);
      setActors(await loadScenarioActors(projectPath));
      publishArticles(await loadScenarioArticles(projectPath));
    } else if (draft?.actor) {
      setActors((items) => items.map((item) => (item.id === actor.id ? actor : item)));
      publishArticles(applyActorArticles(readArticles(), actor.id, articleIds));
    } else {
      setActors((items) => [...items, actor]);
      publishArticles(applyActorArticles(readArticles(), actor.id, articleIds));
    }
    setDraft(null);
  }

  async function moveActor(id: string, trashed: boolean) {
    setRowMenu(null);
    if (trashed) setTrashOpen(true);
    if (usingDb) {
      await setScenarioActorTrashed(projectPath, id, trashed);
      setActors(await loadScenarioActors(projectPath));
    } else {
      setActors((items) => items.map((item) => (item.id === id ? { ...item, trashed } : item)));
    }
  }

  async function purgeActor(id: string) {
    setRowMenu(null);
    if (draft?.actor?.id === id) setDraft(null);
    if (usingDb) {
      await deleteScenarioActor(projectPath, id);
      setActors(await loadScenarioActors(projectPath));
      publishArticles(await loadScenarioArticles(projectPath));
    } else {
      setActors((items) => items.filter((item) => item.id !== id));
      publishArticles(readArticles().map((item) => ({ ...item, actors: item.actors.filter((actorId) => actorId !== id) })));
    }
  }

  function renderActor(actor: Actor) {
    return (
      <div
        key={actor.id}
        data-actor={actor.kind}
        data-trashed={actor.trashed ? "true" : "false"}
        data-selected={picked === actor.id ? "true" : "false"}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", actor.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className={`flex h-7 cursor-default select-none items-center gap-2 px-2.5 ${picked === actor.id ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"}`}
        onClick={(event) => {
          if (event.detail > 1) {
            setPicked(actor.id);
            return;
          }
          setPicked((current) => (current === actor.id ? null : actor.id));
        }}
        onDoubleClick={() => {
          setPicked(actor.id);
          setDraft({ kind: actor.kind, actor });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setRowMenu({ id: actor.id, trashed: actor.trashed, x: event.clientX, y: event.clientY });
        }}
      >
        {actor.portrait ? <StoredPortrait projectPath={projectPath} src={actor.portrait} className="size-6 shrink-0 rounded-full object-cover" /> : null}
        <span className="min-w-0 flex-1 truncate">{actor.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{actor.kind === "npc" ? "NPC" : t("monster")}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 text-xs font-semibold">
        <span className="min-w-0 flex-1 truncate">{t("npcs")}</span>
        <button
          type="button"
          title={t("filterByScene")}
          aria-pressed={linkedOnly}
          data-npc-filter=""
          className={`grid size-6 place-items-center rounded font-normal ${linkedOnly ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onClick={() => setLinkedOnly((current) => !current)}
        >
          <Filter className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("create")}
          data-npc-add=""
          className="grid size-6 place-items-center rounded font-normal hover:bg-muted"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({ x: bounds.right, y: bounds.bottom + 4 });
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain");
          const actor = actors.find((item) => item.id === id);
          if (actor?.trashed) void moveActor(id, false);
        }}
      >
        {(linkedOnly ? actors.filter((actor) => !actor.trashed && selected !== "" && actor.links.includes(selected)) : actors.filter((actor) => !actor.trashed)).map((actor) => renderActor(actor))}
      </div>
      <ListTrash title={t("trash")} open={trashOpen} onToggle={() => setTrashOpen((open) => !open)} onReceive={(id) => void moveActor(id, true)}>
        {actors.filter((actor) => actor.trashed).map((actor) => renderActor(actor))}
      </ListTrash>
      {menu && (
        <div
          data-npc-menu=""
          className="fixed z-30 min-w-36 -translate-x-full rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => openForm("npc")}>
            {t("newCocNpc")}
          </button>
          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => openForm("monster")}>
            {t("quickMonster")}
          </button>
        </div>
      )}
      {rowMenu && (
        <div
          data-actor-menu=""
          className="fixed z-30 min-w-36 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-destructive hover:bg-accent"
            onClick={() => void (rowMenu.trashed ? purgeActor(rowMenu.id) : moveActor(rowMenu.id, true))}
          >
            {rowMenu.trashed ? t("deleteNode") : t("moveToTrash")}
          </button>
        </div>
      )}
      {draft && (
        <ActorDialog
          key={draft.actor?.id ?? `new-${draft.kind}`}
          locale={locale}
          projectPath={projectPath}
          kind={draft.kind}
          actor={draft.actor}
          selected={selected}
          titleId={titleId}
          onCancel={() => setDraft(null)}
          onSave={(actor, articleIds) => void save(actor, articleIds)}
        />
      )}
    </div>
  );
}

function ActorDialog({
  locale,
  projectPath,
  kind,
  actor,
  selected,
  titleId,
  onCancel,
  onSave,
}: {
  locale: ScenarioLocale;
  projectPath: string;
  kind: Kind;
  actor: Actor | null;
  selected: string;
  titleId: string;
  onCancel: () => void;
          onSave: (actor: Actor, articleIds: string[]) => void | Promise<void>;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [name, setName] = useState(actor?.name ?? "");
  const [age, setAge] = useState(actor?.age ?? "");
  const [gender, setGender] = useState(actor?.gender ?? "");
  const [occupation, setOccupation] = useState(actor?.occupation ?? "");
  const [nativeLanguage, setNativeLanguage] = useState(actor?.nativeLanguage ?? "");
  const [portrait, setPortrait] = useState(actor?.portrait ?? "");
  const [statText, setStatText] = useState(() => (actor ? statTextFrom(actor.stats) : EMPTY_STAT_TEXT));
  const [derivedText, setDerivedText] = useState<DerivedText>(() => (actor ? derivedTextFrom(actor) : EMPTY_DERIVED_TEXT));
  const [appearance, setAppearance] = useState(actor?.appearance ?? "");
  const [portrayal, setPortrayal] = useState(actor?.portrayal ?? "");
  const [backstory, setBackstory] = useState(actor?.backstory ?? "");
  const [notes, setNotes] = useState(actor?.notes ?? "");
  const [skills, setSkills] = useState<SkillDraft[]>(() => (actor?.skills ?? []).map(skillDraft));
  const [attacks, setAttacks] = useState<AttackDraft[]>(() => (actor?.attacks ?? []).map(attackDraft));
  const [catalog, setCatalog] = useState<SceneCatalog>(readSceneCatalog);
  const [linked, setLinked] = useState<string[]>(() => (actor ? actor.links : selected ? [selected] : []));
  const [articles, setArticles] = useState<ScenarioArticle[]>(readArticles);
  const [articleIds, setArticleIds] = useState<string[]>(() => (actor ? readArticles().filter((item) => item.actors.includes(actor.id)).map((item) => item.id) : []));
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => subscribeSceneCatalog(setCatalog), []);
  useEffect(() => subscribeArticles(setArticles), []);

  useEffect(() => {
    if (!catalog.ready) return;
    const present = presentSceneIds(catalog.nodes, catalog.trash);
    setLinked((current) => {
      const next = current.filter((id) => present.has(id));
      return next.length === current.length ? current : next;
    });
  }, [catalog]);

  function applyStats(nextAge: string, nextStats: typeof EMPTY_STAT_TEXT) {
    if (kind !== "npc") return;
    setDerivedText(derivedFieldsFrom(characteristicsFrom(nextStats), nextAge));
  }

  function updateSkill(index: number, patch: Partial<Pick<SkillDraft, "name" | "value">>) {
    setSkills((current) => current.map((skill, skillIndex) => (skillIndex === index ? { ...skill, ...patch } : skill)));
  }

  function updateAttack(index: number, patch: Partial<Omit<AttackDraft, "key">>) {
    setAttacks((current) => current.map((attack, attackIndex) => (attackIndex === index ? { ...attack, ...patch } : attack)));
  }

  function rollNine() {
    const rolled = rollCharacteristics();
    const next = { ...EMPTY_STAT_TEXT };
    for (const key of STAT_KEYS) next[key] = String(rolled[key]);
    setStatText(next);
    applyStats(age, next);
  }

  function submit() {
    const fallback = kind === "npc" ? t("untitledNpc") : t("untitledMonster");
    setSaveFailed(false);
    void Promise.resolve(
      onSave({
        id: actor?.id ?? crypto.randomUUID(),
        kind,
        name: name.trim() || fallback,
        age: kind === "npc" ? age.trim() : "",
        gender: kind === "npc" ? gender.trim() : "",
        occupation: kind === "npc" ? occupation.trim() : "",
        nativeLanguage: kind === "npc" ? nativeLanguage.trim() : "",
        portrait: kind === "npc" ? portrait : "",
        stats: kind === "npc" ? characteristicsFrom(statText) : EMPTY_STATS,
        derived: derivedFromText(derivedText),
        appearance,
        portrayal: kind === "npc" ? portrayal : "",
        backstory: kind === "npc" ? backstory : "",
        notes,
        skills: kind === "npc" ? skills.map((skill) => ({ name: skill.name.trim(), value: numberOrZero(skill.value) })) : [],
        attacks: attacks.map((attack) => ({
          name: attack.name.trim(),
          chance: numberOrZero(attack.chance),
          damage: attack.damage.trim(),
          uses: attack.uses.trim(),
          note: attack.note.trim(),
        })),
        links: savedLinks(catalog, linked),
        trashed: actor?.trashed ?? false,
      }, articleIds),
    ).catch((error: unknown) => {
      console.error(error);
      setSaveFailed(true);
    });
  }

  function detailSections(className: string) {
    return (
      <>
        <div className={className}>
          <h3 className="mb-2 text-xs text-muted-foreground">{t("weapons")}</h3>
          <div className="grid gap-y-3">
            {attacks.map((attack, index) => (
              <div key={attack.key} className="flex min-w-0 items-center gap-1">
                <div className="grid min-w-0 flex-1 grid-cols-5 gap-x-4">
                  <Field label={t("weaponName")} value={attack.name} onChange={(value) => updateAttack(index, { name: value })} />
                  <Field label={t("skillValue")} value={attack.chance} numeric onChange={(value) => updateAttack(index, { chance: value })} />
                  <Field label={t("weaponDamage")} value={attack.damage} onChange={(value) => updateAttack(index, { damage: value })} />
                  <div className="col-span-2 min-w-0">
                    <Field label={t("weaponNote")} value={attack.note} onChange={(value) => updateAttack(index, { note: value })} />
                  </div>
                </div>
                <button
                  type="button"
                  title={t("removeWeapon")}
                  aria-label={t("removeWeapon")}
                  className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setAttacks((current) => current.filter((item) => item.key !== attack.key))}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex min-w-0 items-center">
              <button
                type="button"
                title={t("addWeapon")}
                aria-label={t("addWeapon")}
                className="grid h-9 w-9 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setAttacks((current) => [...current, blankAttack()])}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className={className}>
          <h3 className="mb-2 text-xs text-muted-foreground">{t("sceneLinks")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sceneLinkRows(catalog.nodes, catalog.trash, new Set(linked)).map((row) => (
              <div key={row.id} data-scene-link={row.id} data-trashed={row.trashed ? "true" : "false"} className="flex max-w-full shrink-0 items-center gap-1">
                <label className={`flex min-w-0 items-center gap-1.5 ${row.trashed ? "text-muted-foreground opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    checked={linked.includes(row.id)}
                    className="size-3.5 shrink-0"
                    onChange={(event) => setLinked((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))}
                  />
                  <span>{row.title}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className={className}>
          <h3 className="mb-2 text-xs text-muted-foreground">{t("clues")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {articles.filter((item) => !item.trashed || articleIds.includes(item.id)).map((item) => (
              <div key={item.id} data-article-link={item.id} data-trashed={item.trashed ? "true" : "false"} className="flex max-w-full shrink-0 items-center gap-1">
                <label className={`flex min-w-0 items-center gap-1.5 ${item.trashed ? "text-muted-foreground opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    checked={articleIds.includes(item.id)}
                    className="size-3.5 shrink-0"
                    onChange={(event) => setArticleIds((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
                  />
                  <span>{item.name}</span>
                  <span className="text-[11px] text-muted-foreground">{item.kind === "clue" ? t("clue") : t("item")}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onCancel}>
      <form
        role="dialog"
        aria-labelledby={titleId}
        data-actor-form={kind}
        className="max-h-full w-[min(990px,100%)] overflow-auto rounded-md border border-border bg-background p-4 text-[13px] shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={titleId} className="mb-3 text-sm font-semibold">
          {actor ? name.trim() || (kind === "npc" ? t("untitledNpc") : t("untitledMonster")) : kind === "npc" ? t("newCocNpc") : t("quickMonster")}
        </h2>
        {kind === "npc" ? (
          <div>
            <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_11.25rem] items-center gap-x-4 gap-y-3">
              <Field label={t("fullName")} value={name} onChange={setName} />
              <Field label={t("occupation")} value={occupation} onChange={setOccupation} />
              <Field label={t("gender")} value={gender} onChange={setGender} />
              <Field
                label={t("age")}
                value={age}
                numeric
                onChange={(value) => {
                  setAge(value);
                  applyStats(value, statText);
                }}
              />
              <div className="col-start-5 row-start-1 row-span-5 flex h-full w-full flex-col items-center self-stretch">
                <button
                  type="button"
                  title={t("rollAttributes")}
                  aria-label={t("rollAttributes")}
                  className="mb-1 grid size-9 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={rollNine}
                >
                  <DicesIcon className="size-4" />
                </button>
                <PortraitPicker
                  projectPath={projectPath}
                  src={portrait}
                  label={t("addPortrait")}
                  className="h-full min-h-0 w-full flex-1"
                  onChange={setPortrait}
                />
              </div>
              {ATTRIBUTE_KEYS.map((key) => (
                <Field
                  key={key}
                  label={t(key)}
                  value={statText[key]}
                  numeric
                  onChange={(value) => {
                    const next = { ...statText, [key]: value };
                    setStatText(next);
                    applyStats(age, next);
                  }}
                />
              ))}
              <Field label={t("damage")} value={derivedText.damage} onChange={(value) => setDerivedText((current) => ({ ...current, damage: value }))} />
              <Field label={t("build")} value={derivedText.build} numeric onChange={(value) => setDerivedText((current) => ({ ...current, build: value }))} />
              <Field label={t("mov")} value={derivedText.mov} numeric onChange={(value) => setDerivedText((current) => ({ ...current, mov: value }))} />
              <Field label={t("nativeLanguage")} value={nativeLanguage} onChange={setNativeLanguage} />
              <div className="col-span-4 mt-0 border-t border-border pt-3">
                <h3 className="mb-2 text-xs text-muted-foreground">{t("initialState")}</h3>
                <div className="grid grid-cols-4 gap-x-4">
                  <Field label={t("hp")} value={derivedText.hp} numeric onChange={(value) => setDerivedText((current) => ({ ...current, hp: value }))} />
                  <Field label={t("mp")} value={derivedText.mp} numeric onChange={(value) => setDerivedText((current) => ({ ...current, mp: value }))} />
                  <Field label={t("san")} value={derivedText.san} numeric onChange={(value) => setDerivedText((current) => ({ ...current, san: value }))} />
                  <Field
                    label={t("luck")}
                    value={statText.luck}
                    numeric
                    onChange={(value) => setStatText((current) => ({ ...current, luck: value }))}
                  />
                </div>
              </div>
              <div className="col-span-5 border-t border-border pt-3">
              <h3 className="mb-2 text-xs text-muted-foreground">{t("skills")}</h3>
              <div className="grid grid-cols-5 gap-x-4 gap-y-3">
                {skills.map((skill, index) => (
                  <div key={skill.key} className="flex min-w-0 items-center gap-1">
                    <input
                      value={skill.name}
                      placeholder={t("skillName")}
                      aria-label={t("skillName")}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 outline-none placeholder:text-muted-foreground"
                      onChange={(event) => updateSkill(index, { name: event.target.value })}
                    />
                    <input
                      value={skill.value}
                      placeholder={t("skillValue")}
                      inputMode="numeric"
                      aria-label={t("skillValue")}
                      className="h-9 w-16 shrink-0 rounded-md border border-border bg-card px-2 outline-none placeholder:text-muted-foreground"
                      onChange={(event) => updateSkill(index, { value: event.target.value })}
                    />
                    <button
                      type="button"
                      title={t("removeSkill")}
                      aria-label={t("removeSkill")}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setSkills((current) => current.filter((item) => item.key !== skill.key))}
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
                    className="grid h-9 w-9 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setSkills((current) => [...current, blankSkill()])}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>
              </div>
              {detailSections("col-span-5 border-t border-border pt-3")}
            </div>
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <TextBlock label={t("appearance")} value={appearance} onChange={setAppearance} />
              <TextBlock label={t("portrayal")} value={portrayal} onChange={setPortrayal} />
              <TextBlock label={t("backstory")} value={backstory} onChange={setBackstory} />
              <TextBlock label={t("notes")} value={notes} onChange={setNotes} />
            </div>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              <Field label={t("actorName")} value={name} onChange={setName} />
              <Field label={t("hp")} value={derivedText.hp} numeric onChange={(value) => setDerivedText((current) => ({ ...current, hp: value }))} />
              <Field label={t("mp")} value={derivedText.mp} numeric onChange={(value) => setDerivedText((current) => ({ ...current, mp: value }))} />
              <Field label={t("damage")} value={derivedText.damage} onChange={(value) => setDerivedText((current) => ({ ...current, damage: value }))} />
              <Field label={t("build")} value={derivedText.build} numeric onChange={(value) => setDerivedText((current) => ({ ...current, build: value }))} />
              <Field label={t("mov")} value={derivedText.mov} numeric onChange={(value) => setDerivedText((current) => ({ ...current, mov: value }))} />
            </div>
            {detailSections("mt-3 border-t border-border pt-3")}
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <TextBlock label={t("appearance")} value={appearance} onChange={setAppearance} />
              <TextBlock label={t("notes")} value={notes} onChange={setNotes} />
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={onCancel}>
            {t("cancel")}
          </button>
          <button type="submit" className="rounded-md bg-primary px-3 py-1 text-primary-foreground">
            {actor ? t("save") : t("create")}
          </button>
        </div>
        {saveFailed ? <p className="mt-2 text-xs text-destructive">{t("actorSaveFailed")}</p> : null}
      </form>
    </div>
  );
}

function PortraitPicker({
  projectPath,
  src,
  label,
  className = "",
  onChange,
}: {
  projectPath: string;
  src: string;
  label: string;
  className?: string;
  onChange: (src: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    onChange(await savePastedImage(projectPath, file));
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        type="button"
        title={label}
        aria-label={label}
        data-portrait=""
        className={`grid h-full w-full place-items-center overflow-hidden rounded-md border text-xs text-muted-foreground hover:bg-muted ${src ? "border-solid border-border" : "border-dashed border-border"}`}
        onClick={() => inputRef.current?.click()}
      >
        {src ? (
          <StoredPortrait projectPath={projectPath} src={src} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1">
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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void loadImageObjectUrl(projectPath, src).then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      objectUrl = next;
      setUrl(next);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectPath, src]);

  return url ? <img src={url} alt="" className={className} /> : null;
}

function savedLinks(catalog: SceneCatalog, linked: string[]) {
  if (!catalog.ready) return linked;
  const present = presentSceneIds(catalog.nodes, catalog.trash);
  return linked.filter((id) => present.has(id));
}

function skillDraft(skill: { name: string; value: number }): SkillDraft {
  return { key: crypto.randomUUID(), name: skill.name, value: String(skill.value) };
}

function blankSkill(): SkillDraft {
  return { key: crypto.randomUUID(), name: "", value: "" };
}

function attackDraft(attack: { name: string; chance: number; damage: string; uses: string; note: string }): AttackDraft {
  return { key: crypto.randomUUID(), name: attack.name, chance: String(attack.chance), damage: attack.damage, uses: attack.uses, note: attack.note };
}

function blankAttack(): AttackDraft {
  return { key: crypto.randomUUID(), name: "", chance: "", damage: "", uses: "", note: "" };
}

function TextBlock({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-base">{label}</span>
      <textarea
        value={value}
        rows={2}
        className="w-full resize-y rounded-md border border-border bg-card px-2 py-1.5 outline-none"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="w-[4.5em] shrink-0 text-base">{label}</span>
      <input
        value={value}
        inputMode={numeric ? "numeric" : "text"}
        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 outline-none"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function statTextFrom(stats: Characteristics): typeof EMPTY_STAT_TEXT {
  return {
    str: String(stats.str),
    con: String(stats.con),
    siz: String(stats.siz),
    dex: String(stats.dex),
    app: String(stats.app),
    int: String(stats.int),
    pow: String(stats.pow),
    edu: String(stats.edu),
    luck: String(stats.luck),
  };
}

function derivedTextFrom(actor: Actor): DerivedText {
  return {
    hp: String(actor.derived.hp),
    mp: String(actor.derived.mp),
    san: String(actor.derived.san),
    damage: actor.derived.damage,
    build: String(actor.derived.build),
    mov: String(actor.derived.mov),
  };
}

function characteristicsFrom(text: typeof EMPTY_STAT_TEXT): Characteristics {
  return {
    str: numberOrZero(text.str),
    con: numberOrZero(text.con),
    siz: numberOrZero(text.siz),
    dex: numberOrZero(text.dex),
    app: numberOrZero(text.app),
    int: numberOrZero(text.int),
    pow: numberOrZero(text.pow),
    edu: numberOrZero(text.edu),
    luck: numberOrZero(text.luck),
  };
}

function derivedFieldsFrom(stats: Characteristics, age: string): DerivedText {
  const parsed = age.trim() === "" ? null : Number(age);
  const derived = derive(stats, parsed != null && Number.isFinite(parsed) ? parsed : null);
  return {
    hp: String(derived.hp),
    mp: String(derived.mp),
    san: String(derived.san),
    damage: derived.damage,
    build: String(derived.build),
    mov: String(derived.mov),
  };
}

function derivedFromText(text: DerivedText): Derived {
  return {
    hp: numberOrZero(text.hp),
    mp: numberOrZero(text.mp),
    san: numberOrZero(text.san),
    damage: text.damage.trim() || "0",
    build: numberOrZero(text.build),
    mov: numberOrZero(text.mov),
  };
}

function numberOrZero(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
