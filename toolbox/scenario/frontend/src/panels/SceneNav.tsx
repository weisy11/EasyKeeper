import { ChevronRight, FileText, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createScenarioNode, deleteScenarioNode, duplicateScenarioNode, loadScenarioForest, placeScenarioNodes, projectDatabaseAvailable, renameScenarioNode, TRASH_ID, type ScenarioTreeNode } from "../db";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { appendBlockToTrash, moveBlock, siblingRange, type Place } from "./navMove";

type NavNode = {
  id: string;
  kind: "scene" | "event";
  title?: string;
  titleKey?: ScenarioStringKey;
  children: NavNode[];
};

type Hint = { id: string; place: Place };

function initialScenes(): NavNode[] {
  return [
    {
      id: "scene1",
      kind: "scene",
      titleKey: "scene1",
      children: [
        { id: "event1", kind: "event", titleKey: "event1", children: [] },
        { id: "event2", kind: "event", titleKey: "event2", children: [] },
      ],
    },
    { id: "scene2", kind: "scene", titleKey: "scene2", children: [] },
    { id: "scene3", kind: "scene", titleKey: "scene3", children: [] },
  ];
}

function nodeTitle(node: NavNode, locale: ScenarioLocale) {
  if (node.title) return node.title;
  return node.titleKey ? scenarioT(locale, node.titleKey) : "";
}

function findSpot(nodes: NavNode[], id: string, parent: NavNode | null = null): { parent: NavNode | null; siblings: NavNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === id) return { parent, siblings: nodes, index };
    const nested = findSpot(nodes[index].children, id, nodes[index]);
    if (nested) return nested;
  }
  return null;
}

function contains(node: NavNode, id: string): boolean {
  return node.id === id || node.children.some((child) => contains(child, id));
}

function removeNode(nodes: NavNode[], id: string): [NavNode[], NavNode | null] {
  let found: NavNode | null = null;
  const next = nodes.flatMap((node) => {
    if (node.id === id) {
      found = node;
      return [];
    }
    const [children, hit] = removeNode(node.children, id);
    if (hit) found = hit;
    return [{ ...node, children }];
  });
  return [next, found];
}

function insertAt(nodes: NavNode[], targetId: string, place: Place, node: NavNode): NavNode[] {
  const next: NavNode[] = [];
  for (const item of nodes) {
    if (item.id !== targetId) {
      next.push({ ...item, children: insertAt(item.children, targetId, place, node) });
      continue;
    }
    if (place === "before") next.push(node);
    next.push(place === "inside" ? { ...item, children: [...item.children, node] } : item);
    if (place === "after") next.push(node);
  }
  return next;
}

function freshId() {
  return `n-${crypto.randomUUID()}`;
}

function cloneNode(node: NavNode): NavNode {
  return { id: freshId(), kind: node.kind, title: node.title, titleKey: node.titleKey, children: node.children.map(cloneNode) };
}

function createNode(kind: "scene" | "event", title: string): NavNode {
  return { id: freshId(), kind, title, children: [] };
}

function forestSpot(nodes: NavNode[], trash: NavNode[], id: string) {
  const main = findSpot(nodes, id);
  if (main) return { area: "main" as const, parentId: main.parent?.id ?? null, siblings: main.siblings, index: main.index };
  const bin = findSpot(trash, id);
  if (!bin) return null;
  return { area: "trash" as const, parentId: bin.parent?.id ?? TRASH_ID, siblings: bin.siblings, index: bin.index };
}

function siblingIdsFor(nodes: NavNode[], trash: NavNode[], parentId: string | null) {
  if (parentId === null) return nodes.map((node) => node.id);
  if (parentId === TRASH_ID) return trash.map((node) => node.id);
  const spot = findSpot(nodes, parentId) ?? findSpot(trash, parentId);
  return spot ? spot.siblings[spot.index].children.map((node) => node.id) : [];
}

function pull(nodes: NavNode[], trash: NavNode[], id: string) {
  const [mainNext, mainHit] = removeNode(nodes, id);
  if (mainHit) return { nodes: mainNext, trash, node: mainHit };
  const [trashNext, trashHit] = removeNode(trash, id);
  if (trashHit) return { nodes, trash: trashNext, node: trashHit };
  return null;
}

function holds(nodes: NavNode[], trash: NavNode[], id: string, targetId: string) {
  const spot = forestSpot(nodes, trash, id);
  const node = spot?.siblings[spot.index];
  return !!node && contains(node, targetId);
}

function setCollapsedDragImage(row: HTMLElement, transfer: DataTransfer, title: string, count: number) {
  const style = getComputedStyle(row);
  const ghost = document.createElement("div");
  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "0";
  ghost.style.width = "200px";
  ghost.style.height = count > 1 ? "32px" : "28px";
  ghost.style.pointerEvents = "none";
  if (count > 1) {
    const back = document.createElement("div");
    back.style.position = "absolute";
    back.style.left = "4px";
    back.style.top = "4px";
    back.style.right = "0";
    back.style.bottom = "0";
    back.style.border = `1px solid ${style.borderTopColor}`;
    back.style.background = style.backgroundColor;
    back.style.borderRadius = "4px";
    ghost.appendChild(back);
  }
  const front = document.createElement("div");
  front.style.position = "absolute";
  front.style.left = "0";
  front.style.top = "0";
  front.style.right = count > 1 ? "4px" : "0";
  front.style.height = "28px";
  front.style.display = "flex";
  front.style.alignItems = "center";
  front.style.gap = "6px";
  front.style.padding = "0 8px";
  front.style.boxSizing = "border-box";
  front.style.border = `1px solid ${style.borderTopColor}`;
  front.style.background = style.backgroundColor;
  front.style.color = style.color;
  front.style.borderRadius = "4px";
  front.style.font = `13px ${style.fontFamily}`;
  front.style.overflow = "hidden";
  const label = document.createElement("span");
  label.textContent = title;
  label.style.overflow = "hidden";
  label.style.whiteSpace = "nowrap";
  label.style.textOverflow = "ellipsis";
  label.style.flex = "1";
  label.style.minWidth = "0";
  front.appendChild(label);
  if (count > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(count);
    badge.style.flex = "none";
    badge.style.opacity = "0.7";
    front.appendChild(badge);
  }
  ghost.appendChild(front);
  document.body.appendChild(ghost);
  transfer.setDragImage(ghost, 12, 14);
  window.setTimeout(() => ghost.remove(), 0);
}

function toTree(node: NavNode, locale: ScenarioLocale): ScenarioTreeNode {
  return { id: node.id, kind: node.kind, title: nodeTitle(node, locale), children: node.children.map((child) => toTree(child, locale)) };
}

function fromTree(node: ScenarioTreeNode): NavNode {
  return { id: node.id, kind: node.kind, title: node.title, children: node.children.map(fromTree) };
}

export function SceneNav({
  locale,
  projectPath,
  selected,
  onSelect,
}: {
  locale: ScenarioLocale;
  projectPath: string;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const usingDb = Boolean(projectPath) && projectDatabaseAvailable();
  const [nodes, setNodes] = useState<NavNode[]>(() => (usingDb ? [] : initialScenes()));
  const [trash, setTrash] = useState<NavNode[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>(() => (usingDb ? [] : ["scene1"]));
  const [hint, setHint] = useState<Hint | null>(null);
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dbError, setDbError] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => (selected ? [selected] : []));
  const anchorRef = useRef(selected);
  const dragIds = useRef<string[] | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [trashRatio, setTrashRatio] = useState(1 / 3);
  const splitDrag = useRef<{ pointerId: number; startY: number; startRatio: number; height: number } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!usingDb) return;
    let cancelled = false;
    setDbError(false);
    void loadScenarioForest(projectPath).then(({ nodes: tree, trash: bin }) => {
      if (cancelled) return;
      const next = tree.map(fromTree);
      const nextTrash = bin.map(fromTree);
      setNodes(next);
      setTrash(nextTrash);
      const visible = next.some((node) => contains(node, selectedRef.current)) || nextTrash.some((node) => contains(node, selectedRef.current));
      if (!visible) onSelect(next[0]?.id ?? "");
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error(error);
      setDbError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, usingDb]);

  useEffect(() => {
    setPicked((current) => {
      if (selected && current.includes(selected)) return current;
      anchorRef.current = selected;
      return selected ? [selected] : [];
    });
  }, [selected]);

  useEffect(() => {
    const ids = dragIds.current;
    if (!ids) return;
    for (const id of ids) hideChildren(id);
  }, [hint]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function reportDbError(error: unknown) {
    console.error(error);
    setDbError(true);
  }

  function rowRoots() {
    return [treeRef.current, trashRef.current].filter((node): node is HTMLDivElement => node !== null);
  }

  function hideChildren(id: string) {
    for (const root of rowRoots()) {
      root.querySelectorAll<HTMLElement>(`[data-ancestors~="${id}"]`).forEach((row) => {
        row.style.display = "none";
      });
    }
  }

  function showChildren() {
    for (const root of rowRoots()) {
      root.querySelectorAll<HTMLElement>("[data-ancestors]").forEach((row) => {
        row.style.display = "";
      });
    }
  }

  async function persist(parentId: string | null, ids: string[]) {
    if (!usingDb) return;
    await placeScenarioNodes(projectPath, parentId, ids);
  }

  function chooseOne(id: string) {
    if (picked.includes(id)) {
      anchorRef.current = "";
      setPicked([]);
      return;
    }
    anchorRef.current = id;
    setPicked([id]);
    onSelect(id);
  }

  function chooseRange(id: string) {
    const range = siblingRange(nodes, trash, anchorRef.current, id, TRASH_ID);
    if (!range) {
      chooseOne(id);
      return;
    }
    setPicked(range);
    const focus = range.find((item) => {
      if (item === id) return true;
      const spot = forestSpot(nodes, trash, item);
      const node = spot?.siblings[spot.index];
      return !!node && contains(node, id);
    }) ?? range[0];
    onSelect(focus);
  }

  async function moveMany(ids: string[], targetId: string, place: Place) {
    const sourceParents = [...new Set(ids.flatMap((id) => {
      const spot = forestSpot(nodes, trash, id);
      return spot ? [spot.parentId] : [];
    }))];
    const placed = moveBlock(nodes, trash, ids, targetId, place, TRASH_ID);
    if (!placed) return;
    const sample = ids.find((id) => forestSpot(placed.nodes, placed.trash, id));
    const dest = sample ? forestSpot(placed.nodes, placed.trash, sample) : null;
    if (!dest) return;
    await persist(dest.parentId, siblingIdsFor(placed.nodes, placed.trash, dest.parentId));
    for (const parentId of sourceParents) {
      if (parentId !== dest.parentId) await persist(parentId, siblingIdsFor(placed.nodes, placed.trash, parentId));
    }
    setNodes(placed.nodes);
    setTrash(placed.trash);
    if (place === "inside") setOpenIds((open) => (open.includes(targetId) ? open : [...open, targetId]));
    if (dest.area === "trash") setTrashOpen(true);
  }

  async function addNode(parentId: string | null, kind: "scene" | "event") {
    const title = t(kind === "scene" ? "untitledScene" : "untitledEvent");
    const node = usingDb
      ? fromTree(await createScenarioNode(projectPath, { parentId, kind, title }).then((created) => ({ id: created.id, kind: created.kind, title: created.title, children: [] })))
      : createNode(kind, title);
    if (!parentId) setNodes((current) => [...current, node]);
    else if (findSpot(nodes, parentId)) {
      setNodes((current) => insertAt(current, parentId, "inside", node));
      setOpenIds((ids) => (ids.includes(parentId) ? ids : [...ids, parentId]));
    } else {
      setTrash((current) => insertAt(current, parentId, "inside", node));
      setTrashOpen(true);
      setOpenIds((ids) => (ids.includes(parentId) ? ids : [...ids, parentId]));
    }
    onSelect(node.id);
    setRenaming(node.id);
    setMenu(null);
  }

  async function rename(id: string, title: string) {
    const next = title.trim();
    setRenaming(null);
    if (!next || id === TRASH_ID) return;
    if (usingDb) await renameScenarioNode(projectPath, id, next);
    const visit = (list: NavNode[]): NavNode[] => list.map((node) => (
      node.id === id ? { ...node, title: next, titleKey: undefined } : { ...node, children: visit(node.children) }
    ));
    setNodes((current) => visit(current));
    setTrash((current) => visit(current));
  }

  async function duplicate(id: string) {
    const spot = forestSpot(nodes, trash, id);
    if (!spot || id === TRASH_ID) return;
    const source = spot.siblings[spot.index];
    const copy = usingDb
      ? fromTree(await duplicateScenarioNode(projectPath, toTree(source, locale), spot.parentId))
      : cloneNode(source);
    if (spot.area === "main") {
      const next = insertAt(nodes, id, "after", copy);
      await persist(spot.parentId, siblingIdsFor(next, trash, spot.parentId));
      setNodes(next);
    } else {
      const next = insertAt(trash, id, "after", copy);
      await persist(spot.parentId, siblingIdsFor(nodes, next, spot.parentId));
      setTrash(next);
    }
    setMenu(null);
  }

  async function moveToTrash(id: string) {
    const ids = picked.includes(id) ? picked : [id];
    const source = forestSpot(nodes, trash, ids[0]);
    if (!source || source.area === "trash") return;
    const placed = appendBlockToTrash(nodes, trash, ids, TRASH_ID);
    if (!placed) return;
    const movedIds = placed.trash.slice(trash.length).map((node) => node.id);
    await persist(TRASH_ID, placed.trash.map((node) => node.id));
    await persist(source.parentId, siblingIdsFor(placed.nodes, placed.trash, source.parentId));
    setNodes(placed.nodes);
    setTrash(placed.trash);
    setTrashOpen(true);
    setPicked(movedIds);
    anchorRef.current = movedIds[0] ?? id;
    setMenu(null);
  }

  async function purge(id: string) {
    const spot = forestSpot(nodes, trash, id);
    if (!spot || spot.area !== "trash" || id === TRASH_ID) return;
    const pulled = pull(nodes, trash, id);
    if (!pulled) return;
    if (usingDb) await deleteScenarioNode(projectPath, id);
    await persist(spot.parentId, siblingIdsFor(pulled.nodes, pulled.trash, spot.parentId));
    setNodes(pulled.nodes);
    setTrash(pulled.trash);
    if (selected === id || contains(pulled.node, selected)) {
      onSelect(spot.parentId !== TRASH_ID ? spot.parentId : "");
    }
    setMenu(null);
  }

  function renderNodes(list: NavNode[], ancestors: string[], depth: number) {
    return list.map((node) => {
      const title = nodeTitle(node, locale);
      const expanded = openIds.includes(node.id);
      const marked = hint?.id === node.id ? hint.place : null;
      const chosen = picked.includes(node.id) || ancestors.some((id) => picked.includes(id));
      return (
        <div key={node.id} data-ancestors={ancestors.join(" ")}>
          <div
            data-page-id={node.id}
            draggable
            onDragStart={(event) => {
              const group = picked.includes(node.id) ? picked : [node.id];
              dragIds.current = group;
              if (!picked.includes(node.id)) {
                anchorRef.current = node.id;
                setPicked([node.id]);
                onSelect(node.id);
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", group.join(" "));
              setCollapsedDragImage(event.currentTarget, event.dataTransfer, title, group.length);
              for (const id of group) hideChildren(id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dragging = dragIds.current;
              if (!dragging || dragging.includes(node.id) || dragging.some((id) => holds(nodes, trash, id, node.id))) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientY - bounds.top) / bounds.height;
              const place: Place = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
              setHint((current) => (current?.id === node.id && current.place === place ? current : { id: node.id, place }));
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dragging = dragIds.current;
              if (dragging && hint) void moveMany(dragging, hint.id, hint.place).catch(reportDbError);
              dragIds.current = null;
              showChildren();
              setHint(null);
            }}
            onDragEnd={() => {
              dragIds.current = null;
              showChildren();
              setHint(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ id: node.id, x: event.clientX, y: event.clientY });
            }}
            data-selected={picked.includes(node.id) ? "true" : "false"}
            data-marked={chosen ? "true" : "false"}
            className={`group relative flex h-7 items-center gap-1 pr-1 ${chosen ? "bg-[#2563eb]/20 shadow-[inset_2px_0_0_#2563eb] dark:bg-[#60a5fa]/25 dark:shadow-[inset_2px_0_0_#60a5fa]" : "hover:bg-muted"} ${marked === "inside" ? "ring-1 ring-inset ring-primary" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {marked === "before" && <span className="absolute inset-x-2 top-0 h-0.5 bg-primary" />}
            {marked === "after" && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />}
            <button
              type="button"
              aria-expanded={node.children.length > 0 ? expanded : undefined}
              className={`grid size-4 shrink-0 place-items-center ${node.children.length === 0 ? "invisible" : ""}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setOpenIds((ids) => (ids.includes(node.id) ? ids.filter((item) => item !== node.id) : [...ids, node.id]))}
            >
              <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
            </button>
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            {renaming === node.id ? (
              <input
                autoFocus
                defaultValue={title}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-[13px] outline-none"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void rename(node.id, event.currentTarget.value).catch(reportDbError);
                  if (event.key === "Escape") setRenaming(null);
                }}
                onBlur={(event) => void rename(node.id, event.currentTarget.value).catch(reportDbError)}
              />
            ) : (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.shiftKey) {
                    event.preventDefault();
                    chooseRange(node.id);
                  } else chooseOne(node.id);
                }}
              >
                {title}
              </button>
            )}
            <span className={`shrink-0 items-center ${selected === node.id ? "flex" : "hidden group-hover:flex"}`}>
              <button
                type="button"
                title={t("addChildScene")}
                className="grid size-5 place-items-center rounded hover:bg-background"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => addNode(node.id, "scene")}
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("more")}
                className="grid size-5 place-items-center rounded hover:bg-background"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenu({ id: node.id, x: bounds.left, y: bounds.bottom + 4 });
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </span>
          </div>
          {expanded ? renderNodes(node.children, [...ancestors, node.id], depth + 1) : null}
        </div>
      );
    });
  }

  function clampTrashRatio(ratio: number, height: number) {
    const minTrash = 34;
    const minScenes = 72;
    if (height <= minTrash + minScenes) return Math.min(0.6, Math.max(0.25, ratio));
    return Math.min(1 - minScenes / height, Math.max(minTrash / height, ratio));
  }

  function onSplitPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const body = bodyRef.current;
    if (!body) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events have no pointer to capture.
    }
    splitDrag.current = { pointerId: event.pointerId, startY: event.clientY, startRatio: trashRatio, height: body.clientHeight };
  }

  function onSplitPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = splitDrag.current;
    if (!drag || event.pointerId !== drag.pointerId || drag.height <= 0) return;
    setTrashRatio(clampTrashRatio(drag.startRatio + (drag.startY - event.clientY) / drag.height, drag.height));
  }

  function onSplitPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (splitDrag.current?.pointerId === event.pointerId) splitDrag.current = null;
  }

  const inTrash = menu?.id ? forestSpot(nodes, trash, menu.id)?.area === "trash" : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 text-xs font-semibold">
        <span className="min-w-0 flex-1 truncate">{t("scenes")}</span>
        <button type="button" title={t("addRootScene")} className="grid size-6 place-items-center rounded font-normal hover:bg-muted" onClick={() => void addNode(null, "scene").catch(reportDbError)}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <div
        ref={bodyRef}
        className="grid min-h-0 flex-1"
        style={{ gridTemplateRows: trashOpen ? `minmax(0,1fr) minmax(0,${trashRatio * 100}%)` : "minmax(0,1fr) auto" }}
      >
        <div
          ref={treeRef}
          className="min-h-0 overflow-auto pb-2"
          onContextMenu={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            setMenu({ id: null, x: event.clientX, y: event.clientY });
          }}
        >
          {dbError ? <p className="px-3 py-2 text-xs text-destructive">{t("catalogLoadFailed")}</p> : null}
          {renderNodes(nodes, [], 0)}
        </div>
        <div className="flex min-h-0 flex-col">
          {trashOpen ? (
            <div
              data-trash-resize=""
              role="separator"
              aria-orientation="horizontal"
              title={t("resizeTrash")}
              className="relative h-2 shrink-0 cursor-row-resize before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-border"
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
            />
          ) : (
            <div className="border-t border-border" />
          )}
          <button
            type="button"
            className="flex h-7 w-full shrink-0 items-center gap-1 px-2 text-left text-[13px]"
            onClick={() => setTrashOpen((open) => !open)}
            onContextMenu={(event) => event.preventDefault()}
          >
            <ChevronRight className={`size-3.5 shrink-0 transition-transform ${trashOpen ? "rotate-90" : ""}`} />
            <Trash2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t("trash")}</span>
          </button>
          {trashOpen ? (
            <div ref={trashRef} className="min-h-0 flex-1 overflow-auto">
              {renderNodes(trash, [], 1)}
            </div>
          ) : null}
        </div>
      </div>
      {menu && (
        <div
          className="fixed z-30 min-w-36 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.id === null ? (
            <MenuItem label={t("addRootScene")} onClick={() => void addNode(null, "scene").catch(reportDbError)} />
          ) : (
            <>
              <MenuItem label={t("addChildScene")} onClick={() => void addNode(menu.id, "scene").catch(reportDbError)} />
              <MenuItem label={t("addEvent")} onClick={() => void addNode(menu.id, "event").catch(reportDbError)} />
              <MenuItem label={t("rename")} onClick={() => { setRenaming(menu.id); setMenu(null); }} />
              <MenuItem label={t("duplicate")} onClick={() => void duplicate(menu.id!).catch(reportDbError)} />
              <div className="my-1 h-px bg-border" />
              {inTrash ? (
                <MenuItem label={t("deleteNode")} danger onClick={() => void purge(menu.id!).catch(reportDbError)} />
              ) : (
                <MenuItem label={t("moveToTrash")} danger onClick={() => void moveToTrash(menu.id!).catch(reportDbError)} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, disabled, danger, onClick }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full px-3 py-1 text-left ${danger ? "text-destructive" : ""} hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {label}
    </button>
  );
}
