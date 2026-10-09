import type { ToolDefinition } from "@ek/tool-api";
import { appLog } from "@/lib/store";
import { CATALOG_MAP } from "./catalog";
import { topoSort } from "./dag";
import { getLoadedTool, isAllowed, loadedToolsStore } from "./allowed";

export type OpenPanelFn = (toolId: string, opts?: { focus?: boolean }) => void;
export type ClosePanelFn = (toolId: string) => void;
export type HasPanelFn = (toolId: string) => boolean;

export type PanelCtx = { openPanel: OpenPanelFn; hasPanel: HasPanelFn };

async function loadThin(id: string): Promise<ToolDefinition> {
  const existing = getLoadedTool(id);
  if (existing) return existing;
  const meta = CATALOG_MAP[id];
  if (!meta) throw new Error(`unknown tool: ${id}`);
  const tool = await meta.load();
  loadedToolsStore.set((s) => {
    const errors = { ...s.errors };
    delete errors[id];
    return { byId: { ...s.byId, [id]: tool }, errors };
  });
  return tool;
}

function setError(id: string, message: string) {
  loadedToolsStore.set((s) => ({ ...s, errors: { ...s.errors, [id]: message } }));
  appLog(`⚠ tool ${id}: ${message}`);
}

/** Load thin entries + resolve deps (DAG). Does not open panels. */
export async function ensureToolsLoaded(rootIds: string[]): Promise<string[]> {
  const roots = rootIds.filter(Boolean);
  for (const id of roots) {
    if (!CATALOG_MAP[id]) {
      setError(id, "unknown tool");
      continue;
    }
    if (!isAllowed(id)) {
      setError(id, "not allowed");
      continue;
    }
    try {
      await loadThin(id);
    } catch (e) {
      setError(id, e instanceof Error ? e.message : String(e));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const known = Object.keys(loadedToolsStore.get().byId);
    for (const id of known) {
      const tool = getLoadedTool(id);
      if (!tool) continue;
      for (const d of tool.dependencies ?? []) {
        if (!CATALOG_MAP[d]) {
          setError(id, `missing dependency ${d}`);
          continue;
        }
        if (!isAllowed(d)) {
          setError(id, `dependency ${d} not allowed`);
          continue;
        }
        if (!getLoadedTool(d) && !loadedToolsStore.get().errors[d]) {
          try {
            await loadThin(d);
            changed = true;
          } catch (e) {
            setError(d, e instanceof Error ? e.message : String(e));
            setError(id, `dependency ${d} failed to load`);
          }
        }
      }
    }
  }

  const needed = new Set<string>();
  const stack = [...roots.filter((id) => getLoadedTool(id))];
  while (stack.length) {
    const id = stack.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    for (const d of getLoadedTool(id)?.dependencies ?? []) stack.push(d);
  }

  for (const id of [...needed]) {
    const tool = getLoadedTool(id);
    if (!tool) {
      needed.delete(id);
      continue;
    }
    for (const d of tool.dependencies ?? []) {
      if (loadedToolsStore.get().errors[d] || !getLoadedTool(d)) {
        setError(id, `dependency ${d} failed to start`);
        needed.delete(id);
      }
    }
  }

  const sorted = topoSort([...needed], (id) => getLoadedTool(id)?.dependencies);
  if (!sorted.ok) {
    for (const id of sorted.blocked) setError(id, sorted.error);
    return [...needed].filter((id) => !sorted.blocked.includes(id));
  }
  return sorted.order;
}

/**
 * Open tools in dependency order. Fault-isolated per tool.
 * `roots` = tools the user/layout asked to open; deps are opened first if missing.
 */
export async function openTools(roots: string[], ctx: PanelCtx): Promise<void> {
  const order = await ensureToolsLoaded(roots);
  for (const id of order) {
    try {
      if (!getLoadedTool(id)) continue;
      if (loadedToolsStore.get().errors[id]) continue;
      if (!ctx.hasPanel(id)) ctx.openPanel(id, { focus: roots.includes(id) });
    } catch (e) {
      setError(id, e instanceof Error ? e.message : String(e));
    }
  }
}

export async function openTool(id: string, ctx: PanelCtx) {
  await openTools([id], ctx);
}

/**
 * Close one tool window: dispose runtime, drop from loaded map.
 * Does not cascade to dependents. Reloads window if heavy deps were loaded
 * (unless skipReload — used while clearing/restoring layout).
 */
export async function closeTool(
  id: string,
  opts?: { closePanel?: ClosePanelFn; hasPanel?: HasPanelFn; skipReload?: boolean },
) {
  if (opts?.hasPanel?.(id)) opts.closePanel?.(id);
  const tool = getLoadedTool(id);
  const heavy = tool?.wasHeavyLoaded?.() === true;
  try {
    await tool?.dispose?.();
  } catch (e) {
    appLog(`⚠ dispose ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  loadedToolsStore.set((s) => {
    const byId = { ...s.byId };
    delete byId[id];
    const errors = { ...s.errors };
    delete errors[id];
    return { byId, errors };
  });
  if (heavy && !opts?.skipReload) {
    appLog(`↻ reloading to drop heavy modules after closing ${id}`);
    setTimeout(() => location.reload(), 50);
  }
}
