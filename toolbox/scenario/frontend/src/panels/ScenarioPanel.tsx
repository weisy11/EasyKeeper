import type { ToolPanelProps } from "@ek/tool-api";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { scenarioT, type ScenarioStringKey } from "../i18n";
import { useScenarioLocale } from "../locale";
import { clearCurrentScene, publishCurrentScene } from "../moduleData";
import { ProjectPath } from "../projectPath";
import { BodyEditor } from "./BodyEditor";
import { ClueColumn } from "./ClueColumn";
import { MapColumn } from "./MapColumn";
import { NpcColumn } from "./NpcColumn";
import { SceneNav } from "./SceneNav";

const LEFT_WIDTH = 220;
const RIGHT_WIDTH = 240;
const MIN_COLUMN = 160;
const MIN_CENTER = 280;
const MIN_PANE = 72;

export function ScenarioPanel({ projectPath, modulePath, mode, moduleEditable }: ToolPanelProps) {
  const play = mode === "play";
  const source = play ? (modulePath ?? "") : projectPath;
  const editable = play ? moduleEditable === true : true;
  const recordPath = play ? projectPath : "";
  const locale = useScenarioLocale();
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [selected, setSelected] = useState(play ? "" : "scene1");
  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(RIGHT_WIDTH);
  const [leftRatio, setLeftRatio] = useState(0.5);
  const [rightRatio, setRightRatio] = useState(0.5);
  const frameRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const shares = useRef<{ left: number; right: number } | null>(null);
  const applySizeRef = useRef<() => void>(() => {});

  function applySize() {
    const frame = frameRef.current;
    if (!frame || frame.clientWidth < 80) return;
    const width = frame.clientWidth;
    if (!shares.current) shares.current = { left: LEFT_WIDTH / width, right: RIGHT_WIDTH / width };
    setLeftWidth(shares.current.left * width);
    setRightWidth(shares.current.right * width);
  }
  applySizeRef.current = applySize;

  useEffect(() => {
    publishCurrentScene(source, selected);
    return () => clearCurrentScene(source);
  }, [source, selected]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => applySizeRef.current());
    observer.observe(frame);
    applySizeRef.current();
    return () => observer.disconnect();
  }, []);

  function dragWidth(event: ReactPointerEvent<HTMLDivElement>, edge: "left" | "right") {
    const frame = frameRef.current;
    const share = shares.current;
    if (!frame || !share || frame.clientWidth < 80) return;
    const width = frame.clientWidth;
    const origin = (edge === "left" ? share.left : share.right) * width;
    const other = (edge === "left" ? share.right : share.left) * width;
    const max = Math.max(MIN_COLUMN, width - other - MIN_CENTER - 2);
    drag(event, "x", (point) => {
      const delta = edge === "left" ? point : -point;
      const next = Math.min(max, Math.max(MIN_COLUMN, origin + delta));
      const portion = next / frame.clientWidth;
      if (edge === "left") share.left = portion;
      else share.right = portion;
      setLeftWidth(share.left * frame.clientWidth);
      setRightWidth(share.right * frame.clientWidth);
    });
  }

  function dragSplit(event: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") {
    const column = side === "left" ? leftRef.current : rightRef.current;
    if (!column) return;
    const span = column.clientHeight - 1;
    if (span <= MIN_PANE * 2) return;
    const ratio = side === "left" ? leftRatio : rightRatio;
    const origin = ratio * span;
    drag(event, "y", (point) => {
      const next = Math.min(span - MIN_PANE, Math.max(MIN_PANE, origin + point));
      const value = next / span;
      if (side === "left") setLeftRatio(value);
      else setRightRatio(value);
    });
  }

  return (
    <ProjectPath.Provider value={source}>
      <div ref={frameRef} className="flex h-full min-h-0 bg-border text-[13px]">
        <div ref={leftRef} className="flex h-full min-h-0 min-w-0 shrink-0 flex-col" style={{ width: leftWidth }}>
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={{ flex: "none", height: `calc((100% - 1px) * ${leftRatio})` }}>
            <SceneNav locale={locale} projectPath={source} selected={selected} onSelect={setSelected} editable={editable} />
          </section>
          <Separator label={t("resizeSceneClues")} orientation="horizontal" onPointerDown={(event) => dragSplit(event, "left")} />
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={{ flex: "none", height: `calc((100% - 1px) * ${1 - leftRatio})` }}>
            <ClueColumn locale={locale} projectPath={source} recordPath={recordPath} selected={selected} editable={editable} />
          </section>
        </div>
        <Separator label={t("resizeSceneColumn")} orientation="vertical" onPointerDown={(event) => dragWidth(event, "left")} />
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <Header>{t("body")}</Header>
          <BodyEditor key={selected} projectPath={source} pageId={selected} editable={editable} />
        </section>
        <Separator label={t("resizeSideColumn")} orientation="vertical" onPointerDown={(event) => dragWidth(event, "right")} />
        <div ref={rightRef} className="flex h-full min-h-0 min-w-0 shrink-0 flex-col" style={{ width: rightWidth }}>
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={{ flex: "none", height: `calc((100% - 1px) * ${rightRatio})` }}>
            <NpcColumn locale={locale} projectPath={source} recordPath={recordPath} selected={selected} editable={editable} />
          </section>
          <Separator label={t("resizeNpcMap")} orientation="horizontal" onPointerDown={(event) => dragSplit(event, "right")} />
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={{ flex: "none", height: `calc((100% - 1px) * ${1 - rightRatio})` }}>
            <MapColumn locale={locale} projectPath={source} selected={selected} editable={editable} />
          </section>
        </div>
      </div>
    </ProjectPath.Provider>
  );
}

function drag(event: ReactPointerEvent<HTMLDivElement>, axis: "x" | "y", apply: (delta: number) => void) {
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
  const end = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
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
  return <div className="flex h-7 shrink-0 items-center border-b border-border bg-card px-2.5 text-xs font-semibold">{children}</div>;
}
