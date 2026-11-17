import { appKv, type ToolPanelProps } from "@ek/tool-api";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { scenarioT, type ScenarioStringKey } from "../i18n";
import { useScenarioLocale } from "../locale";
import { clearCurrentScene, publishCurrentScene } from "../moduleData";
import { ProjectPath } from "../projectPath";
import { BodyEditor } from "./BodyEditor";
import { ClueColumn } from "./ClueColumn";
import { MapColumn } from "./MapColumn";
import { NpcColumn } from "./NpcColumn";
import { SceneNav } from "./SceneNav";
import { columnLayoutKey, fitColumns, MIN_CENTER, MIN_COLUMN, readColumnShares } from "./columnLayout";

const MIN_PANE = 72;

function paneHeight(ratio: number) {
  return `calc((100% - 1px) * ${ratio})`;
}

/** Initial pane size; later sizes are set on the element directly. */
const PANE_STYLE = { flex: "none", height: paneHeight(0.5) } as const;

export function ScenarioPanel({ projectPath, modulePath, mode, moduleEditable }: ToolPanelProps) {
  const play = mode === "play";
  const source = play ? (modulePath ?? "") : projectPath;
  const editable = play ? moduleEditable === true : true;
  const recordPath = play ? projectPath : "";
  const locale = useScenarioLocale();
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  // Nothing is selected until SceneNav has the tree; it then picks the first scene.
  const [selected, setSelected] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const panes = useRef<Record<"leftTop" | "leftBottom" | "rightTop" | "rightBottom", HTMLElement | null>>({
    leftTop: null,
    leftBottom: null,
    rightTop: null,
    rightBottom: null,
  });
  // Column sizes are written straight to the DOM. Dragging a separator or resizing the window
  // then moves the panes without re-rendering the five columns inside them.
  const storageKey = columnLayoutKey(mode);
  const [initialShares] = useState(() => readColumnShares(appKv.get(storageKey)));
  const shares = useRef({ ...initialShares });
  const stopDrag = useRef<(() => void) | null>(null);
  const ratios = useRef({ left: 0.5, right: 0.5 });

  function applySize() {
    const frame = frameRef.current;
    if (!frame || frame.clientWidth <= 0) return;
    const width = frame.clientWidth;
    const fitted = fitColumns(width, shares.current);
    if (leftRef.current) leftRef.current.style.width = `${fitted.left}px`;
    if (rightRef.current) rightRef.current.style.width = `${fitted.right}px`;
  }

  function applyRatio(side: "left" | "right") {
    const ratio = side === "left" ? ratios.current.left : ratios.current.right;
    const top = side === "left" ? panes.current.leftTop : panes.current.rightTop;
    const bottom = side === "left" ? panes.current.leftBottom : panes.current.rightBottom;
    if (top) top.style.height = paneHeight(ratio);
    if (bottom) bottom.style.height = paneHeight(1 - ratio);
  }

  useEffect(() => {
    publishCurrentScene(source, selected);
    return () => clearCurrentScene(source);
  }, [source, selected]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    shares.current = readColumnShares(appKv.get(storageKey));
    const observer = new ResizeObserver(() => applySize());
    observer.observe(frame);
    applySize();
    return () => {
      observer.disconnect();
      stopDrag.current?.();
      stopDrag.current = null;
    };
  }, [storageKey]);

  function dragWidth(event: ReactPointerEvent<HTMLDivElement>, edge: "left" | "right") {
    const frame = frameRef.current;
    if (!frame || frame.clientWidth <= MIN_CENTER + 2) return;
    stopDrag.current?.();
    const share = shares.current;
    const key = storageKey;
    const width = frame.clientWidth;
    const fitted = fitColumns(width, share);
    const origin = fitted[edge];
    const other = fitted[edge === "left" ? "right" : "left"];
    const min = Math.min(MIN_COLUMN, Math.max(0, width - MIN_CENTER - 2) / 2);
    const max = Math.max(min, width - other - MIN_CENTER - 2);
    let changed = false;
    const save = () => {
      if (!changed) return;
      appKv.set(key, JSON.stringify({ version: 1, ...share }));
      changed = false;
    };
    const flush = () => save();
    window.addEventListener("ek:flush", flush);
    stopDrag.current = drag(event, "x", (point) => {
      const delta = edge === "left" ? point : -point;
      const next = Math.min(max, Math.max(min, origin + delta));
      if (next === origin && !changed) return;
      // Base both shares on visible widths when the user starts adjusting a constrained layout.
      share[edge] = next / width;
      share[edge === "left" ? "right" : "left"] = other / width;
      changed = true;
      applySize();
    }, () => {
      window.removeEventListener("ek:flush", flush);
      save();
    });
  }

  function dragSplit(event: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") {
    const column = side === "left" ? leftRef.current : rightRef.current;
    if (!column) return;
    const span = column.clientHeight - 1;
    if (span <= MIN_PANE * 2) return;
    const ratio = side === "left" ? ratios.current.left : ratios.current.right;
    const origin = ratio * span;
    stopDrag.current?.();
    stopDrag.current = drag(event, "y", (point) => {
      const next = Math.min(span - MIN_PANE, Math.max(MIN_PANE, origin + point));
      const value = next / span;
      if (side === "left") ratios.current.left = value;
      else ratios.current.right = value;
      applyRatio(side);
    });
  }

  return (
    <ProjectPath.Provider value={source}>
      <div ref={frameRef} className="flex h-full min-h-0 bg-border text-sm">
        <div ref={leftRef} className="flex h-full min-h-0 min-w-0 shrink-0 flex-col" style={{ width: `${initialShares.left * 100}%` }}>
          <section ref={(node) => { panes.current.leftTop = node; }} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={PANE_STYLE}>
            <SceneNav locale={locale} projectPath={source} selected={selected} onSelect={setSelected} editable={editable} />
          </section>
          <Separator label={t("resizeSceneClues")} orientation="horizontal" onPointerDown={(event) => dragSplit(event, "left")} />
          <section ref={(node) => { panes.current.leftBottom = node; }} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={PANE_STYLE}>
            <ClueColumn locale={locale} projectPath={source} recordPath={recordPath} selected={selected} editable={editable} />
          </section>
        </div>
        <Separator label={t("resizeSceneColumn")} orientation="vertical" onPointerDown={(event) => dragWidth(event, "left")} />
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <Header>{t("body")}</Header>
          <BodyEditor key={selected} projectPath={source} pageId={selected} editable={editable} />
        </section>
        <Separator label={t("resizeSideColumn")} orientation="vertical" onPointerDown={(event) => dragWidth(event, "right")} />
        <div ref={rightRef} className="flex h-full min-h-0 min-w-0 shrink-0 flex-col" style={{ width: `${initialShares.right * 100}%` }}>
          <section ref={(node) => { panes.current.rightTop = node; }} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={PANE_STYLE}>
            <NpcColumn locale={locale} projectPath={source} recordPath={recordPath} selected={selected} editable={editable} />
          </section>
          <Separator label={t("resizeNpcMap")} orientation="horizontal" onPointerDown={(event) => dragSplit(event, "right")} />
          <section ref={(node) => { panes.current.rightBottom = node; }} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={PANE_STYLE}>
            <MapColumn locale={locale} projectPath={source} selected={selected} editable={editable} />
          </section>
        </div>
      </div>
    </ProjectPath.Provider>
  );
}

function drag(event: ReactPointerEvent<HTMLDivElement>, axis: "x" | "y", apply: (delta: number) => void, complete?: () => void) {
  event.preventDefault();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const start = axis === "x" ? event.clientX : event.clientY;
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // Synthetic events have no pointer to capture.
  }
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    apply((axis === "x" ? next.clientX : next.clientY) - start);
  };
  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    complete?.();
  };
  const end = (next: PointerEvent) => {
    if (next.pointerId === pointerId) cleanup();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
  return cleanup;
}

function Separator({
  orientation,
  label,
  onPointerDown,
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={label}
      data-pane-resize={vertical ? "vertical" : "horizontal"}
      className={vertical
        ? "relative z-10 w-px shrink-0 cursor-col-resize bg-border touch-none select-none"
        : "relative z-10 h-px shrink-0 cursor-row-resize bg-border touch-none select-none"}
      onPointerDown={onPointerDown}
    >
      <div className={vertical ? "absolute inset-y-0 -left-1.5 w-3" : "absolute inset-x-0 -top-1.5 h-3"} />
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className="flex h-7 shrink-0 items-center border-b border-border bg-card px-2.5 text-base font-semibold">{children}</div>;
}
