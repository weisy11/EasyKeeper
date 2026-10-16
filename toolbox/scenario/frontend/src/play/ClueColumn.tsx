import { Filter, Plus, X } from "lucide-react";
import { ListTrash } from "../panels/ListTrash";
import { useEffect, useId, useState } from "react";
import { publishArticles, readActorIndex, readArticles, subscribeActorIndex, subscribeArticles, type ActorIndexEntry } from "./articleStore";
import {
  deleteScenarioArticle,
  ensureScenarioSchema,
  insertScenarioArticle,
  loadScenarioArticles,
  projectDatabaseAvailable,
  setScenarioArticleTrashed,
  updateScenarioArticle,
  type ScenarioArticle,
} from "../db";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { discoverArticle, loadFoundArticles, resetArticle } from "./recordDb";
import { presentSceneIds, readSceneCatalog, sceneLinkRows, subscribeSceneCatalog, type SceneCatalog } from "./sceneCatalog";

type Kind = ScenarioArticle["kind"];

export function ClueColumn({
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
  const [articles, setArticles] = useState<ScenarioArticle[]>(readArticles);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; trashed: boolean; x: number; y: number } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [draft, setDraft] = useState<{ kind: Kind; article: ScenarioArticle | null } | null>(null);
  const [sheet, setSheet] = useState<ScenarioArticle | null>(null);
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const titleId = useId();
  const usingDb = projectDatabaseAvailable() && projectPath !== "";

  useEffect(() => subscribeArticles(setArticles), []);

  useEffect(() => {
    if (editable) setSheet(null);
  }, [editable]);

  useEffect(() => {
    if (!recordPath || !projectDatabaseAvailable()) return;
    let cancelled = false;
    void loadFoundArticles(recordPath).then((ids) => {
      if (!cancelled) setFoundIds(ids);
    }).catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [recordPath]);

  useEffect(() => {
    if (!usingDb) {
      publishArticles([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await ensureScenarioSchema(projectPath);
        const rows = await loadScenarioArticles(projectPath);
        if (!cancelled) publishArticles(rows);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, usingDb]);

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
    setDraft({ kind, article: null });
  }

  async function save(article: ScenarioArticle) {
    if (!editable || !usingDb) return;
    await ensureScenarioSchema(projectPath);
    if (draft?.article) await updateScenarioArticle(projectPath, article);
    else await insertScenarioArticle(projectPath, article);
    publishArticles(await loadScenarioArticles(projectPath));
    setDraft(null);
  }

  async function moveArticle(id: string, trashed: boolean) {
    setRowMenu(null);
    if (!editable || !usingDb) return;
    if (trashed) setTrashOpen(true);
    await setScenarioArticleTrashed(projectPath, id, trashed);
    publishArticles(await loadScenarioArticles(projectPath));
  }

  async function discover(id: string) {
    if (!recordPath || foundIds.includes(id)) return;
    await discoverArticle(recordPath, id);
    setFoundIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  async function resetFound(id: string) {
    if (!recordPath) return;
    await resetArticle(recordPath, id);
    setFoundIds((current) => current.filter((item) => item !== id));
  }

  async function purgeArticle(id: string) {
    setRowMenu(null);
    if (!editable || !usingDb) return;
    if (draft?.article?.id === id) setDraft(null);
    await deleteScenarioArticle(projectPath, id);
    publishArticles(await loadScenarioArticles(projectPath));
  }

  function renderArticle(article: ScenarioArticle) {
    return (
      <div
        key={article.id}
        data-article={article.kind}
        data-trashed={article.trashed ? "true" : "false"}
        data-selected={picked === article.id ? "true" : "false"}
        draggable={editable}
        onDragStart={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("text/plain", article.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className={`flex h-7 cursor-default select-none items-center gap-2 px-2.5 ${picked === article.id ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"}`}
        onClick={(event) => {
          if (!editable) {
            setPicked(article.id);
            setSheet(article);
            return;
          }
          if (event.detail > 1) {
            setPicked(article.id);
            return;
          }
          setPicked((current) => (current === article.id ? null : article.id));
        }}
        onDoubleClick={() => {
          if (!editable) return;
          setPicked(article.id);
          setDraft({ kind: article.kind, article });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!editable) return;
          setRowMenu({ id: article.id, trashed: article.trashed, x: event.clientX, y: event.clientY });
        }}
      >
        <span className="min-w-0 flex-1 truncate">{article.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{article.kind === "clue" ? t("clue") : t("item")}</span>
        {!editable && (
          <FindMark
            found={foundIds.includes(article.id)}
            title={foundIds.includes(article.id) ? t("discovered") : t("discover")}
            onDiscover={() => void discover(article.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 text-xs font-semibold">
        <span className="min-w-0 flex-1 truncate">{t("clues")}</span>
        <button
          type="button"
          title={t("filterByScene")}
          aria-label={t("filterByScene")}
          aria-pressed={linkedOnly}
          data-clue-filter=""
          className={`grid size-6 place-items-center rounded font-normal ${linkedOnly ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onClick={() => setLinkedOnly((current) => !current)}
        >
          <Filter className="size-3.5" />
        </button>
        {editable && (
          <button
            type="button"
            title={t("create")}
            aria-label={t("create")}
            data-clue-add=""
            className="grid size-6 place-items-center rounded font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setMenu({ x: bounds.left, y: bounds.bottom + 4 });
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
          const article = articles.find((item) => item.id === id);
          if (article?.trashed) void moveArticle(id, false);
        }}
      >
        {(linkedOnly ? articles.filter((article) => !article.trashed && selected !== "" && article.scenes.includes(selected)) : articles.filter((article) => !article.trashed)).map((article) => renderArticle(article))}
      </div>
      {editable && (
        <ListTrash title={t("trash")} open={trashOpen} onToggle={() => setTrashOpen((open) => !open)} onReceive={(id) => void moveArticle(id, true)}>
          {articles.filter((article) => article.trashed).map((article) => renderArticle(article))}
        </ListTrash>
      )}
      {menu && (
        <div
          data-clue-menu=""
          className="fixed z-30 min-w-36 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => openForm("clue")}>
            {t("newClue")}
          </button>
          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => openForm("item")}>
            {t("newItem")}
          </button>
        </div>
      )}
      {rowMenu && (
        <div
          data-article-menu=""
          className="fixed z-30 min-w-36 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-destructive hover:bg-accent"
            onClick={() => void (rowMenu.trashed ? purgeArticle(rowMenu.id) : moveArticle(rowMenu.id, true))}
          >
            {rowMenu.trashed ? t("deleteNode") : t("moveToTrash")}
          </button>
        </div>
      )}
      {!editable && sheet && (
        <ReadOnlyArticleSheet
          locale={locale}
          article={articles.find((item) => item.id === sheet.id) ?? sheet}
          found={foundIds.includes(sheet.id)}
          titleId={titleId}
          onClose={() => setSheet(null)}
          onDiscover={() => void discover(sheet.id)}
          onReset={() => void resetFound(sheet.id)}
        />
      )}
      {editable && draft && (
        <ArticleDialog
          key={draft.article?.id ?? `new-${draft.kind}`}
          locale={locale}
          kind={draft.kind}
          article={draft.article}
          titleId={titleId}
          onCancel={() => setDraft(null)}
          editable={editable}
          onSave={(article) => void save(article)}
        />
      )}
    </div>
  );
}

function FindMark({ found, title, onDiscover }: { found: boolean; title: string; onDiscover: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-article-state={found ? "on" : "off"}
      className={`size-2.5 shrink-0 rounded-full ${found ? "bg-green-500" : "bg-zinc-400"}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!found) onDiscover();
      }}
    />
  );
}

function ReadOnlyArticleSheet({
  locale,
  article,
  found,
  titleId,
  onClose,
  onDiscover,
  onReset,
}: {
  locale: ScenarioLocale;
  article: ScenarioArticle;
  found: boolean;
  titleId: string;
  onClose: () => void;
  onDiscover: () => void;
  onReset: () => void;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-labelledby={titleId}
        data-article-sheet={article.kind}
        data-found={found ? "true" : "false"}
        className="relative flex max-h-full w-[min(660px,100%)] flex-col rounded-md border border-border bg-background shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-3 py-2">
          {found ? (
            <button type="button" className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={onReset}>{t("reset")}</button>
          ) : (
            <button type="button" className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={onDiscover}>{t("discover")}</button>
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
          <h2 id={titleId} className="sr-only">{article.name}</h2>
          <div className="border-b border-border pb-3">
            <Fact label={t("actorName")} value={article.name || (article.kind === "clue" ? t("untitledClue") : t("untitledItem"))} />
          </div>
          <div className="mt-4">
            <Prose label={t("description")} value={article.description} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      <span className="text-[16px]">{value.trim() ? value : "—"}</span>
    </span>
  );
}

function Prose({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[14px] text-muted-foreground">{label}</div>
      <p className="mt-0.5 whitespace-pre-wrap text-[14px]">{value.trim() ? value : "—"}</p>
    </div>
  );
}

function ArticleDialog({
  locale,
  kind,
  article,
  titleId,
  editable,
  onCancel,
  onSave,
}: {
  locale: ScenarioLocale;
  kind: Kind;
  article: ScenarioArticle | null;
  titleId: string;
  editable: boolean;
  onCancel: () => void;
  onSave: (article: ScenarioArticle) => void;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [name, setName] = useState(article?.name ?? "");
  const [description, setDescription] = useState(article?.description ?? "");
  const [scenes, setScenes] = useState<string[]>(article?.scenes ?? []);
  const [actors, setActors] = useState<string[]>(article?.actors ?? []);
  const [catalog, setCatalog] = useState<SceneCatalog>(readSceneCatalog);
  const [people, setPeople] = useState<ActorIndexEntry[]>(readActorIndex);

  useEffect(() => subscribeSceneCatalog(setCatalog), []);
  useEffect(() => subscribeActorIndex(setPeople), []);

  useEffect(() => {
    if (!catalog.ready) return;
    const present = presentSceneIds(catalog.nodes, catalog.trash);
    setScenes((current) => current.filter((id) => present.has(id)));
  }, [catalog]);

  function submit() {
    const fallback = kind === "clue" ? t("untitledClue") : t("untitledItem");
    onSave({
      id: article?.id ?? crypto.randomUUID(),
      kind,
      name: name.trim() || fallback,
      description: description.trim(),
      position: article?.position ?? readArticles().length,
      scenes,
      actors: actors.filter((id) => people.some((person) => person.id === id)),
      trashed: article?.trashed ?? false,
    });
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={onCancel}>
      <form
        role="dialog"
        aria-labelledby={titleId}
        data-article-form={kind}
        className="max-h-full w-[min(640px,100%)] overflow-auto rounded-md border border-border bg-background p-4 text-[13px] shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!editable) return;
          submit();
        }}
      >
        <fieldset disabled={!editable} className="min-w-0 border-0 p-0">
        <h2 id={titleId} className="mb-3 text-sm font-semibold">{article ? name.trim() || (kind === "clue" ? t("untitledClue") : t("untitledItem")) : kind === "clue" ? t("newClue") : t("newItem")}</h2>
        <label className="flex items-center gap-2">
          <span className="w-[4.5em] shrink-0 text-base">{t("actorName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 outline-none" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-base">{t("description")}</span>
          <textarea value={description} rows={2} onChange={(event) => setDescription(event.target.value)} className="w-full resize-y rounded-md border border-border bg-card px-2 py-1 outline-none" />
        </label>
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="mb-2 text-xs text-muted-foreground">{t("sceneLinks")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sceneLinkRows(catalog.nodes, catalog.trash, new Set(scenes)).map((row) => (
              <div key={row.id} data-scene-link={row.id} data-trashed={row.trashed ? "true" : "false"} className="flex max-w-full shrink-0 items-center gap-1">
                <label className={`flex min-w-0 items-center gap-1.5 ${row.trashed ? "text-muted-foreground opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    checked={scenes.includes(row.id)}
                    className="size-3.5 shrink-0"
                    onChange={(event) => setScenes((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))}
                  />
                  <span>{row.title}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="mb-2 text-xs text-muted-foreground">{t("actorLinks")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {people.filter((person) => !person.trashed || actors.includes(person.id)).map((person) => (
              <div key={person.id} data-actor-link={person.id} data-trashed={person.trashed ? "true" : "false"} className="flex max-w-full shrink-0 items-center gap-1">
                <label className={`flex min-w-0 items-center gap-1.5 ${person.trashed ? "text-muted-foreground opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    checked={actors.includes(person.id)}
                    className="size-3.5 shrink-0"
                    onChange={(event) => setActors((current) => (event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id)))}
                  />
                  <span>{person.name}</span>
                  <span className="text-[11px] text-muted-foreground">{person.kind === "npc" ? "NPC" : t("monster")}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
        </fieldset>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={onCancel}>{editable ? t("cancel") : t("close")}</button>
          {editable && <button type="submit" className="rounded-md bg-primary px-3 py-1 text-primary-foreground">{article ? t("save") : t("create")}</button>}
        </div>
      </form>
    </div>
  );
}
