import type { DockviewApi, DockviewGroupPanel, IDockviewPanel, SerializedDockview } from "dockview-react";
import { toast } from "sonner";
import { CATALOG_MAP, TOOL_MAP, TOOLS, type Region } from "./tools";
import { getLoadedTool, isAllowed } from "./tools/allowed";
import { closeTool, ensureToolsLoaded, openTools } from "./tools/loader";
import { appLog, chromeStore, createStore, settingsStore } from "./lib/store";
import { t } from "./lib/i18n";
import { clearPopoutQueue, destroyWindow, focusWindow, log, on, queuePopout, type Box } from "./lib/platform";

export type EdgePos = "left" | "right" | "bottom";
export const EDGES: EdgePos[] = ["left", "right", "bottom"];

export type LayoutSnapshot = {
  kind: "ek.layoutSnapshot";
  layoutVersion: 1;
  adapter: { name: "dockview"; version: string };
  data: SerializedDockview;
  panels: { panel: string }[];
  chrome: { collapsedDocks: EdgePos[] };
  popoutGeometry: (Box | null)[];
  savedAt: string;
};

export type PresetFile = { kind: "ek.layoutPresetFile"; version: 1; presets: { name: string; snapshot: LayoutSnapshot }[] };

export type WorkspaceMeta = { id: string; name: string };
export type WorkspacesState = { list: WorkspaceMeta[]; active: string };

export const workspacesStore = createStore<WorkspacesState>(
  { list: [{ id: "ws-1", name: "跑团 / Session" }, { id: "ws-2", name: "备团 / Prep" }], active: "ws-1" },
  "ek.workspaces",
);

export const presetsStore = createStore<{ items: { name: string; snapshot: LayoutSnapshot }[] }>({ items: [] }, "ek.presets");

/** Live UI state the chrome renders (width, auto-collapse, popouts), not persisted. */
export const liveStore = createStore<{ width: number; auto: Record<EdgePos, boolean>; popouts: number; tick: number }>({
  width: window.innerWidth,
  auto: { left: false, right: false, bottom: false },
  popouts: 0,
  tick: 0,
});

const BREAKPOINTS: Record<EdgePos, number> = { right: 1000, left: 820, bottom: 0 };
const BOTTOM_HEIGHT_BREAKPOINT = 560;

export function autoCollapseFor(width: number, height: number): Record<EdgePos, boolean> {
  return { right: width < BREAKPOINTS.right, left: width < BREAKPOINTS.left, bottom: height < BOTTOM_HEIGHT_BREAKPOINT };
}

const EDGE_OPTS: Record<EdgePos, { initialSize: number; minimumSize: number }> = {
  left: { initialSize: 270, minimumSize: 200 },
  right: { initialSize: 300, minimumSize: 220 },
  bottom: { initialSize: 210, minimumSize: 120 },
};

const pendingLabels = new Map<string, string[]>();
const labelOwner = new Map<string, WorkspaceController>();

export class WorkspaceController {
  api!: DockviewApi;
  readonly id: string;
  userCollapsed: Record<EdgePos, boolean> = { left: false, right: false, bottom: false };
  private applyingAuto = false;
  private autoState: Record<EdgePos, boolean> = { left: false, right: false, bottom: false };
  private labelByWindow = new Map<Window, string>();
  private destroying = new Set<string>();
  geomByLabel = new Map<string, Box>();
  private originByPanel = new Map<string, EdgePos>();
  private saveTimer: number | undefined;
  private restoring = false;

  constructor(id: string) {
    this.id = id;
  }

  attach(api: DockviewApi) {
    this.api = api;
    api.onDidLayoutChange(() => this.scheduleSave());
    api.onDidRemovePanel((panel) => {
      if (this.restoring) return;
      const toolId = String((panel.params as { toolId?: string } | undefined)?.toolId ?? panel.id);
      void closeTool(toolId);
    });
    api.onDidAddPopoutGroup((p) => {
      const label = pendingLabels.get(this.id)?.shift();
      if (label) {
        this.labelByWindow.set(p.window, label);
        labelOwner.set(label, this);
      }
      log(`[${this.id}] popout added group=${p.group.id} label=${label} (${p.window.innerWidth}x${p.window.innerHeight} at ${p.window.screenX},${p.window.screenY})`);
      appLog(`⧉ ${this.id}: pop-out ${label ?? "?"} opened`);
      prepareDocument(p.window.document);
      bumpLive();
    });
    api.onDidRemovePopoutGroup((p) => {
      const label = this.labelByWindow.get(p.window);
      this.labelByWindow.delete(p.window);
      log(`[${this.id}] popout removed label=${label}`);
      if (label && !this.destroying.has(label)) {
        this.destroying.add(label);
        setTimeout(() => destroyWindow(label).finally(() => this.destroying.delete(label)), 150);
      }
      if (label) labelOwner.delete(label);
      bumpLive();
    });
    api.onDidOpenPopoutWindowFail(() => {
      appLog(`⚠ ${this.id}: pop-out window failed to open`);
      toast.error("Pop-out blocked / 弹出窗口被拦截");
    });
    for (const pos of EDGES) this.watchEdge(pos);
  }

  private watchEdge(pos: EdgePos) {
    const g = this.api.getEdgeGroup(pos);
    if (!g) return;
    g.onDidCollapsedChange((e) => {
      if (this.applyingAuto || this.restoring) return;
      if (e.isCollapsed && (this.api.getGroup(g.id)?.size ?? 0) === 0) return;
      this.userCollapsed[pos] = e.isCollapsed;
      this.scheduleSave();
      bumpLive();
    });
  }

  ensureEdge(pos: EdgePos) {
    if (!this.api.getEdgeGroup(pos)) {
      this.api.addEdgeGroup(pos, { id: `edge-${pos}`, ...EDGE_OPTS[pos], collapsedSize: 34 });
      this.watchEdge(pos);
    }
    return this.api.getEdgeGroup(pos)!;
  }

  async buildDefault() {
    const api = this.api;
    this.restoring = true;
    for (const p of [...api.panels]) {
      const toolId = String((p.params as { toolId?: string } | undefined)?.toolId ?? p.id);
      await closeTool(toolId, { skipReload: true });
    }
    api.clear();
    for (const pos of EDGES) {
      if (api.getEdgeGroup(pos)) api.removeEdgeGroup(pos);
    }
    this.userCollapsed = { left: false, right: false, bottom: false };
    this.restoring = false;
    await openTools(["ek.dice"], this.panelCtx());
    this.applyAutoCollapse(liveStore.get().auto);
    bumpLive();
  }

  panelCtx() {
    return {
      openPanel: (toolId: string, opts?: { focus?: boolean }) => {
        this.openPanel(toolId, opts);
      },
      hasPanel: (toolId: string) => !!this.panelFor(toolId),
    };
  }

  panelFor(toolId: string): IDockviewPanel | undefined {
    return this.api.getPanel(toolId);
  }

  /** Async open: load thin entry (+ deps) then place panel. */
  async requestOpenTool(toolId: string, opts: { focus?: boolean } = {}) {
    await openTools([toolId], this.panelCtx());
    if (opts.focus !== false) {
      const p = this.panelFor(toolId);
      if (p) this.reveal(p);
    }
  }

  /** Placement only (tool must already be loaded). */
  openPanel(toolId: string, opts: { focus?: boolean } = {}) {
    const existing = this.panelFor(toolId);
    if (existing) {
      this.reveal(existing);
      return existing;
    }
    const loaded = getLoadedTool(toolId);
    const catalog = CATALOG_MAP[toolId] ?? TOOL_MAP[toolId];
    const region: Region = loaded?.region ?? "center";
    const titleSrc = loaded?.title ?? catalog?.title;
    const base = {
      id: toolId,
      component: "tool",
      title: titleSrc ? titleSrc[settingsStore.get().locale] : toolId,
      params: { toolId },
      minimumWidth: loaded?.minWidth ?? 200,
      minimumHeight: loaded?.minHeight ?? 120,
      inactive: opts.focus === false,
    };
    let panel: IDockviewPanel;
    if (region === "center") {
      const center = this.api.groups.find((g) => g.api.location.type === "grid");
      panel = center ? this.api.addPanel({ ...base, position: { referenceGroup: center } }) : this.api.addPanel(base);
    } else {
      const edge = this.ensureEdge(region);
      panel = this.api.addPanel({ ...base, position: { referenceGroup: edge.id } });
      if (opts.focus !== false && edge.isCollapsed()) edge.expand();
    }
    appLog(`＋ ${this.id}: open ${toolId} → ${region}`);
    return panel;
  }

  /** @deprecated use requestOpenTool — kept name for call sites that only need panel after load */
  openTool(toolId: string, opts: { focus?: boolean } = {}) {
    void this.requestOpenTool(toolId, opts);
    return this.panelFor(toolId);
  }

  reveal(panel: IDockviewPanel) {
    const loc = panel.group.api.location;
    if (loc.type === "edge") {
      const edge = this.api.getEdgeGroup(loc.position);
      if (edge?.isCollapsed()) edge.expand();
    }
    panel.api.setActive();
    if (loc.type === "popout") {
      const label = this.labelByWindow.get(loc.getWindow());
      if (label) focusWindow(label);
      loc.getWindow().focus();
    }
    appLog(`◎ ${this.id}: focus ${panel.id} (${loc.type})`);
  }

  openAll() {
    void openTools(
      TOOLS.map((t) => t.id).filter((id) => isAllowed(id)),
      this.panelCtx(),
    );
  }

  /** dockview refuses to pop out edge groups, so edge panels are popped out individually. */
  async popout(group: DockviewGroupPanel) {
    let item: DockviewGroupPanel | IDockviewPanel = group;
    const loc = group.api.location;
    if (loc.type === "edge") {
      const panel = group.activePanel;
      if (!panel) return;
      this.originByPanel.set(panel.id, loc.position as EdgePos);
      if (group.size === 1) {
        const center = this.api.groups.find((g) => g.api.location.type === "grid");
        if (center) panel.api.moveTo({ group: center, position: "right" });
        else this.api.addFloatingGroup(panel);
        await new Promise((r) => setTimeout(r, 50));
        item = panel.group;
      } else {
        item = panel;
      }
    }
    const el = group.element.getBoundingClientRect();
    // WKWebView reports window.screenX/Y as ~0 on multi-monitor setups, so Rust adds the real main-window origin.
    const box: Box = {
      x: Math.round(el.left + 40),
      y: Math.round(el.top + 40),
      width: Math.max(420, Math.round(el.width)),
      height: Math.max(320, Math.round(el.height)),
    };
    log(`[${this.id}] popout requested group=${group.id} loc=${loc.type} offset=${box.x},${box.y}`);
    toast.message("Opening pop-out… / 正在弹出窗口…");
    await queuePopout(this.id, box, true);
    const ok = await this.api.addPopoutGroup(item, { position: { left: box.x!, top: box.y!, width: box.width!, height: box.height! } });
    if (!ok) await clearPopoutQueue();
    log(`[${this.id}] addPopoutGroup -> ${ok}`);
  }

  /** Return panels to where they came from (edge dock if they were popped out of one). */
  dockBack(group: DockviewGroupPanel) {
    const panels = [...group.panels];
    const needsGrid = panels.some((p) => !this.originByPanel.has(p.id));
    // While a pop-out is open dockview keeps its origin group hidden in the grid as a placeholder;
    // moving panels into that hidden group makes them vanish when the pop-out is disposed.
    const grid = needsGrid
      ? (this.api.groups.find((g) => g.api.location.type === "grid" && g !== group && g.api.isVisible) ?? this.api.addGroup())
      : undefined;
    if (!panels.some((p) => this.originByPanel.has(p.id))) {
      group.api.moveTo({ group: grid! });
      return;
    }
    for (const p of panels) {
      const origin = this.originByPanel.get(p.id);
      this.originByPanel.delete(p.id);
      const target = origin ? this.ensureEdge(origin) : undefined;
      if (target) p.api.moveTo({ group: this.api.getGroup(target.id) as DockviewGroupPanel, position: "center" });
      else if (grid) p.api.moveTo({ group: grid, position: "center" });
    }
  }

  floatPanel(panel: IDockviewPanel) {
    this.api.addFloatingGroup(panel, { width: 400, height: 320, x: 140, y: 90 });
  }

  handleCloseRequested(label: string) {
    for (const p of this.api.getPopouts()) {
      if (this.labelByWindow.get(p.window) === label) {
        appLog(`↩ ${this.id}: native close on ${label} → panel returned to main window`);
        this.destroying.add(label);
        const dump = (tag: string) =>
          log(`[${this.id}] ${tag}: panels=${this.api.panels.map((x) => `${x.id}@${x.group.id}:${x.group.api.location.type}`).join(" ")} groups=${this.api.groups.map((g) => `${g.id}:${g.api.location.type}(${g.size})`).join(" ")}`);
        dump("before dockBack");
        try {
          this.dockBack(p.group);
        } catch (e) {
          log(`dockBack threw ${e}`);
        }
        dump("after dockBack");
        setTimeout(() => dump("before destroy"), 240);
        setTimeout(() => destroyWindow(label).finally(() => this.destroying.delete(label)), 250);
        return true;
      }
    }
    return false;
  }

  float(group: DockviewGroupPanel) {
    const panel = group.activePanel;
    if (panel) this.api.addFloatingGroup(panel, { width: 400, height: 320, x: 140, y: 90 });
  }

  applyAutoCollapse(auto: Record<EdgePos, boolean>) {
    this.autoState = auto;
    this.applyingAuto = true;
    try {
      for (const pos of EDGES) {
        const g = this.api.getEdgeGroup(pos);
        if (!g) continue;
        const want = this.userCollapsed[pos] || auto[pos];
        if (want && !g.isCollapsed()) g.collapse();
        if (!want && g.isCollapsed()) g.expand();
      }
    } finally {
      this.applyingAuto = false;
    }
  }

  toggleEdge(pos: EdgePos) {
    const g = this.api.getEdgeGroup(pos);
    if (!g) return;
    const collapse = !g.isCollapsed();
    this.userCollapsed[pos] = collapse;
    this.applyingAuto = true;
    if (collapse) g.collapse();
    else g.expand();
    this.applyingAuto = false;
    this.scheduleSave();
    bumpLive();
  }

  snapshot(): LayoutSnapshot {
    const data = this.api.toJSON();
    if (data.edgeGroups) {
      for (const pos of EDGES) {
        const e = data.edgeGroups[pos];
        if (e) e.collapsed = this.userCollapsed[pos];
      }
    }
    const popouts = this.api.getPopouts();
    const popoutGeometry = (data.popoutGroups ?? []).map((pg, i) => {
      const label = popouts[i] ? this.labelByWindow.get(popouts[i].window) : undefined;
      const g = label ? this.geomByLabel.get(label) : undefined;
      if (g && g.x !== undefined) pg.position = { left: g.x, top: g.y!, width: g.width!, height: g.height! };
      return g ?? (pg.position ? { x: pg.position.left, y: pg.position.top, width: pg.position.width, height: pg.position.height } : null);
    });
    return {
      kind: "ek.layoutSnapshot",
      layoutVersion: 1,
      adapter: { name: "dockview", version: "8.3.1" },
      data,
      panels: Object.values(data.panels).map((p) => ({ panel: String((p.params as { toolId?: string })?.toolId ?? p.id) })),
      chrome: { collapsedDocks: EDGES.filter((p) => this.userCollapsed[p]) },
      popoutGeometry,
      savedAt: new Date().toISOString(),
    };
  }

  async restore(snap: LayoutSnapshot) {
    this.restoring = true;
    for (const p of [...this.api.panels]) {
      const toolId = String((p.params as { toolId?: string } | undefined)?.toolId ?? p.id);
      await closeTool(toolId, { skipReload: true });
    }
    await clearPopoutQueue();
    for (const p of this.api.getPopouts()) {
      const label = this.labelByWindow.get(p.window);
      if (label) this.destroying.add(label);
    }
    const toolIds = snap.panels.map((p) => p.panel);
    await ensureToolsLoaded(toolIds);
    const expected = snap.data.popoutGroups?.length ?? 0;
    for (let i = 0; i < expected; i++) {
      const pos = snap.data.popoutGroups![i].position;
      const g = snap.popoutGeometry?.[i] ?? (pos ? { x: pos.left, y: pos.top, width: pos.width, height: pos.height } : {});
      await queuePopout(this.id, g ?? {});
    }
    try {
      this.api.fromJSON(snap.data);
    } catch (e) {
      appLog(`⚠ ${this.id}: fromJSON failed: ${e}`);
      toast.error(String(e));
      this.restoring = false;
      await this.buildDefault();
      return;
    }
    for (const pos of EDGES) this.watchEdge(pos);
    this.userCollapsed = { left: false, right: false, bottom: false };
    for (const pos of snap.chrome?.collapsedDocks ?? []) this.userCollapsed[pos] = true;
    await this.api.popoutRestorationPromise;
    await new Promise((r) => setTimeout(r, 300));
    const got = this.api.getPopouts().length;
    if (got < expected) {
      appLog(`⚠ ${this.id}: restored ${got}/${expected} pop-outs (missing ones fall back into the main window)`);
      toast.warning(`Pop-outs restored ${got}/${expected}`);
    } else if (expected) {
      appLog(`✓ ${this.id}: restored ${got} pop-out window(s)`);
    }
    await clearPopoutQueue();
    this.restoring = false;
    this.applyAutoCollapse(this.autoState);
    bumpLive();
  }

  scheduleSave() {
    if (this.restoring) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    if (!this.api) return;
    localStorage.setItem(`ek.ws.${this.id}`, JSON.stringify(this.snapshot()));
  }

  loadSaved(): LayoutSnapshot | null {
    try {
      const raw = localStorage.getItem(`ek.ws.${this.id}`);
      return raw ? (JSON.parse(raw) as LayoutSnapshot) : null;
    } catch {
      return null;
    }
  }

  setLocked(locked: boolean) {
    this.api.updateOptions({ disableDnd: locked, locked });
    for (const g of this.api.groups) g.locked = locked ? "no-drop-target" : false;
  }

  popoutWindows() {
    return this.api?.getPopouts().map((p) => p.window) ?? [];
  }
}

export const controllers = new Map<string, WorkspaceController>();

export function getController(id: string) {
  let c = controllers.get(id);
  if (!c) {
    c = new WorkspaceController(id);
    controllers.set(id, c);
  }
  return c;
}

export function activeController() {
  return controllers.get(workspacesStore.get().active);
}

export function bumpLive() {
  let n = 0;
  controllers.forEach((c) => (n += c.api ? c.api.getPopouts().length : 0));
  liveStore.set((s) => ({ ...s, popouts: n, tick: s.tick + 1 }));
}

export function allDocuments(): Document[] {
  const docs: Document[] = [document];
  controllers.forEach((c) => c.popoutWindows().forEach((w) => docs.push(w.document)));
  return docs;
}

type DocHook = (doc: Document) => void;
const docHooks: DocHook[] = [];
export function onEachDocument(hook: DocHook) {
  docHooks.push(hook);
  allDocuments().forEach(hook);
}
export function prepareDocument(doc: Document) {
  docHooks.forEach((h) => h(doc));
}

on<{ label: string; tag: string }>("ek:popout-created", ({ label, tag }) => {
  const q = pendingLabels.get(tag) ?? [];
  q.push(label);
  pendingLabels.set(tag, q);
});

on<string>("ek:popout-close-requested", (label) => {
  const owner = labelOwner.get(label);
  if (!owner?.handleCloseRequested(label)) destroyWindow(label);
});

on<{ label: string; x: number; y: number; width: number; height: number }>("ek:popout-geometry", (g) => {
  const owner = labelOwner.get(g.label);
  if (!owner) return;
  owner.geomByLabel.set(g.label, { x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height) });
  owner.scheduleSave();
});

let lastChrome = chromeStore.get();
chromeStore.subscribe(() => {
  const next = chromeStore.get();
  if (next.locked !== lastChrome.locked) controllers.forEach((c) => c.api && c.setLocked(next.locked));
  if (next.focusMode !== lastChrome.focusMode) {
    const auto = next.focusMode ? { left: true, right: true, bottom: true } : liveStore.get().auto;
    controllers.forEach((c) => c.api && c.applyAutoCollapse(auto));
    bumpLive();
  }
  lastChrome = next;
});

export function makePresetFile(items: { name: string; snapshot: LayoutSnapshot }[]): PresetFile {
  return { kind: "ek.layoutPresetFile", version: 1, presets: items };
}

export function missingTools(snap: LayoutSnapshot) {
  return snap.panels.map((p) => p.panel).filter((id) => !CATALOG_MAP[id] || !isAllowed(id));
}

export { t };
