import { savePastedImage, useProjectImage } from "@ek/tool-api";
import { DicesIcon, Filter, ImagePlus, Plus, User, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { applyActorArticles, publishActorIndex, publishArticles, readArticles, subscribeArticles } from "../articleStore";
import { derive, rollCharacteristics, type Characteristics, type Derived } from "../cocSheet";
import {
  ensureScenarioSchema,
  insertScenarioActor,
  loadScenarioActor,
  loadScenarioActors,
  deleteScenarioActor,
  projectDatabaseAvailable,
  setActorArticles,
  setScenarioActorTrashed,
  updateScenarioActor,
  type ScenarioActor,
  type ScenarioArticle,
} from "../db";
import { onOpenEntity } from "../entityLink";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { ListTrash } from "./ListTrash";
import { deleteRecordActor, ensureRecordSchema, insertRecordMonster, loadRecordActors, loadRecordMonsters, saveRecordActor, saveRecordMonster, type RecordActorVitals, type RecordMonster } from "../play/recordDb";
import { presentSceneIds, readSceneCatalog, sceneLinkRows, subscribeSceneCatalog, type SceneCatalog } from "../sceneLinks";
import { clearWriteError, reportWriteError } from "../writeStatus";

type Kind = "npc" | "monster";

type Actor = ScenarioActor;

/** `key` stays fixed while the dialog is open, so applying a new actor does not remount it. */
type Draft = { kind: Kind; actor: Actor | null; key: string };

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;
const ATTRIBUTE_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"] as const;

const EMPTY_STATS: Characteristics = { str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0, luck: 0 };

const EMPTY_STAT_TEXT = { str: "", con: "", siz: "", dex: "", app: "", int: "", pow: "", edu: "", luck: "" };

type DerivedText = { hp: string; mp: string; san: string; damage: string; build: string; mov: string };

type SkillDraft = { key: string; name: string; value: string };

type AttackDraft = { key: string; name: string; chance: string; damage: string; uses: string; note: string };

const EMPTY_DERIVED_TEXT: DerivedText = { hp: "", mp: "", san: "", damage: "", build: "", mov: "" };

export function NpcColumn({
  locale,
  projectPath,
  recordPath = "",
  selected,
  editable,
}: {
  locale: ScenarioLocale;
  projectPath: string;
  recordPath?: string;
  selected: string;
  editable: boolean;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [actors, setActors] = useState<Actor[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; trashed: boolean; x: number; y: number } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sheet, setSheet] = useState<Actor | null>(null);
  const [recordActors, setRecordActors] = useState<RecordActorVitals[]>([]);
  const [monsters, setMonsters] = useState<RecordMonster[]>([]);
  const [monsterId, setMonsterId] = useState<string | null>(null);
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
    publishActorIndex(actors.map((actor) => ({ id: actor.id, name: actor.name, kind: actor.kind, trashed: actor.trashed, links: actor.links })));
  }, [actors]);

  useEffect(() => {
    if (!recordPath || !projectDatabaseAvailable()) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureRecordSchema(recordPath);
        const rows = await loadRecordActors(recordPath);
        if (!cancelled) setRecordActors(rows);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordPath]);

  useEffect(() => {
    if (!recordPath || !projectDatabaseAvailable()) return;
    let cancelled = false;
    void loadRecordMonsters(recordPath).then((rows) => {
      if (!cancelled) setMonsters(rows);
    }).catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [recordPath]);

  useEffect(() => {
    if (editable) {
      setSheet(null);
      setMonsterId(null);
    }
  }, [editable]);

  useEffect(() => onOpenEntity((detail) => {
    if (detail.kind !== "npc" && detail.kind !== "monster") return;
    const actor = actors.find((item) => item.id === detail.id);
    if (!actor) return;
    setPicked(actor.id);
    if (detail.mode === "read" && !editable) {
      setMonsterId(null);
      setSheet(actor);
      return;
    }
    if (detail.mode === "edit" && editable) {
      setSheet(null);
      setMonsterId(null);
      setDraft({ kind: actor.kind, actor, key: actor.id });
    }
  }), [actors, editable]);

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
    setDraft({ kind, actor: null, key: `new-${crypto.randomUUID()}` });
  }

  /**
   * Run one database write and report a failure in the host status bar. The list state is only
   * touched after the write succeeded, so a failed write leaves the UI as it was.
   */
  async function writeActor<T>(id: string, name: string | undefined, work: () => Promise<T>): Promise<T | undefined> {
    const key = `actor.${id}`;
    try {
      const result = await work();
      clearWriteError(key);
      return result;
    } catch (error) {
      reportWriteError(key, `${t("actorWriteFailed")} · ${name || actors.find((item) => item.id === id)?.name || id}`, error);
      return undefined;
    }
  }

  async function save(actor: Actor, articleIds: string[], close: boolean) {
    if (!editable || projectPath === "") return;
    const existing = !!draft?.actor;
    let saved: Actor = actor;
    if (usingDb) {
      const stored = await writeActor(actor.id, actor.name, async () => {
        await ensureScenarioSchema(projectPath);
        if (existing) await updateScenarioActor(projectPath, actor);
        else await insertScenarioActor(projectPath, actor);
        await setActorArticles(projectPath, actor.id, articleIds);
        // Only this actor is read back: an insert gets its `position` from SQL.
        return loadScenarioActor(projectPath, actor.id);
      });
      if (stored === undefined) return;
      saved = stored ?? actor;
    }
    if (existing) setActors((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    else setActors((items) => [...items, saved]);
    publishArticles(applyActorArticles(readArticles(), saved.id, articleIds));
    setDraft((current) => (close || !current ? null : { ...current, actor: saved }));
  }

  async function moveActor(id: string, trashed: boolean) {
    setRowMenu(null);
    if (!editable || projectPath === "") return;
    if (trashed) setTrashOpen(true);
    if (usingDb) {
      const done = await writeActor(id, undefined, () => setScenarioActorTrashed(projectPath, id, trashed).then(() => true));
      if (!done) return;
    }
    setActors((items) => items.map((item) => (item.id === id ? { ...item, trashed } : item)));
  }

  function npcVitals(actor: Actor): RecordActorVitals {
    return { actorId: actor.id, hp: actor.derived.hp, mp: actor.derived.mp, san: actor.derived.san, luck: actor.stats.luck };
  }

  async function activateNpc(actor: Actor) {
    if (!recordPath || recordActors.some((row) => row.actorId === actor.id)) return;
    const next = npcVitals(actor);
    await saveRecordActor(recordPath, next);
    setRecordActors((current) => [...current, next]);
    setPicked(actor.id);
    setMonsterId(null);
    setSheet(actor);
  }

  async function resetNpc(actor: Actor) {
    if (!recordPath) return;
    await deleteRecordActor(recordPath, actor.id);
    setRecordActors((current) => current.filter((row) => row.actorId !== actor.id));
  }

  async function updateNpc(actorId: string, vitals: { hp: number; mp: number; san: number; luck: number }) {
    if (!recordPath) return;
    const next = { actorId, ...vitals };
    setRecordActors((current) => current.map((row) => (row.actorId === actorId ? next : row)));
    await saveRecordActor(recordPath, next);
  }

  async function addMonster(actor: Actor) {
    if (!recordPath) return;
    const created = await insertRecordMonster(recordPath, actor.id, {
      hp: actor.derived.hp,
      mp: actor.derived.mp,
      san: actor.derived.san,
      luck: actor.stats.luck,
    });
    if (!created) return;
    setMonsters((current) => [...current, created].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)));
    setPicked(created.id);
    setMonsterId(created.id);
    setSheet(actor);
  }

  async function updateMonster(id: string, vitals: { hp: number; mp: number; san: number; luck: number }) {
    if (!recordPath) return;
    setMonsters((current) => current.map((monster) => (monster.id === id ? { ...monster, ...vitals } : monster)));
    await saveRecordMonster(recordPath, { id, ...vitals });
  }

  async function purgeActor(id: string) {
    setRowMenu(null);
    if (!editable || projectPath === "") return;
    if (usingDb) {
      const done = await writeActor(id, undefined, () => deleteScenarioActor(projectPath, id).then(() => true));
      if (!done) return;
    }
    if (draft?.actor?.id === id) setDraft(null);
    setActors((items) => items.filter((item) => item.id !== id));
    publishArticles(readArticles().map((item) => ({ ...item, actors: item.actors.filter((actorId) => actorId !== id) })));
  }

  function renderActor(actor: Actor) {
    return (
      <div
        key={actor.id}
        data-actor={actor.kind}
        data-trashed={actor.trashed ? "true" : "false"}
        data-selected={picked === actor.id ? "true" : "false"}
        draggable={editable}
        onDragStart={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("text/plain", actor.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className={`flex h-7 cursor-default select-none items-center gap-2 px-2.5 ${picked === actor.id ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"}`}
        onClick={(event) => {
          if (!editable) {
            setPicked(actor.id);
            setMonsterId(null);
            setSheet(actor);
            return;
          }
          if (event.detail > 1) {
            setPicked(actor.id);
            return;
          }
          setPicked((current) => (current === actor.id ? null : actor.id));
        }}
        onDoubleClick={() => {
          if (!editable) return;
          setPicked(actor.id);
          setDraft({ kind: actor.kind, actor, key: actor.id });
        }}
        onContextMenu={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          setRowMenu({ id: actor.id, trashed: actor.trashed, x: event.clientX, y: event.clientY });
        }}
      >
        {actor.portrait ? <StoredPortrait projectPath={projectPath} src={actor.portrait} className="size-6 shrink-0 rounded-full object-cover" /> : null}
        <span className="min-w-0 flex-1 truncate">{actor.name}</span>
        <span className="flex w-16 shrink-0 items-center justify-end gap-1.5">
          <span className="w-8 text-right text-xs text-muted-foreground">{actor.kind === "npc" ? "NPC" : t("monster")}</span>
          <span className="grid size-5 place-items-center">
            {!editable && actor.kind === "npc" && <NpcMark actor={actor} row={recordActors.find((row) => row.actorId === actor.id)} label={t} onActivate={() => void activateNpc(actor)} />}
            {!editable && actor.kind === "monster" && (
              <button
                type="button"
                title={t("create")}
                aria-label={t("create")}
                data-monster-add={actor.id}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  void addMonster(actor);
                }}
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 text-base font-semibold">
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
        {editable && (
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
        )}
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
        {(linkedOnly ? actors.filter((actor) => !actor.trashed && selected !== "" && actor.links.includes(selected)) : actors.filter((actor) => !actor.trashed)).map((actor) => (
          <div key={actor.id}>
            {renderActor(actor)}
            {!editable && actor.kind === "monster" && monsters.filter((monster) => monster.actorId === actor.id).map((monster, index) => (
              <div
                key={monster.id}
                data-monster={monster.id}
                data-selected={picked === monster.id ? "true" : "false"}
                className={`flex h-7 cursor-default select-none items-center pl-7 pr-2.5 ${picked === monster.id ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"}`}
                onClick={() => {
                  setPicked(monster.id);
                  setMonsterId(monster.id);
                  setSheet(actor);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{actor.name} {index + 1}</span>
                <span className="grid size-5 shrink-0 place-items-center">
                  <span
                    title={monster.hp <= 0 ? t("npcDown") : undefined}
                    data-monster-state={monster.hp <= 0 ? "down" : "on"}
                    className={`size-2.5 rounded-full ${monster.hp <= 0 ? "bg-red-500" : "bg-green-500"}`}
                  />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {editable && (
        <ListTrash title={t("trash")} open={trashOpen} onToggle={() => setTrashOpen((open) => !open)} onReceive={(id) => void moveActor(id, true)}>
          {actors.filter((actor) => actor.trashed).map((actor) => renderActor(actor))}
        </ListTrash>
      )}
      {menu && (
        <div
          data-npc-menu=""
          className="fixed z-30 min-w-36 -translate-x-full rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
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
          className="fixed z-30 min-w-36 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
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
      {!editable && sheet && (() => {
        const base = actors.find((actor) => actor.id === sheet.id) ?? sheet;
        const record = recordActors.find((row) => row.actorId === base.id);
        const instance = monsters.find((monster) => monster.id === monsterId) ?? null;
        const npcLive = base.kind === "npc" && record && !instance ? record : null;
        return (
          <ReadOnlyActorSheet
            locale={locale}
            projectPath={projectPath}
            actor={base}
            vitals={instance ?? npcLive}
            titleId={titleId}
            onClose={() => {
              setSheet(null);
              setMonsterId(null);
            }}
            onSaveVitals={(next) => {
              if (monsterId) void updateMonster(monsterId, next);
              else if (npcLive) void updateNpc(base.id, next);
            }}
            onActivate={base.kind === "npc" && !record && !instance ? () => void activateNpc(base) : undefined}
            onReset={npcLive ? () => void resetNpc(base) : undefined}
          />
        );
      })()}
      {editable && draft && (
        <ActorDialog
          key={draft.key}
          locale={locale}
          projectPath={projectPath}
          kind={draft.kind}
          actor={draft.actor}
          selected={selected}
          titleId={titleId}
          editable={editable}
          onCancel={() => setDraft(null)}
          onSave={(actor, articleIds, close) => void save(actor, articleIds, close)}
        />
      )}
    </div>
  );
}

function ReadOnlyActorSheet({
  locale,
  projectPath,
  actor,
  vitals,
  titleId,
  onClose,
  onSaveVitals,
  onActivate,
  onReset,
}: {
  locale: ScenarioLocale;
  projectPath: string;
  actor: Actor;
  vitals: { hp: number; mp: number; san: number; luck: number } | null;
  titleId: string;
  onClose: () => void;
  onSaveVitals: (next: { hp: number; mp: number; san: number; luck: number }) => void;
  onActivate?: () => void;
  onReset?: () => void;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const confirmId = useId();
  const [confirmReset, setConfirmReset] = useState(false);
  const [hp, setHp] = useState(String(vitals?.hp ?? actor.derived.hp));
  const [mp, setMp] = useState(String(vitals?.mp ?? actor.derived.mp));
  const [san, setSan] = useState(String(vitals?.san ?? actor.derived.san));
  const [luck, setLuck] = useState(String(vitals?.luck ?? actor.stats.luck));
  useEffect(() => {
    setHp(String(vitals?.hp ?? actor.derived.hp));
    setMp(String(vitals?.mp ?? actor.derived.mp));
    setSan(String(vitals?.san ?? actor.derived.san));
    setLuck(String(vitals?.luck ?? actor.stats.luck));
  }, [actor, vitals]);

  function commit(field: "hp" | "mp" | "san" | "luck", value: string) {
    if (!vitals) return;
    const next = { hp, mp, san, luck, [field]: value };
    onSaveVitals({ hp: wholeAtLeastZero(next.hp), mp: wholeAtLeastZero(next.mp), san: wholeAtLeastZero(next.san), luck: wholeAtLeastZero(next.luck) });
  }
  const [articles, setArticles] = useState<ScenarioArticle[]>(readArticles);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => subscribeArticles(setArticles), []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmReset) {
        setConfirmReset(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, confirmReset]);

  const linkedArticles = articles.filter((item) => item.actors.includes(actor.id));
  const stats = [
    ["str", actor.stats.str],
    ["con", actor.stats.con],
    ["siz", actor.stats.siz],
    ["dex", actor.stats.dex],
    ["app", actor.stats.app],
    ["int", actor.stats.int],
    ["pow", actor.stats.pow],
    ["edu", actor.stats.edu],
  ] as const;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-labelledby={titleId}
        data-actor-sheet={actor.kind}
        className="relative flex max-h-full w-[min(660px,100%)] flex-col rounded-md border border-border bg-background text-sm shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-3 py-2">
          {onActivate && (
            <button type="button" className="rounded-md bg-primary px-3 py-1 text-base text-primary-foreground" onClick={onActivate}>
              {t("activateNpc")}
            </button>
          )}
          {onReset && (
            <button type="button" className="rounded-md bg-primary px-3 py-1 text-base text-primary-foreground" onClick={() => setConfirmReset(true)}>
              {t("reset")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("close")}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-auto p-4">
        {actor.kind === "monster" ? (
          <MonsterSheetBody
            actor={actor}
            locale={locale}
            articles={linkedArticles}
            hp={hp}
            mp={mp}
            editable={vitals !== null}
            setHp={setHp}
            setMp={setMp}
            commit={commit}
            setTip={setTip}
          />
        ) : (
        <>
        <div className="grid grid-cols-[minmax(0,1fr)_11.25rem] items-start gap-x-6">
          <div className="min-w-0">
            <h2 id={titleId} className="sr-only">{actor.name}</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Fact label={t("fullName")} value={actor.name} />
              <Fact label={t("occupation")} value={actor.occupation} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2">
              <Fact label={t("nativeLanguage")} value={actor.nativeLanguage} />
              <Fact label={t("gender")} value={actor.gender} />
              <Fact label={t("age")} value={actor.age} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2">
              <Fact label={t("damage")} value={actor.derived.damage} />
              <Fact label={t("build")} value={String(actor.derived.build)} />
              <Fact label={t("mov")} value={String(actor.derived.mov)} />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-x-4 gap-y-2 border-b border-border pb-3">
              <Vital label={t("hp")} value={hp} editable={vitals !== null} onChange={setHp} onCommit={(value) => commit("hp", value)} />
              <Vital label={t("mp")} value={mp} editable={vitals !== null} onChange={setMp} onCommit={(value) => commit("mp", value)} />
              <Vital label={t("san")} value={san} editable={vitals !== null} onChange={setSan} onCommit={(value) => commit("san", value)} />
              <Vital label={t("luck")} value={luck} editable={vitals !== null} onChange={setLuck} onCommit={(value) => commit("luck", value)} />
            </div>
            <div className="mt-4 space-y-3">
              <div className="border-b border-border pb-3">
                <Prose label={t("appearance")} value={actor.appearance} />
              </div>
              <Prose label={t("portrayal")} value={actor.portrayal} />
            </div>
          </div>
          <div className="min-w-0">
            {actor.portrait ? (
              <StoredPortrait projectPath={projectPath} src={actor.portrait} className="h-36 w-full rounded-md object-contain" />
            ) : actor.kind === "npc" ? (
              <div className="grid h-36 w-full place-items-center rounded-md bg-sky-100 text-sky-600">
                <User className="size-16" strokeWidth={1.5} />
              </div>
            ) : (
              <div className="h-36 w-full rounded-md bg-muted" />
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
              {stats.map(([key, value]) => (
                <Fact key={key} label={t(key)} value={String(value)} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <div className="border-b border-border pb-3">
            <Prose label={t("backstory")} value={actor.backstory} />
          </div>
          <Prose label={t("notes")} value={actor.notes} />
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-base text-muted-foreground">{t("clues")}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-base">
            {linkedArticles.length === 0 ? <span>—</span> : linkedArticles.map((item) => (
              <span
                key={item.id}
                data-article-link={item.id}
                data-trashed={item.trashed ? "true" : "false"}
                className={item.trashed ? "text-muted-foreground opacity-60" : ""}
                onMouseEnter={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setTip({ text: item.description, x: box.left, y: box.bottom + 6 });
                }}
                onMouseLeave={() => setTip(null)}
              >
                {item.name || (item.kind === "clue" ? t("untitledClue") : t("untitledItem"))}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-base text-muted-foreground">{t("skills")}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base">
            {actor.skills.length === 0 ? <span>—</span> : actor.skills.map((skill, index) => (
              <span key={`${skill.name}-${index}`}>{skill.name} {skill.value}</span>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-base text-muted-foreground">{t("weapons")}</div>
          <div className="mt-1 space-y-2">
            {actor.attacks.length === 0 ? <span className="text-base">—</span> : actor.attacks.map((attack, index) => (
              <div key={`${attack.name}-${index}`} className="flex flex-wrap gap-x-4 gap-y-1">
                <Fact label={t("weaponName")} value={attack.name} />
                <Fact label={t("skillValue")} value={String(attack.chance)} />
                <Fact label={t("weaponDamage")} value={attack.damage} />
                <Fact label={t("weaponNote")} value={attack.note} />
              </div>
            ))}
          </div>
        </div>
        </>
        )}
        </div>
        {confirmReset && onReset && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6">
            <div
              role="alertdialog"
              aria-labelledby={confirmId}
              data-reset-confirm=""
              className="w-[min(360px,100%)] rounded-md border border-border bg-background p-4 shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <h2 id={confirmId} className="text-base font-semibold">{t("reset")}</h2>
              <p className="mt-2 text-sm">{t("resetStateAsk")}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={() => setConfirmReset(false)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1 text-primary-foreground"
                  onClick={() => {
                    setConfirmReset(false);
                    onReset();
                  }}
                >
                  {t("confirm")}
                </button>
              </div>
            </div>
          </div>
        )}
        {tip && (
          <div
            className="pointer-events-none fixed z-50 w-56 rounded-md border border-border bg-popover px-2 py-1 text-base whitespace-pre-wrap text-popover-foreground shadow-md"
            style={{ left: tip.x, top: tip.y }}
          >
            {tip.text.trim() ? tip.text : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

function MonsterSheetBody({
  actor,
  locale,
  articles,
  hp,
  mp,
  editable,
  setHp,
  setMp,
  commit,
  setTip,
}: {
  actor: Actor;
  locale: ScenarioLocale;
  articles: ScenarioArticle[];
  hp: string;
  mp: string;
  editable: boolean;
  setHp: (value: string) => void;
  setMp: (value: string) => void;
  commit: (field: "hp" | "mp" | "san" | "luck", value: string) => void;
  setTip: (tip: { text: string; x: number; y: number } | null) => void;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  return (
    <div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        <Fact label={t("actorName")} value={actor.name} />
        <Vital label={t("hp")} value={hp} editable={editable} onChange={setHp} onCommit={(value) => commit("hp", value)} />
        <Vital label={t("mp")} value={mp} editable={editable} onChange={setMp} onCommit={(value) => commit("mp", value)} />
        <Fact label={t("damage")} value={actor.derived.damage} />
        <Fact label={t("build")} value={String(actor.derived.build)} />
        <Fact label={t("mov")} value={String(actor.derived.mov)} />
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="text-base text-muted-foreground">{t("weapons")}</div>
        <div className="mt-1 space-y-2">
          {actor.attacks.length === 0 ? <span className="text-base">—</span> : actor.attacks.map((attack, index) => (
            <div key={`${attack.name}-${index}`} className="flex flex-wrap gap-x-4 gap-y-1">
              <Fact label={t("weaponName")} value={attack.name} />
              <Fact label={t("skillValue")} value={String(attack.chance)} />
              <Fact label={t("weaponDamage")} value={attack.damage} />
              <Fact label={t("weaponNote")} value={attack.note} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="text-base text-muted-foreground">{t("clues")}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-base">
          {articles.length === 0 ? <span>—</span> : articles.map((item) => (
            <span
              key={item.id}
              className={item.trashed ? "text-muted-foreground opacity-60" : ""}
              onMouseEnter={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setTip({ text: item.description, x: box.left, y: box.bottom + 6 });
              }}
              onMouseLeave={() => setTip(null)}
            >
              {item.name || (item.kind === "clue" ? t("untitledClue") : t("untitledItem"))}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-3 border-t border-border pt-3">
        <div className="border-b border-border pb-3">
          <Prose label={t("appearance")} value={actor.appearance} />
        </div>
        <Prose label={t("notes")} value={actor.notes} />
      </div>
    </div>
  );
}

const VITAL_COMMIT_MS = 400;

function Vital({
  label,
  value,
  editable,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  // Typing commits after a pause; the spinner arrows, Enter, and blur commit at once.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  function flush() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next !== null) commitRef.current(next);
  }

  function commitLater(raw: string) {
    pending.current = raw;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, VITAL_COMMIT_MS);
  }

  function commitNow(raw: string) {
    pending.current = raw;
    flush();
  }

  useEffect(() => flush, []);

  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="shrink-0 text-base text-muted-foreground">{label}</span>
      {editable ? (
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          className="w-12 max-w-12 shrink border-b border-border bg-transparent text-base outline-none"
          onChange={(event) => {
            const raw = event.target.value;
            if (raw !== "" && !/^\d+$/.test(raw)) return;
            onChange(raw);
            if (!/^\d+$/.test(raw)) return;
            // Keyboard edits carry an inputType; the spinner arrows and arrow keys do not.
            const typed = typeof (event.nativeEvent as Partial<InputEvent>).inputType === "string";
            if (typed) commitLater(raw);
            else commitNow(raw);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const next = event.target.value.trim() === "" ? "0" : String(wholeAtLeastZero(event.target.value));
            onChange(next);
            commitNow(next);
          }}
        />
      ) : (
        <span className="text-base">{value.trim() ? value : "—"}</span>
      )}
    </span>
  );
}

function NpcMark({
  actor,
  row,
  label,
  onActivate,
}: {
  actor: Actor;
  row: RecordActorVitals | undefined;
  label: (key: ScenarioStringKey) => string;
  onActivate: () => void;
}) {
  const state = !row ? "off" : row.hp <= 0 ? "down" : "on";
  const title = state === "off" ? label("activateNpc") : state === "down" ? label("npcDown") : label("npcActive");
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-npc-state={state}
      data-npc-activate={actor.id}
      className={`size-2.5 shrink-0 rounded-full ${state === "off" ? "bg-zinc-400" : state === "down" ? "bg-red-500" : "bg-green-500"}`}
      onClick={(event) => {
        event.stopPropagation();
        if (state === "off") onActivate();
      }}
    />
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

function Prose({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base text-muted-foreground">{label}</div>
      <p className="mt-0.5 whitespace-pre-wrap text-base">{value.trim() ? value : "—"}</p>
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
  editable,
  onCancel,
  onSave,
}: {
  locale: ScenarioLocale;
  projectPath: string;
  kind: Kind;
  actor: Actor | null;
  selected: string;
  titleId: string;
  editable: boolean;
  onCancel: () => void;
  onSave: (actor: Actor, articleIds: string[], close: boolean) => void | Promise<void>;
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
  const [saving, setSaving] = useState(false);
  // Walking the scene tree on every keystroke in the form is wasted work; only these inputs matter.
  const linkRows = useMemo(() => sceneLinkRows(catalog.nodes, catalog.trash, new Set(linked)), [catalog, linked]);

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

  function submit(close: boolean) {
    if (saving) return;
    const fallback = kind === "npc" ? t("untitledNpc") : t("untitledMonster");
    setSaveFailed(false);
    setSaving(true);
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
        position: actor?.position ?? 0,
      }, articleIds, close),
    )
      .catch((error: unknown) => {
        console.error(error);
        setSaveFailed(true);
      })
      .finally(() => setSaving(false));
  }

  function detailSections(className: string) {
    return (
      <>
        <div className={className}>
          <h3 className="mb-2 text-base text-muted-foreground">{t("weapons")}</h3>
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
          <h3 className="mb-2 text-base text-muted-foreground">{t("sceneLinks")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {linkRows.map((row) => (
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
          <h3 className="mb-2 text-base text-muted-foreground">{t("clues")}</h3>
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
                  <span className="text-xs text-muted-foreground">{item.kind === "clue" ? t("clue") : t("item")}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6">
      <form
        role="dialog"
        aria-labelledby={titleId}
        data-actor-form={kind}
        className="max-h-full w-[min(990px,100%)] overflow-auto rounded-md border border-border bg-background p-4 text-sm shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!editable) return;
          submit(true);
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 text-base font-semibold">
            {actor ? name.trim() || (kind === "npc" ? t("untitledNpc") : t("untitledMonster")) : kind === "npc" ? t("newCocNpc") : t("quickMonster")}
          </h2>
          <button type="button" aria-label={t("close")} className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onCancel}>
            <X className="size-4" />
          </button>
        </div>
        <fieldset disabled={!editable} className="min-w-0 border-0 p-0">
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
                <h3 className="mb-2 text-base text-muted-foreground">{t("initialState")}</h3>
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
              <h3 className="mb-2 text-base text-muted-foreground">{t("skills")}</h3>
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
        </fieldset>
        <div className="mt-3 flex justify-end gap-2">
          {editable && (
            <button type="button" disabled={saving} className="rounded-md px-3 py-1 hover:bg-muted disabled:opacity-50" onClick={() => submit(false)}>
              {t("apply")}
            </button>
          )}
          <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={onCancel}>
            {editable ? t("cancel") : t("close")}
          </button>
          {editable && (
            <button type="submit" disabled={saving} className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">
              {actor ? t("save") : t("create")}
            </button>
          )}
        </div>
        {saveFailed ? <p className="mt-2 text-sm text-destructive">{t("actorSaveFailed")}</p> : null}
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
    if (!projectPath) return;
    onChange(await savePastedImage(projectPath, file));
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        type="button"
        title={label}
        aria-label={label}
        data-portrait=""
        className={`grid h-full w-full place-items-center overflow-hidden rounded-md border text-sm text-muted-foreground hover:bg-muted ${src ? "border-solid border-border" : "border-dashed border-border"}`}
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
  const { url, onError } = useProjectImage(projectPath, src);

  return url ? <img src={url} alt="" className={className} onError={onError} /> : null;
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

function wholeAtLeastZero(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function numberOrZero(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
