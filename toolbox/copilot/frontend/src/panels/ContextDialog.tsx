import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActorListItem, ArticleListItem, ModuleDataSource, ModuleRecord, SceneListNode } from "@ek/tool-api";
import { contextMessage, estimateTokens } from "../contextPrompt";
import { copilotT, type CopilotStringKey } from "../i18n";
import { useCopilotLocale } from "../locale";

type Row = { id: string; label: string; mark?: string };

const TOKEN_ESTIMATE_MS = 300;

type RecordCache = Map<string, Promise<ModuleRecord | null>>;

/** The dialog estimates tokens after every toggle; records it has already read are reused. */
function cachedSource(source: ModuleDataSource, cache: RecordCache): ModuleDataSource {
  return {
    ...source,
    readModuleRecord(moduleDir, kind, id) {
      const key = `${moduleDir}\n${kind}\n${id}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const pending = source.readModuleRecord(moduleDir, kind, id).catch((): ModuleRecord | null => null);
      cache.set(key, pending);
      return pending;
    },
  };
}

export type ContextTag = { kind: "scene" | "actor" | "article"; id: string; label: string };

function tagOf(rowId: string, label: string): ContextTag | null {
  const split = rowId.indexOf(":");
  const kind = rowId.slice(0, split);
  const id = rowId.slice(split + 1);
  if ((kind !== "scene" && kind !== "actor" && kind !== "article") || !id) return null;
  return { kind, id, label };
}

const button = "h-8 shrink-0 rounded-md border border-border px-3 hover:bg-muted";

function flatten(nodes: SceneListNode[], parentId: string | null = null): { id: string; title: string; parentId: string | null }[] {
  const rows: { id: string; title: string; parentId: string | null }[] = [];
  for (const node of nodes) {
    rows.push({ id: node.id, title: node.title, parentId });
    rows.push(...flatten(node.children, node.id));
  }
  return rows;
}

export function defaultContextTags(tree: SceneListNode[], actors: ActorListItem[], articles: ArticleListItem[], currentId: string): ContextTag[] {
  if (!currentId) return [];
  const tags: ContextTag[] = [];
  const scene = flatten(tree).find((row) => row.id === currentId);
  if (scene) tags.push({ kind: "scene", id: scene.id, label: scene.title });
  for (const actor of actors) {
    if (actor.kind !== "npc" || !actor.sceneIds.includes(currentId)) continue;
    tags.push({ kind: "actor", id: actor.id, label: actor.name });
  }
  for (const article of articles) {
    if (!article.sceneIds.includes(currentId)) continue;
    tags.push({ kind: "article", id: article.id, label: article.name });
  }
  return tags;
}

function relatedIds(rows: { id: string; parentId: string | null }[], currentId: string) {
  const ids = new Set<string>();
  const current = rows.find((row) => row.id === currentId);
  if (!current) return ids;
  if (current.parentId) ids.add(current.parentId);
  for (const row of rows) if (row.parentId === currentId) ids.add(row.id);
  return ids;
}

function Choice({ checked, label, mark, onChange }: { checked: boolean; label: string; mark?: string; onChange: () => void }) {
  return (
    <label className="inline-flex max-w-full items-center gap-1.5">
      <input type="checkbox" className="size-3.5 shrink-0" checked={checked} onChange={onChange} />
      <span className="truncate">{label}</span>
      {mark ? <span className="text-xs text-muted-foreground">{mark}</span> : null}
    </label>
  );
}

function Column({ title, linkedTitle, otherTitle, linked, other, picked, onToggle }: { title: string; linkedTitle: string; otherTitle: string; linked: Row[]; other: Row[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <h4 className="mb-1 text-base text-muted-foreground">{linkedTitle}</h4>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {linked.length === 0 ? <span className="text-muted-foreground">—</span> : linked.map((row) => <Choice key={row.id} checked={picked.has(row.id)} label={row.label} mark={row.mark} onChange={() => onToggle(row.id)} />)}
      </div>
      <h4 className="mt-3 mb-1 text-base text-muted-foreground">{otherTitle}</h4>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {other.length === 0 ? <span className="text-muted-foreground">—</span> : other.map((row) => <Choice key={row.id} checked={picked.has(row.id)} label={row.label} mark={row.mark} onChange={() => onToggle(row.id)} />)}
      </div>
    </section>
  );
}

export function ContextDialog({
  moduleDir,
  loadModuleData,
  template,
  selected,
  onClose,
  onConfirm,
  onAdvanced,
}: {
  moduleDir: string;
  loadModuleData?: (toolId: string) => Promise<ModuleDataSource | null>;
  template: string;
  selected: ContextTag[];
  onClose: () => void;
  onConfirm: (tags: ContextTag[]) => void;
  onAdvanced: () => void;
}) {
  const locale = useCopilotLocale();
  const t = (key: CopilotStringKey) => copilotT(locale, key);
  const [scenes, setScenes] = useState<Row[]>([]);
  const [linkedSceneIds, setLinkedSceneIds] = useState<Set<string>>(new Set());
  const [actors, setActors] = useState<(ActorListItem & { linked: boolean })[]>([]);
  const [articles, setArticles] = useState<(ArticleListItem & { linked: boolean })[]>([]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected.map((tag) => `${tag.kind}:${tag.id}`)));
  const [tokens, setTokens] = useState<number | null>(null);
  const pickedEdited = useRef(false);
  const recordCache = useRef<RecordCache>(new Map());
  const pickedKey = [...picked].sort().join("\n");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const source = await loadModuleData?.("ek.scenario");
      if (!source || !moduleDir || !alive) return;
      const [tree, actorList, articleList, current] = await Promise.all([
        source.listScenes(moduleDir),
        source.listActors(moduleDir),
        source.listArticles(moduleDir),
        source.currentScene(moduleDir),
      ]);
      if (!alive) return;
      const flat = flatten(tree);
      const currentId = current?.id ?? "";
      const related = relatedIds(flat, currentId);
      const near = new Set<string>(currentId ? [currentId, ...related] : []);
      setScenes(flat.map((row) => ({ id: `scene:${row.id}`, label: row.title })));
      setLinkedSceneIds(new Set([...near].map((id) => `scene:${id}`)));
      setActors(actorList.map((actor) => ({ ...actor, linked: currentId !== "" && actor.sceneIds.includes(currentId) })));
      setArticles(articleList.map((article) => ({ ...article, linked: currentId !== "" && article.sceneIds.includes(currentId) })));
    })();
    return () => {
      alive = false;
    };
  }, [loadModuleData, moduleDir]);

  useEffect(() => {
    if (pickedEdited.current) return;
    setPicked(new Set(selected.map((tag) => `${tag.kind}:${tag.id}`)));
  }, [selected]);

  useEffect(() => {
    let alive = true;
    const tags = pickedKey.split("\n").flatMap((rowId) => {
      const tag = tagOf(rowId, "");
      return tag ? [tag] : [];
    });
    // The first estimate runs at once; later ones wait for the user to stop toggling.
    const delay = tokens === null ? 0 : TOKEN_ESTIMATE_MS;
    const timer = window.setTimeout(() => {
      void (async () => {
        const source = await loadModuleData?.("ek.scenario");
        const text = await contextMessage(source ? cachedSource(source, recordCache.current) : source, moduleDir, tags, "", template);
        if (alive) setTokens(estimateTokens(text));
      })();
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // `tokens` only picks the delay; re-running on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, loadModuleData, moduleDir, template]);

  function toggle(id: string) {
    pickedEdited.current = true;
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sceneRows = {
    linked: scenes.filter((row) => linkedSceneIds.has(row.id)),
    other: scenes.filter((row) => !linkedSceneIds.has(row.id)),
  };
  const actorRows = {
    linked: actors.filter((actor) => actor.linked).map((actor) => ({ id: `actor:${actor.id}`, label: actor.name, mark: actor.kind === "monster" ? t("kindMonster") : t("kindNpc") })),
    other: actors.filter((actor) => !actor.linked).map((actor) => ({ id: `actor:${actor.id}`, label: actor.name, mark: actor.kind === "monster" ? t("kindMonster") : t("kindNpc") })),
  };
  const articleRows = {
    linked: articles.filter((article) => article.linked).map((article) => ({ id: `article:${article.id}`, label: article.name, mark: article.kind === "item" ? t("kindItem") : t("kindClue") })),
    other: articles.filter((article) => !article.linked).map((article) => ({ id: `article:${article.id}`, label: article.name, mark: article.kind === "item" ? t("kindItem") : t("kindClue") })),
  };

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6">
      <div
        role="dialog"
        aria-label={t("addContext")}
        className="flex max-h-full w-[min(660px,100%)] flex-col rounded-md border border-border bg-background p-4 text-sm text-foreground shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("addContext")}</h2>
          <button type="button" aria-label={t("close")} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="grid min-h-0 grid-cols-3 gap-4 overflow-auto">
          <Column title={t("contextScenes")} linkedTitle={t("contextLinked")} otherTitle={t("contextOther")} linked={sceneRows.linked} other={sceneRows.other} picked={picked} onToggle={toggle} />
          <Column title={t("contextActors")} linkedTitle={t("contextLinked")} otherTitle={t("contextOther")} linked={actorRows.linked} other={actorRows.other} picked={picked} onToggle={toggle} />
          <Column title={t("contextArticles")} linkedTitle={t("contextLinked")} otherTitle={t("contextOther")} linked={articleRows.linked} other={articleRows.other} picked={picked} onToggle={toggle} />
        </div>
        <div className="mt-3 flex flex-nowrap items-center justify-between gap-3 border-t border-border pt-3">
          <span className="flex shrink-0 items-center gap-2">
            <button type="button" className={button} onClick={onAdvanced}>{t("advancedMode")}</button>
            <span className="inline-block w-[13.5rem] shrink-0 text-left text-sm whitespace-nowrap tabular-nums text-muted-foreground">{t("contextTokens").replaceAll("{count}", tokens == null ? "…" : tokens.toLocaleString(locale === "zh" ? "zh-CN" : "en-US"))}</span>
          </span>
          <span className="flex shrink-0 gap-2">
            <button type="button" className={button} onClick={onClose}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="h-8 shrink-0 rounded-md border border-foreground bg-foreground px-3 text-background"
              onClick={() => {
                const rows = [...sceneRows.linked, ...sceneRows.other, ...actorRows.linked, ...actorRows.other, ...articleRows.linked, ...articleRows.other];
                const tags = [...picked].flatMap((id) => {
                  const row = rows.find((item) => item.id === id);
                  const tag = row ? tagOf(row.id, row.label) : selected.find((item) => `${item.kind}:${item.id}` === id);
                  return tag ? [tag] : [];
                });
                onConfirm(tags);
              }}
            >
              {t("ok")}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
