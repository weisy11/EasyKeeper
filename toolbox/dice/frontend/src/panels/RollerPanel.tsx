import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ToolPanelProps } from "@ek/tool-api";
import { markDiceHeavyLoaded, registerDiceBox, unregisterDiceBox } from "../runtime";

const QUICK = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const;

/** Major’s logical desk size (5:3). Keeps physics/walls stable while pixels follow the stage. */
const LOGICAL_WORLD = { x: 500, y: 300 } as const;
const STAGE_ASPECT = 4 / 3;
const RESIZE_DEBOUNCE_MS = 100;

type DiceBoxInstance = {
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  clearDice?: () => void;
  setDimensions?: (size: { x: number; y: number }) => void;
  destroy?: () => void;
  rolling?: boolean;
};

/** Vendor API: first arg is a CSS selector string, not an Element. */
type DiceBoxCtor = new (selector: string, opts?: Record<string, unknown>) => DiceBoxInstance;

function assetPath() {
  const base = import.meta.env.BASE_URL ?? "/";
  const path = `${base}dice-assets/`.replace(/\/{2,}/g, "/");
  return path.startsWith("http") ? path : path;
}

function fitLetterbox(outerW: number, outerH: number, aspect: number) {
  if (outerW <= 0 || outerH <= 0) return { w: 0, h: 0 };
  const outerAspect = outerW / outerH;
  if (outerAspect > aspect) {
    const h = outerH;
    return { w: Math.floor(h * aspect), h: Math.floor(h) };
  }
  const w = outerW;
  return { w: Math.floor(w), h: Math.floor(w / aspect) };
}

export function DiceRollerPanel(_props: ToolPanelProps) {
  const reactId = useId().replace(/:/g, "");
  const stageId = `ek-dice-stage-${reactId}`;
  const chromeRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<DiceBoxInstance | null>(null);
  const busyRef = useRef(false);
  const pendingResizeRef = useRef(false);
  const [expr, setExpr] = useState("1d20");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string>("");
  const [stagePx, setStagePx] = useState({ w: 0, h: 0 });

  useEffect(() => {
    busyRef.current = busy;
    if (!busy && pendingResizeRef.current) {
      pendingResizeRef.current = false;
      const el = stageRef.current;
      const box = boxRef.current;
      if (el && box && el.clientWidth >= 8 && el.clientHeight >= 8) {
        try {
          box.setDimensions?.(LOGICAL_WORLD);
        } catch {
          /* ignore */
        }
      }
    }
  }, [busy]);

  useEffect(() => {
    const chrome = chromeRef.current;
    const stage = stageRef.current;
    if (!chrome || !stage) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const layoutStage = () => {
      const { clientWidth: ow, clientHeight: oh } = chrome;
      const { w, h } = fitLetterbox(ow, oh, STAGE_ASPECT);
      stage.style.width = `${w}px`;
      stage.style.height = `${h}px`;
      setStagePx({ w, h });
      return w >= 8 && h >= 8;
    };

    const syncEngine = () => {
      const box = boxRef.current;
      if (!box || !layoutStage()) return;
      if (busyRef.current || box.rolling) {
        pendingResizeRef.current = true;
        return;
      }
      try {
        // Major pattern: fixed logical world; renderer reads stage clientWidth/Height.
        box.setDimensions?.(LOGICAL_WORLD);
      } catch {
        /* ignore */
      }
    };

    const scheduleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncEngine, RESIZE_DEBOUNCE_MS);
    };

    (async () => {
      try {
        layoutStage();
        const mod = await import("../../vendor/dice-box-threejs/dist/dice-box-threejs.es.js");
        const DiceBox = (mod.default ?? mod) as DiceBoxCtor;
        if (cancelled) return;
        markDiceHeavyLoaded();

        const box = new DiceBox(`#${stageId}`, {
          assetPath: assetPath(),
          sounds: true,
          volume: 80,
          theme_surface: "green-felt",
          theme_colorset: "white",
          theme_material: "glass",
          theme_texture: "",
          onRollComplete: (results: { total?: number; notation?: string }) => {
            setLast(
              typeof results?.total === "number"
                ? `${results.notation ?? ""} → ${results.total}`
                : JSON.stringify(results),
            );
          },
        });
        await box.initialize();
        if (cancelled) {
          box.clearDice?.();
          box.destroy?.();
          return;
        }
        boxRef.current = box;
        registerDiceBox(box);
        setReady(true);
        syncEngine();
        if (cancelled) return;
        // Re-assert Major logical world after vendor's window.resize handler
        // (which otherwise sets logical size = clientWidth/Height).
        window.addEventListener("resize", scheduleSync);
        ro = new ResizeObserver(scheduleSync);
        ro.observe(chrome);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("resize", scheduleSync);
      ro?.disconnect();
      const box = boxRef.current;
      boxRef.current = null;
      if (box) {
        unregisterDiceBox(box);
        try {
          box.clearDice?.();
          box.destroy?.();
        } catch {
          /* ignore */
        }
      }
    };
  }, [stageId]);

  const roll = async (notation: string) => {
    const text = notation.trim();
    if (!text || !boxRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await boxRef.current.roll(text);
      if (result && typeof result === "object" && result !== null && "total" in result) {
        const r = result as { total: number; notation?: string };
        setLast(`${r.notation ?? text} → ${r.total}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void roll(expr);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <form className="flex flex-wrap items-center gap-2 border-b border-border p-2" onSubmit={onSubmit}>
        <input
          className="h-8 min-w-[8rem] flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="2d6+1"
          aria-label="dice expression"
        />
        <button
          type="submit"
          disabled={!ready || busy}
          className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Roll"}
        </button>
        <div className="flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={!ready || busy}
              className="h-7 rounded border border-border px-2 text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => {
                setExpr(q);
                void roll(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </form>
      {error && <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</div>}
      {last && <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{last}</div>}
      <div
        ref={chromeRef}
        className="relative flex min-h-0 flex-1 items-center justify-center"
        style={{ background: "#2a3d2e" }}
        data-dice-chrome
      >
        <div
          ref={stageRef}
          id={stageId}
          className="relative overflow-hidden bg-black/50"
          data-dice-stage
        />
        <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/85 tabular-nums">
          {stagePx.w}×{stagePx.h} · world {LOGICAL_WORLD.x}×{LOGICAL_WORLD.y} · 4:3
        </div>
      </div>
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-xs text-muted-foreground">Loading 3D dice…</div>
      )}
    </div>
  );
}
