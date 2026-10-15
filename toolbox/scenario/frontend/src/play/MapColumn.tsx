import { Filter, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  deleteScenarioMap,
  ensureScenarioSchema,
  insertScenarioMap,
  loadScenarioMaps,
  orderScenarioMaps,
  projectDatabaseAvailable,
  updateScenarioMapLinks,
  updateScenarioMapSrc,
  type ScenarioMap,
} from "../db";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { presentSceneIds, readSceneCatalog, sceneLinkRows, subscribeSceneCatalog, type SceneCatalog } from "./sceneCatalog";
import { loadImageObjectUrl, savePastedImage } from "../storage";

export function MapColumn({ locale, projectPath, selected, editable }: { locale: ScenarioLocale; projectPath: string; selected: string; editable: boolean }) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [maps, setMaps] = useState<ScenarioMap[]>([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<ScenarioMap | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [catalog, setCatalog] = useState<SceneCatalog>(readSceneCatalog);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const dragId = useRef<string | null>(null);
  const [hint, setHint] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const hintRef = useRef(hint);
  const usingDb = projectDatabaseAvailable() && projectPath !== "";

  useEffect(() => {
    if (!usingDb) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureScenarioSchema(projectPath);
        const rows = await loadScenarioMaps(projectPath);
        if (!cancelled) setMaps(rows);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, usingDb]);

  useEffect(() => subscribeSceneCatalog(setCatalog), []);

  useEffect(() => {
    if (!catalog.ready || !editable || !usingDb) return;
    const present = presentSceneIds(catalog.nodes, catalog.trash);
    setMaps((items) => {
      let changed = false;
      const next = items.map((item) => {
        const links = item.links.filter((id) => present.has(id));
        if (links.length === item.links.length) return item;
        changed = true;
        return { ...item, links };
      });
      if (changed) {
        for (const item of next) {
          const previous = items.find((map) => map.id === item.id);
          if (previous && previous.links.length !== item.links.length) void updateScenarioMapLinks(projectPath, item.id, item.links);
        }
      }
      return changed ? next : items;
    });
  }, [catalog, editable, projectPath, usingDb]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  async function pick(file: File | undefined) {
    if (!editable || !usingDb || !file || !file.type.startsWith("image/")) return;
    const src = await savePastedImage(projectPath, file);
    const target = replaceId.current;
    replaceId.current = null;
    if (target) {
      await updateScenarioMapSrc(projectPath, target, src);
      setMaps(await loadScenarioMaps(projectPath));
      setPreview((current) => (current?.id === target ? { ...current, src } : current));
      return;
    }
    const map = { id: crypto.randomUUID(), src, position: maps.length, links: selected ? [selected] : [] };
    await ensureScenarioSchema(projectPath);
    await insertScenarioMap(projectPath, map);
    setMaps(await loadScenarioMaps(projectPath));
  }

  async function setLinks(id: string, links: string[]) {
    if (!editable || !usingDb) return;
    await updateScenarioMapLinks(projectPath, id, links);
    setMaps(await loadScenarioMaps(projectPath));
  }

  async function remove(id: string) {
    setMenu(null);
    if (!editable || !usingDb) return;
    if (preview?.id === id) setPreview(null);
    await deleteScenarioMap(projectPath, id);
    setMaps(await loadScenarioMaps(projectPath));
  }

  function showHint(next: { id: string; place: "before" | "after" } | null) {
    hintRef.current = next;
    setHint((current) => (current?.id === next?.id && current?.place === next?.place ? current : next));
  }

  async function reorder(fromId: string, toId: string, place: "before" | "after") {
    if (!editable || !usingDb || fromId === toId) return;
    const next = [...maps];
    const from = next.findIndex((item) => item.id === fromId);
    const to = next.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    let insertAt = next.findIndex((item) => item.id === toId);
    if (place === "after") insertAt += 1;
    next.splice(insertAt, 0, moved);
    const ordered = next.map((item, position) => ({ ...item, position }));
    setMaps(ordered);
    await orderScenarioMaps(projectPath, ordered.map((item) => item.id));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 text-xs font-semibold">
        <span className="min-w-0 flex-1 truncate">{t("map")}</span>
        <button
          type="button"
          title={t("filterByScene")}
          aria-label={t("filterByScene")}
          aria-pressed={linkedOnly}
          data-map-filter=""
          className={`grid size-6 place-items-center rounded font-normal ${linkedOnly ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onClick={() => setLinkedOnly((current) => !current)}
        >
          <Filter className="size-3.5" />
        </button>
        {editable && (
          <button
            type="button"
            title={t("addMap")}
            aria-label={t("addMap")}
            data-map-add=""
            className="grid size-6 place-items-center rounded font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              replaceId.current = null;
              fileRef.current?.click();
            }}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {(linkedOnly ? maps.filter((map) => selected !== "" && map.links.includes(selected)) : maps).map((map) => (
          <button
            key={map.id}
            type="button"
            draggable={editable}
            data-map={map.id}
            data-map-drop={hint?.id === map.id ? hint.place : "none"}
            className="relative block w-full cursor-grab border-b border-border bg-background p-1.5 active:cursor-grabbing"
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setPreview(map);
            }}
            onContextMenu={(event) => {
              if (!editable) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              setMenu({ id: map.id, x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event) => {
              if (!editable) {
                event.preventDefault();
                return;
              }
              dragId.current = map.id;
            }}
            onDrag={() => {
              suppressClick.current = true;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!dragId.current || dragId.current === map.id) {
                showHint(null);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const place = (event.clientY - bounds.top) / bounds.height < 0.5 ? "before" : "after";
              showHint({ id: map.id, place });
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragId.current;
              const target = hintRef.current;
              dragId.current = null;
              showHint(null);
              if (from && target) void reorder(from, target.id, target.place);
            }}
            onDragEnd={() => {
              dragId.current = null;
              showHint(null);
            }}
          >
            {hint?.id === map.id && hint.place === "before" && <span className="pointer-events-none absolute inset-x-2 top-0 z-10 h-0.5 bg-primary" />}
            <MapThumb projectPath={projectPath} src={map.src} />
            <MapLinkCaption map={map} catalog={catalog} />
            {hint?.id === map.id && hint.place === "after" && <span className="pointer-events-none absolute inset-x-2 bottom-0 z-10 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        data-map-file=""
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
      {menu && (
        <div
          data-map-menu=""
          className="fixed z-30 min-w-28 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1 text-left hover:bg-accent"
            onClick={() => {
              setLinking(menu.id);
              setMenu(null);
            }}
          >
            {t("sceneLinks")}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1 text-left hover:bg-accent"
            onClick={() => {
              replaceId.current = menu.id;
              setMenu(null);
              fileRef.current?.click();
            }}
          >
            {t("replaceMap")}
          </button>
          <button type="button" className="block w-full px-3 py-1 text-left text-destructive hover:bg-accent" onClick={() => void remove(menu.id)}>
            {t("deleteMap")}
          </button>
        </div>
      )}
      {linking && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onClick={() => setLinking(null)}>
          <div
            role="dialog"
            aria-label={t("sceneLinks")}
            data-map-links=""
            className="max-h-full w-[min(520px,100%)] overflow-auto rounded-md border border-border bg-background p-4 text-[13px] shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-2 text-xs text-muted-foreground">{t("sceneLinks")}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {sceneLinkRows(catalog.nodes, catalog.trash, new Set(maps.find((item) => item.id === linking)?.links ?? [])).map((row) => {
                const links = maps.find((item) => item.id === linking)?.links ?? [];
                return (
                  <div key={row.id} data-scene-link={row.id} data-trashed={row.trashed ? "true" : "false"} className="flex max-w-full shrink-0 items-center gap-1">
                    <label className={`flex min-w-0 items-center gap-1.5 ${row.trashed ? "text-muted-foreground opacity-60" : ""}`}>
                      <input
                        type="checkbox"
                        checked={links.includes(row.id)}
                        className="size-3.5 shrink-0"
                        onChange={(event) => {
                          const next = event.target.checked ? [...links, row.id] : links.filter((id) => id !== row.id);
                          void setLinks(linking, next);
                        }}
                      />
                      <span>{row.title}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div
          role="dialog"
          aria-label={t("map")}
          data-map-preview=""
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreview(null)}
        >
          <button type="button" className="absolute top-3 right-3 rounded-md bg-background/90 px-2 py-1 text-xs" onClick={() => setPreview(null)}>
            {t("closeMap")}
          </button>
          <div onClick={(event) => event.stopPropagation()}>
            <MapThumb projectPath={projectPath} src={preview.src} className="max-h-[85vh] max-w-[90vw] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

function MapLinkCaption({ map, catalog }: { map: ScenarioMap; catalog: SceneCatalog }) {
  const rows = sceneLinkRows(catalog.nodes, catalog.trash, new Set(map.links)).filter((row) => map.links.includes(row.id));
  if (rows.length === 0) return null;
  return <span className="mt-1 block truncate text-left text-[11px] text-muted-foreground">{rows.map((row) => row.title).join("、")}</span>;
}

function MapThumb({ projectPath, src, className = "max-h-28 w-full object-contain" }: { projectPath: string; src: string; className?: string }) {
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

  if (!url) return <div className={className.includes("max-h-28") ? "h-16 w-full bg-muted" : className} />;
  return <img src={url} alt="" draggable={false} className={className} />;
}
