import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DockviewReact,
  themeAbyss,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CommandIcon,
  CopyIcon,
  FocusIcon,
  LockIcon,
  LockOpenIcon,
  Maximize2Icon,
  Minimize2Icon,
  MoonIcon,
  MoreHorizontalIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PictureInPicture2Icon,
  PlusIcon,
  SquareArrowOutUpRightIcon,
  SunIcon,
  UndoDotIcon,
  WrenchIcon,
  XIcon,
  LayoutTemplateIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { TOOL_MAP, TOOLS, UNKNOWN_ICON } from "./tools";
import { allowedToolsStore, getLoadedTool, getToolError, isAllowed, loadedToolsStore, setAllowed } from "./tools/allowed";
import { appLog, chromeStore, settingsStore, useStore } from "./lib/store";
import { t, translate, useL, useT, type I18nKey } from "./lib/i18n";

const kw = (...keys: I18nKey[]) => keys.flatMap((k) => [translate("zh", k), translate("en", k)]).join(" ");
import { openTextFile, saveTextFile, log } from "./lib/platform";
import {
  EDGES,
  activeController,
  allDocuments,
  autoCollapseFor,
  bumpLive,
  controllers,
  getController,
  liveStore,
  makePresetFile,
  missingTools,
  onEachDocument,
  presetsStore,
  workspacesStore,
  type EdgePos,
  type LayoutSnapshot,
  type PresetFile,
} from "./layout";

class PanelErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="p-4 text-sm text-destructive">
          {String(this.state.error)} <Button size="xs" onClick={() => this.setState({ error: undefined })}>Reload</Button>
        </div>
      );
    return this.props.children;
  }
}

function ToolPanel(props: IDockviewPanelProps<{ toolId: string }>) {
  const tr = useT();
  const l = useL();
  useStore(loadedToolsStore);
  useStore(allowedToolsStore);
  const toolId = props.params.toolId;
  const catalog = TOOL_MAP[toolId];
  const loaded = getLoadedTool(toolId);
  const err = getToolError(toolId);
  const allowed = isAllowed(toolId);
  const name = loaded ? l(loaded.title) : catalog ? l(catalog.title) : toolId;

  if (!catalog) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-4 text-center text-foreground" data-placeholder={toolId}>
        <div className="text-base font-medium">{tr("ph.missing", { name })}</div>
        <div className="max-w-xs text-sm text-muted-foreground">{tr("ph.missingHint")}</div>
        <Button size="sm" variant="outline" onClick={() => props.api.close()}>
          {tr("ph.close")}
        </Button>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-4 text-center text-foreground" data-placeholder={toolId}>
        <div className="text-base font-medium">{tr("ph.disabled", { name })}</div>
        <div className="max-w-xs text-sm text-muted-foreground">{tr("ph.disabledHint")}</div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAllowed(toolId, true)}>
            {tr("ph.enable")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => props.api.close()}>
            {tr("ph.close")}
          </Button>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-4 text-center text-foreground" data-placeholder={toolId}>
        <div className="text-base font-medium">{name}</div>
        <div className="max-w-sm text-sm text-destructive">{err}</div>
        <Button size="sm" variant="outline" onClick={() => props.api.close()}>
          {tr("ph.close")}
        </Button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-sm text-muted-foreground">
        Loading {name}…
      </div>
    );
  }

  const C = loaded.panels[0]?.component;
  if (!C) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-sm text-destructive">
        Tool has no panels
      </div>
    );
  }

  return (
    <PanelErrorBoundary>
      <C panelId={toolId} />
    </PanelErrorBoundary>
  );
}

function Tab(props: IDockviewPanelHeaderProps<{ toolId: string }>) {
  const l = useL();
  const { locked } = useStore(chromeStore);
  useStore(loadedToolsStore);
  useStore(allowedToolsStore);
  const catalog = TOOL_MAP[props.params.toolId];
  const loaded = getLoadedTool(props.params.toolId);
  const Icon = loaded?.icon ?? catalog?.icon ?? UNKNOWN_ICON;
  const off = !catalog || !isAllowed(props.params.toolId) || !!getToolError(props.params.toolId);
  const title = loaded ? l(loaded.title) : catalog ? l(catalog.title) : props.params.toolId;
  useEffect(() => {
    if (props.api.title !== title) props.api.setTitle(title);
  }, [title, props.api]);
  return (
    <div
      className={`flex h-full items-center gap-1.5 px-2 text-[0.8rem] ${off ? "italic opacity-50" : ""}`}
      title={title}
      onDoubleClick={() => {
        const api = props.containerApi;
        if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
        else if (props.api.group.api.location.type === "grid") props.api.maximize();
      }}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="ek-tab-title truncate">{title}</span>
      {!locked && (
        <button
          className="ml-1 rounded p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.api.close();
          }}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

function HeaderActions(props: IDockviewHeaderActionsProps) {
  const tr = useT();
  const { locked } = useStore(chromeStore);
  const [maxed, setMaxed] = useState(props.containerApi.hasMaximizedGroup());
  useEffect(() => {
    const d = props.containerApi.onDidMaximizedGroupChange(() => setMaxed(props.containerApi.hasMaximizedGroup()));
    return () => d.dispose();
  }, [props.containerApi]);
  const ctrl = [...controllers.values()].find((c) => c.api === props.containerApi);
  const loc = props.api.location.type;
  if (!ctrl || locked) return null;
  const btn = "rounded p-1 opacity-70 hover:bg-foreground/10 hover:opacity-100";
  return (
    <div className="flex h-full items-center gap-0.5 px-1">
      {(loc === "grid" || loc === "edge") && (
        <button className={btn} title={tr("panel.float")} onClick={() => ctrl.float(props.group)}>
          <PictureInPicture2Icon className="size-3.5" />
        </button>
      )}
      {loc !== "popout" && (
        <button className={btn} title={tr("panel.popout")} data-action="popout"
          onPointerDown={(e) => log(`UI popout pointerdown group=${props.group.id} type=${e.pointerType}`)}
          onClick={() => {
            log(`UI popout click group=${props.group.id}`);
            ctrl.popout(props.group).catch((err) => log(`UI popout error ${err}`));
          }}
        >
          <SquareArrowOutUpRightIcon className="size-3.5" />
        </button>
      )}
      {(loc === "popout" || loc === "floating") && (
        <button className={btn} title={tr("panel.dockback")} data-action="dockback" onClick={() => ctrl.dockBack(props.group)}>
          <UndoDotIcon className="size-3.5" />
        </button>
      )}
      {loc === "grid" && (
        <button
          className={btn}
          title={tr("panel.maximize")}
          onClick={() => (maxed ? props.containerApi.exitMaximizedGroup() : props.activePanel && props.containerApi.maximizeGroup(props.activePanel))}
        >
          {maxed ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

function Watermark(_: IWatermarkPanelProps) {
  const tr = useT();
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {tr("ws.empty")}
    </div>
  );
}

const components = { tool: ToolPanel };

function WorkspaceView({ id, visible }: { id: string; visible: boolean }) {
  const { theme } = useStore(settingsStore);
  const onReady = async (e: DockviewReadyEvent) => {
    const ctrl = getController(id);
    ctrl.attach(e.api);
    const saved = ctrl.loadSaved();
    if (saved) {
      const missing = missingTools(saved);
      await ctrl.restore(saved);
      if (missing.length) appLog(`⚠ ${id}: layout references unknown tools: ${missing.join(", ")}`);
      appLog(`↻ ${id}: layout restored from autosave (${saved.savedAt})`);
    } else {
      await ctrl.buildDefault();
      appLog(`★ ${id}: built-in default layout`);
    }
    ctrl.applyAutoCollapse(liveStore.get().auto);
    ctrl.setLocked(chromeStore.get().locked);
    bumpLive();
  };
  return (
    <div className="absolute inset-0" style={{ display: visible ? "block" : "none" }} data-workspace={id}>
      <DockviewReact
        components={components}
        defaultTabComponent={Tab}
        rightHeaderActionsComponent={HeaderActions}
        watermarkComponent={Watermark}
        theme={theme === "dark" ? themeAbyss : themeLight}
        onReady={onReady}
      />
    </div>
  );
}

let paletteContainer: HTMLElement | null = null;
function openPalette(doc: Document) {
  paletteContainer = doc === document ? null : doc.body;
  chromeStore.set((s) => ({ ...s, paletteOpen: true }));
}

function CommandPalette() {
  const tr = useT();
  const l = useL();
  const { paletteOpen, locked, focusMode } = useStore(chromeStore);
  const ws = useStore(workspacesStore);
  useStore(allowedToolsStore);
  useStore(loadedToolsStore);
  const close = () => chromeStore.set((s) => ({ ...s, paletteOpen: false }));
  const run = (f: () => void) => {
    close();
    setTimeout(f, 30);
  };
  const ctrl = activeController();
  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={(o) => chromeStore.set((s) => ({ ...s, paletteOpen: o }))}>
      <DialogPrimitive.Portal container={paletteContainer ?? undefined}>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Popup className="fixed top-[12%] left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10" data-palette>
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command>
            <CommandInput placeholder={tr("cmd.search")} autoFocus />
            <CommandList className="max-h-[60vh]">
              <CommandEmpty>{tr("cmd.empty")}</CommandEmpty>
              <CommandGroup heading={tr("cmd.tools")}>
                {TOOLS.filter((tool) => isAllowed(tool.id)).map((tool) => {
                  const open = !!ctrl?.panelFor(tool.id);
                  const Icon = tool.icon;
                  return (
                    <CommandItem
                      key={tool.id}
                      value={`${tool.id} ${tool.title.zh} ${tool.title.en}`}
                      onSelect={() => run(() => void ctrl?.requestOpenTool(tool.id))}
                    >
                      <Icon />
                      {l(tool.title)}
                      <CommandShortcut>{open ? "●" : ""}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandGroup heading={tr("cmd.workspaces")}>
                {ws.list.map((w, i) => (
                  <CommandItem key={w.id} value={`workspace ${w.name}`} onSelect={() => run(() => workspacesStore.set((s) => ({ ...s, active: w.id })))}>
                    <LayoutTemplateIcon />
                    {w.name}
                    <CommandShortcut>Ctrl+{i + 1}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={tr("cmd.commands")}>
                <CommandItem value={`open all tools ${kw("cmd.openAll")}`} onSelect={() => run(() => ctrl?.openAll())}>{tr("cmd.openAll")}</CommandItem>
                <CommandItem value="reset clean default layout" onSelect={() => run(() => void resetDefaultLayout())}>{tr("layout.resetDefault")}</CommandItem>
                <CommandItem value={`lock layout ${kw("lock.on", "lock.off")}`} onSelect={() => run(() => chromeStore.set((s) => ({ ...s, locked: !s.locked })))}>{locked ? tr("lock.on") : tr("lock.off")}<CommandShortcut>Ctrl+Shift+L</CommandShortcut></CommandItem>
                <CommandItem value={`focus mode ${kw("focus.on", "focus.off")}`} onSelect={() => run(() => chromeStore.set((s) => ({ ...s, focusMode: !s.focusMode })))}>{focusMode ? tr("focus.on") : tr("focus.off")}<CommandShortcut>F11</CommandShortcut></CommandItem>
                <CommandItem value={`maximize active group ${kw("panel.maximize")}`} onSelect={() => run(() => { const a = ctrl?.api; if (a?.activePanel) a.hasMaximizedGroup() ? a.exitMaximizedGroup() : a.maximizeGroup(a.activePanel); })}>{tr("panel.maximize")}<CommandShortcut>Ctrl+Shift+M</CommandShortcut></CommandItem>
                {EDGES.map((p) => (
                  <CommandItem key={p} value={`toggle ${p} dock ${kw(`dock.${p}` as const)}`} onSelect={() => run(() => ctrl?.toggleEdge(p))}>{tr(`dock.${p}` as const)}</CommandItem>
                ))}
                <CommandItem value={`theme toggle dark light ${kw("settings.theme")}`} onSelect={() => run(() => settingsStore.set((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" })))}>{tr("settings.theme")}</CommandItem>
                <CommandItem value={`language toggle zh en ${kw("settings.lang")}`} onSelect={() => run(() => settingsStore.set((s) => ({ ...s, locale: s.locale === "zh" ? "en" : "zh" })))}>{tr("settings.lang")}</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ToolManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const tr = useT();
  const l = useL();
  useStore(allowedToolsStore);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("tools.manage")}</DialogTitle>
          <DialogDescription>
            {tr("tools.manageHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
          <span />
          <span className="text-xs text-muted-foreground">{tr("tools.enabled")}</span>
          {TOOLS.map((tool) => {
            const on = isAllowed(tool.id);
            const Icon = tool.icon;
            return (
              <div key={tool.id} className="contents">
                <span className="flex items-center gap-2">
                  <Icon className="size-4" /> {l(tool.title)}
                </span>
                <Switch
                  checked={on}
                  onCheckedChange={(v) => {
                    setAllowed(tool.id, v);
                    appLog(`${v ? "✓ allow" : "⏸ disallow"} ${tool.id}`);
                    if (v)
                      toast(t("tools.available", { name: l(tool.title) }), {
                        action: { label: t("action.open"), onClick: () => void activeController()?.requestOpenTool(tool.id) },
                      });
                  }}
                />
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SavePresetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const tr = useT();
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("layout.savePreset")}</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name && (e.currentTarget.closest("[data-slot=dialog-content]")?.querySelector<HTMLButtonElement>("[data-save-preset]")?.click())} placeholder={tr("layout.presetNamePlaceholder")} />
        <DialogFooter>
          <Button
            data-save-preset
            disabled={!name}
            onClick={() => {
              const snap = activeController()?.snapshot();
              if (!snap) return;
              presetsStore.set((s) => ({ items: [...s.items.filter((p) => p.name !== name), { name, snapshot: snap }] }));
              toast.success(`Preset “${name}” saved`);
              appLog(`💾 preset saved: ${name}`);
              setName("");
              onOpenChange(false);
            }}
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function exportPresets() {
  const ctrl = activeController();
  if (!ctrl) return;
  const current = { name: `current-${workspacesStore.get().active}`, snapshot: ctrl.snapshot() };
  const file = makePresetFile([...presetsStore.get().items, current]);
  const path = await saveTextFile("easykeeper-layout.eklayout.json", JSON.stringify(file, null, 2));
  if (path) {
    toast.success(`Exported → ${path}`);
    appLog(`⤓ exported ${file.presets.length} preset(s) → ${path}`);
  }
}

async function importPresets() {
  const f = await openTextFile();
  if (!f) return;
  try {
    const parsed = JSON.parse(f.contents) as PresetFile;
    if (parsed.kind !== "ek.layoutPresetFile") throw new Error("not an EasyKeeper layout preset file");
    const names: string[] = [];
    presetsStore.set((s) => {
      const items = [...s.items];
      for (const p of parsed.presets) {
        let n = p.name;
        while (items.some((x) => x.name === n)) n = `${n} (imported)`;
        items.push({ name: n, snapshot: p.snapshot });
        names.push(n);
      }
      return { items };
    });
    const missing = [...new Set(parsed.presets.flatMap((p) => missingTools(p.snapshot)))];
    toast.success(`Imported ${names.length} preset(s)${missing.length ? `; unknown tools: ${missing.join(", ")}` : ""}`);
    appLog(`⤒ imported ${names.join(", ")} from ${f.path}${missing.length ? ` (unknown tools: ${missing.join(", ")})` : ""}`);
  } catch (e) {
    toast.error(String(e));
  }
}

function applyPreset(snap: LayoutSnapshot, name: string) {
  const ctrl = activeController();
  if (!ctrl) return;
  const clean: LayoutSnapshot = { ...snap, data: { ...snap.data, popoutGroups: snap.data.popoutGroups } };
  ctrl.restore(clean).then(() => ctrl.saveNow());
  appLog(`▶ applied preset ${name} to ${workspacesStore.get().active}`);
}

function TopBar({ onTools, onSavePreset }: { onTools: () => void; onSavePreset: () => void }) {
  const tr = useT();
  const ws = useStore(workspacesStore);
  const settings = useStore(settingsStore);
  const { locked } = useStore(chromeStore);
  const live = useStore(liveStore);
  const presets = useStore(presetsStore);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ctrl = activeController();
  const edgeIcons: Record<EdgePos, typeof PanelLeftIcon> = { left: PanelLeftIcon, bottom: PanelBottomIcon, right: PanelRightIcon };
  void live.tick;
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2 text-card-foreground">
      <span className="mr-2 hidden shrink-0 whitespace-nowrap text-sm font-semibold xl:inline">{tr("app.title")}</span>
      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {ws.list.map((w, i) => (
          <div key={w.id} className={`group flex shrink-0 items-center rounded-md ${w.id === ws.active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {renaming === w.id ? (
              <Input
                autoFocus
                defaultValue={w.name}
                className="h-7 w-32"
                onBlur={(e) => {
                  const name = e.target.value || w.name;
                  workspacesStore.set((s) => ({ ...s, list: s.list.map((x) => (x.id === w.id ? { ...x, name } : x)) }));
                  setRenaming(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <button className="px-2.5 py-1 text-sm" title={`Ctrl+${i + 1}`} onClick={() => workspacesStore.set((s) => ({ ...s, active: w.id }))} onDoubleClick={() => setRenaming(w.id)}>
                {w.name}
              </button>
            )}
            {w.id === ws.active && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded px-1 py-1 opacity-80 hover:opacity-100">
                  <MoreHorizontalIcon className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52">
                  <DropdownMenuItem onClick={() => setRenaming(w.id)}>{tr("ws.rename")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateWorkspace(w.id)}>
                    <CopyIcon /> {tr("ws.dup")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { void getController(w.id).buildDefault().then(() => getController(w.id).saveNow()); }}>{tr("ws.reset")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={ws.list.length < 2} onClick={() => deleteWorkspace(w.id)}>
                    {tr("ws.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        <Button variant="ghost" size="icon-sm" title={tr("ws.new")} onClick={() => newWorkspace()}>
          <PlusIcon />
        </Button>
      </nav>
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => openPalette(document)} data-open-palette>
        <CommandIcon className="size-3.5" />
        <span className="hidden md:inline">{tr("cmd.search")}</span>
        <kbd className="rounded bg-muted px-1 text-[10px]">Ctrl K</kbd>
      </Button>
      <div className="mx-1 flex items-center">
        {EDGES.map((p) => {
          const Icon = edgeIcons[p];
          const g = ctrl?.api?.getEdgeGroup(p);
          const collapsed = g?.isCollapsed() ?? true;
          return (
            <Button key={p} variant={collapsed ? "ghost" : "secondary"} size="icon-sm" title={tr(`dock.${p}` as const)} onClick={() => ctrl?.toggleEdge(p)}>
              <Icon />
            </Button>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[0.8rem] hover:bg-muted">
          <LayoutTemplateIcon className="size-3.5" /> <span className="hidden sm:inline">{tr("layout.menu")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" align="end">
          <DropdownMenuItem onClick={onSavePreset}>{tr("layout.savePreset")}</DropdownMenuItem>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{tr("layout.loadPreset")}</DropdownMenuLabel>
            {presets.items.length === 0 && <DropdownMenuItem disabled>—</DropdownMenuItem>}
            {presets.items.map((p) => (
              <DropdownMenuItem key={p.name} onClick={() => applyPreset(p.snapshot, p.name)}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={exportPresets}>{tr("layout.export")}</DropdownMenuItem>
          <DropdownMenuItem onClick={importPresets}>{tr("layout.import")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-sm" title={tr("tools.manage")} onClick={onTools}>
        <WrenchIcon />
      </Button>
      <Button variant={locked ? "default" : "ghost"} size="icon-sm" title={locked ? tr("lock.on") : tr("lock.off")} onClick={() => chromeStore.set((s) => ({ ...s, locked: !s.locked }))}>
        {locked ? <LockIcon /> : <LockOpenIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" title={tr("focus.off")} onClick={() => chromeStore.set((s) => ({ ...s, focusMode: true }))}>
        <FocusIcon />
      </Button>
      <div className="ml-1 flex items-center gap-1 border-l border-border pl-2">
        <Button variant="ghost" size="sm" onClick={() => settingsStore.set((s) => ({ ...s, locale: s.locale === "zh" ? "en" : "zh" }))} title={tr("settings.lang")} data-lang>
          {settings.locale === "zh" ? tr("settings.langZh") : tr("settings.langEn")}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => settingsStore.set((s) => ({ ...s, fontScale: Math.max(0.8, +(s.fontScale - 0.1).toFixed(2)) }))} title={tr("settings.font")}>
          <span className="text-xs">A−</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => settingsStore.set((s) => ({ ...s, fontScale: Math.min(1.4, +(s.fontScale + 0.1).toFixed(2)) }))} title={tr("settings.font")}>
          <span className="text-sm">A+</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => settingsStore.set((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))} title={tr("settings.theme")}>
          {settings.theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </header>
  );
}

function StatusBar() {
  const tr = useT();
  const live = useStore(liveStore);
  const { locked } = useStore(chromeStore);
  const settings = useStore(settingsStore);
  const ws = useStore(workspacesStore);
  const ctrl = activeController();
  const autoOn = EDGES.filter((p) => live.auto[p]);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-border bg-card px-3 text-[0.72rem] whitespace-nowrap text-muted-foreground">
      <span>{ws.list.find((w) => w.id === ws.active)?.name}</span>
      <span>{tr("status.width")}: {live.width}px</span>
      <span>
        {tr("status.autocollapse")}: {autoOn.length ? autoOn.map((p) => tr(`dock.${p}` as const)).join(" / ") : "—"}
      </span>
      <span>
        saved: {EDGES.filter((p) => ctrl?.userCollapsed[p]).map((p) => p).join(",") || "all open"}
      </span>
      <span>{tr("status.popouts")}: {live.popouts}</span>
      <span>{settings.locale} · {Math.round(settings.fontScale * 100)}% · {settings.theme}</span>
      {locked && <span className="text-amber-500">🔒 {tr("lock.on")}</span>}
    </footer>
  );
}


async function resetDefaultLayout() {
  chromeStore.set((s) => ({ ...s, locked: false, focusMode: false, paletteOpen: false }));
  const c = activeController();
  if (!c?.api) return;
  for (const p of [...c.api.getPopouts()]) c.dockBack(p.group);
  await new Promise((r) => setTimeout(r, 300));
  await c.buildDefault();
  c.saveNow();
}

function newWorkspace(copyFrom?: string) {
  const id = `ws-${Date.now().toString(36)}`;
  const base = copyFrom ? workspacesStore.get().list.find((w) => w.id === copyFrom)?.name : undefined;
  if (copyFrom) {
    const snap = getController(copyFrom).snapshot();
    snap.data.popoutGroups = [];
    snap.popoutGeometry = [];
    localStorage.setItem(`ek.ws.${id}`, JSON.stringify(snap));
  } else {
    const empty = { kind: "ek.layoutSnapshot", layoutVersion: 1, adapter: { name: "dockview", version: "8.3.1" }, data: { grid: { root: { type: "branch", data: [] }, height: 0, width: 0, orientation: "HORIZONTAL" }, panels: {} }, panels: [], chrome: { collapsedDocks: [] }, popoutGeometry: [], savedAt: new Date().toISOString() };
    localStorage.setItem(`ek.ws.${id}`, JSON.stringify(empty));
  }
  const name = base ? `${base} (copy)` : `${t("ws.new")} ${workspacesStore.get().list.length + 1}`;
  workspacesStore.set((s) => ({ list: [...s.list, { id, name }], active: id }));
  appLog(`＋ workspace ${name}`);
}

function duplicateWorkspace(id: string) {
  newWorkspace(id);
}

async function deleteWorkspace(id: string) {
  const c = controllers.get(id);
  if (c?.api) {
    for (const p of [...c.api.getPopouts()]) c.dockBack(p.group);
  }
  controllers.delete(id);
  localStorage.removeItem(`ek.ws.${id}`);
  workspacesStore.set((s) => {
    const list = s.list.filter((w) => w.id !== id);
    return { list, active: s.active === id ? list[0].id : s.active };
  });
}

function applyDocSettings(doc: Document) {
  const s = settingsStore.get();
  const html = doc.documentElement;
  html.classList.toggle("dark", s.theme === "dark");
  html.lang = s.locale === "zh" ? "zh-CN" : "en";
  html.style.fontSize = `${16 * s.fontScale}px`;
  html.style.setProperty("--ek-font-scale", String(s.fontScale));
  doc.body.classList.add("bg-background", "text-foreground");
  if (doc !== document) {
    const want = (s.theme === "dark" ? themeAbyss : themeLight).className;
    doc.querySelectorAll<HTMLElement>(".dv-popout-window").forEach((el) => {
      [...el.classList].filter((c) => c.startsWith("dockview-theme-")).forEach((c) => el.classList.remove(c));
      el.classList.add(want);
    });
  }
}

function installKeys(doc: Document) {
  doc.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      log(`Ctrl+K in ${doc === document ? "main" : "popout"} document`);
      openPalette(doc);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      chromeStore.set((s) => ({ ...s, locked: !s.locked }));
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      const a = activeController()?.api;
      if (a?.activePanel) a.hasMaximizedGroup() ? a.exitMaximizedGroup() : a.maximizeGroup(a.activePanel);
    } else if (e.key === "F11" || (e.key === "Escape" && chromeStore.get().focusMode)) {
      e.preventDefault();
      chromeStore.set((s) => ({ ...s, focusMode: e.key === "F11" ? !s.focusMode : false }));
    } else if (mod && /^[1-9]$/.test(e.key)) {
      const w = workspacesStore.get().list[Number(e.key) - 1];
      if (w) {
        e.preventDefault();
        workspacesStore.set((s) => ({ ...s, active: w.id }));
      }
    }
  });
}

let installed = false;
function installGlobalHooks() {
  if (installed) return;
  installed = true;
  onEachDocument(applyDocSettings);
  onEachDocument(installKeys);
  settingsStore.subscribe(() => allDocuments().forEach(applyDocSettings));
  const onResize = () => {
    const auto = autoCollapseFor(window.innerWidth, window.innerHeight);
    const prev = liveStore.get().auto;
    liveStore.set((s) => ({ ...s, width: window.innerWidth, auto }));
    if (EDGES.some((p) => prev[p] !== auto[p])) controllers.forEach((c) => c.api && c.applyAutoCollapse(auto));
  };
  window.addEventListener("resize", onResize);
  onResize();
}

installGlobalHooks();

export default function App() {
  const ws = useStore(workspacesStore);
  const { focusMode } = useStore(chromeStore);
  const { theme } = useStore(settingsStore);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const ids = useMemo(() => ws.list.map((w) => w.id), [ws.list]);
  useEffect(() => bumpLive(), [ws.active]);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!focusMode && <TopBar onTools={() => setToolsOpen(true)} onSavePreset={() => setPresetOpen(true)} />}
      <main className="relative min-h-0 flex-1">
        {ids.map((id) => (
          <WorkspaceView key={id} id={id} visible={id === ws.active} />
        ))}
        {focusMode && (
          <button className="absolute top-1 right-1 z-40 rounded-md bg-card/90 px-2 py-1 text-xs shadow ring-1 ring-border" onClick={() => chromeStore.set((s) => ({ ...s, focusMode: false }))}>
            {t("focus.on")} (Esc)
          </button>
        )}
      </main>
      {!focusMode && <StatusBar />}
      <CommandPalette />
      <ToolManager open={toolsOpen} onOpenChange={setToolsOpen} />
      <SavePresetDialog open={presetOpen} onOpenChange={setPresetOpen} />
      <Toaster theme={theme} position="bottom-right" richColors />
    </div>
  );
}
