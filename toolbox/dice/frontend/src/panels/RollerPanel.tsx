import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DicesIcon, Loader2Icon } from "lucide-react";
import type { ToolPanelProps } from "@ek/tool-api";
import {
  buildCocThrowNotation,
  describeCocNet,
  loadDiceMode,
  resolveCocCheck,
  saveDiceMode,
  type DicePanelMode,
  type EngineRollResult,
} from "../cocD100";
import { compactDiceExpression, normalizeDiceExpression, withFairForcedResults, type ExprErrorKind } from "../fairRoll";
import { diceT, readDiceLocale, type DiceLocale } from "../i18n";
import { markDiceHeavyLoaded, registerDiceBox, unregisterDiceBox } from "../runtime";

const QUICK = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const;
const COC_BP_MAX = 5;
const ROLL_TIMEOUT_MS = 20_000;
const DEFAULT_EXPR = "2d6+1d20";

/** Major’s fixed logical desk. DOM/canvas can be any size; physics stays 500×300. */
const LOGICAL_WORLD = { x: 500, y: 300 } as const;
const STAGE_BG = "#244d1e";
const RESIZE_DEBOUNCE_MS = 100;

type DiceBoxInstance = {
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  clearDice?: () => void;
  getDiceResults?: () => EngineRollResult;
  setDimensions?: (size: { x: number; y: number }) => void;
  destroy?: () => void;
  rolling?: boolean;
  running?: boolean;
  threadid?: number;
  renderer?: {
    dispose?: () => void;
    forceContextLoss?: () => void;
    domElement?: HTMLElement;
  };
};

/** Vendor DiceBox has no destroy(); release WebGL so remounts (Strict Mode / dockview ghosts) do not exhaust contexts. */
function disposeDiceBox(box: DiceBoxInstance | null | undefined) {
  if (!box) return;
  try {
    box.running = false;
    if (typeof box.threadid === "number") cancelAnimationFrame(box.threadid);
    box.clearDice?.();
    box.renderer?.dispose?.();
    box.renderer?.forceContextLoss?.();
    box.renderer?.domElement?.remove?.();
    box.destroy?.();
  } catch {
    /* ignore */
  }
}

type DiceBoxCtor = new (selector: string, opts?: Record<string, unknown>) => DiceBoxInstance;

type LastResult = { label: string; total: number };

function assetPath() {
  const base = import.meta.env.BASE_URL ?? "/";
  const path = `${base}dice-assets/`.replace(/\/{2,}/g, "/");
  return path.startsWith("http") ? path : path;
}

function installPhysicsTweaks(box: DiceBoxInstance) {
  const anyBox = box as DiceBoxInstance & {
    gravity_multiplier?: number;
    world?: { gravity: { set: (x: number, y: number, z: number) => void } };
  };
  anyBox.gravity_multiplier = 800;
  anyBox.world?.gravity.set(0, 0, -9.8 * 800);
}

function exprErrorMessage(locale: DiceLocale, kind: ExprErrorKind, detail?: string): string {
  switch (kind) {
    case "empty":
    case "noDice":
      return diceT(locale, "noDice");
    case "unsupported":
      return detail ? `${diceT(locale, "unsupportedDie")}: ${detail}` : diceT(locale, "unsupportedDie");
    case "tooMany":
      return diceT(locale, "tooManyDice");
    default:
      return diceT(locale, "invalidExpr");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout();
      reject(new Error("timeout"));
    }, ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function modeSegClass(active: boolean) {
  return [
    "h-11 min-w-[5.75rem] px-5 text-lg font-medium transition-colors",
    active ? "rounded-full bg-[#efe6d6] text-zinc-900 shadow-sm" : "rounded-full text-white/80 hover:text-white",
  ].join(" ");
}

function chipClass() {
  return "h-11 min-w-14 shrink-0 rounded-md border border-white/40 bg-black/55 px-3 font-mono text-base text-[#f2ebe0] hover:bg-black/75 disabled:opacity-40";
}

function primaryBtnClass() {
  return "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#c4784a] text-white shadow-sm hover:bg-[#b56a3f] disabled:opacity-40";
}

function ghostBtnClass() {
  return "h-11 shrink-0 rounded-md border border-white/35 bg-black/55 px-5 text-lg font-medium text-[#f2ebe0] hover:bg-black/75 disabled:opacity-40";
}

function cocNetClass(net: number) {
  if (net > 0) return "text-emerald-300";
  if (net < 0) return "text-orange-300";
  return "text-white/75";
}

function useDiceLocale(): DiceLocale {
  const [locale, setLocale] = useState<DiceLocale>(readDiceLocale);
  useEffect(() => {
    const sync = () => setLocale(readDiceLocale());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => obs.disconnect();
  }, []);
  return locale;
}

export function DiceRollerPanel(_props: ToolPanelProps) {
  const reactId = useId().replace(/:/g, "");
  const stageId = `ek-dice-stage-${reactId}`;
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<DiceBoxInstance | null>(null);
  const busyRef = useRef(false);
  const pendingResizeRef = useRef(false);
  const locale = useDiceLocale();
  const [mode, setMode] = useState<DicePanelMode>(loadDiceMode);
  const [expr, setExpr] = useState(DEFAULT_EXPR);
  /** CoC: >0 bonus dice, <0 penalty dice, 0 none. Never both at once. */
  const [cocBp, setCocBp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  /** CSS :hover may be inert when `(hover: none)` (some VMs / touch); drive HUD opacity from pointer/focus. */
  const [hudHot, setHudHot] = useState(false);

  const net = cocBp;

  useEffect(() => {
    saveDiceMode(mode);
  }, [mode]);

  useEffect(() => {
    busyRef.current = busy;
    if (!busy && pendingResizeRef.current) {
      pendingResizeRef.current = false;
      syncMajorLayout(stageRef.current, boxRef.current);
    }
  }, [busy]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    let sizeWaitRo: ResizeObserver | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let created: DiceBoxInstance | null = null;

    const syncEngine = () => {
      const box = boxRef.current;
      if (!box) return;
      if (busyRef.current || box.rolling) {
        pendingResizeRef.current = true;
        return;
      }
      syncMajorLayout(stage, box);
    };

    const scheduleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncEngine, RESIZE_DEBOUNCE_MS);
    };

    const waitUntilSized = () =>
      new Promise<void>((resolve) => {
        if (stage.clientWidth >= 8 && stage.clientHeight >= 8) {
          resolve();
          return;
        }
        sizeWaitRo = new ResizeObserver(() => {
          if (stage.clientWidth >= 8 && stage.clientHeight >= 8) {
            sizeWaitRo?.disconnect();
            sizeWaitRo = undefined;
            resolve();
          }
        });
        sizeWaitRo.observe(stage);
      });

    (async () => {
      try {
        await waitUntilSized();
        if (cancelled) return;

        const mod = await import("../../vendor/dice-box-threejs/dist/dice-box-threejs.es.js");
        const DiceBox = (mod.default ?? mod) as DiceBoxCtor;
        if (cancelled) return;
        markDiceHeavyLoaded();

        const box = new DiceBox(`#${stageId}`, {
          assetPath: assetPath(),
          sounds: true,
          volume: 80,
          baseScale: 50,
          theme_surface: "green-felt",
          theme_colorset: "white",
          theme_material: "glass",
          theme_texture: "",
          onRollComplete: () => {
            /* result text is set by explicit roll handlers */
          },
        });
        created = box;
        await box.initialize();
        if (cancelled) {
          disposeDiceBox(box);
          return;
        }
        boxRef.current = box;
        registerDiceBox(box);
        installPhysicsTweaks(box);
        setReady(true);
        syncMajorLayout(stage, box);
        if (cancelled) return;
        window.addEventListener("resize", scheduleSync);
        ro = new ResizeObserver(scheduleSync);
        ro.observe(stage);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      sizeWaitRo?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      ro?.disconnect();
      const box = boxRef.current ?? created;
      boxRef.current = null;
      if (box) {
        unregisterDiceBox(box);
        disposeDiceBox(box);
      }
    };
  }, [stageId]);

  const switchMode = (next: DicePanelMode) => {
    if (next === mode || busy) return;
    setMode(next);
    setError(null);
    setLast(null);
    setExpr("");
    setCocBp(0);
    try {
      boxRef.current?.clearDice?.();
    } catch {
      /* ignore */
    }
  };

  const appendDie = (die: string) => {
    if (busy) return;
    setExpr((prev) => compactDiceExpression(prev.trim() ? `${prev.trim()}+${die}` : die));
    setError(null);
  };

  const bumpCocBp = (delta: number) => {
    if (busy) return;
    setCocBp((n) => Math.min(COC_BP_MAX, Math.max(-COC_BP_MAX, n + delta)));
  };

  const rollNormal = async (notation: string) => {
    const box = boxRef.current;
    if (!box || busy) return;
    const text = notation.trim() || DEFAULT_EXPR;
    if (!notation.trim()) setExpr(DEFAULT_EXPR);
    const normalized = normalizeDiceExpression(text);
    if (!normalized.ok) {
      setError(exprErrorMessage(locale, normalized.error, normalized.detail));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fair = withFairForcedResults(normalized.expression);
      const result = (await withTimeout(box.roll(fair), ROLL_TIMEOUT_MS, () => {
        try {
          box.clearDice?.();
        } catch {
          /* ignore */
        }
        box.rolling = false;
      })) as EngineRollResult;
      const full = box.getDiceResults?.() ?? result;
      if (typeof full.total === "number") setLast({ label: normalized.expression, total: full.total });
    } catch (e) {
      setError(e instanceof Error && e.message === "timeout" ? diceT(locale, "rollFailed") : e instanceof Error ? e.message : diceT(locale, "rollFailed"));
    } finally {
      setBusy(false);
    }
  };

  const rollCoc = async () => {
    const box = boxRef.current;
    if (!box || busy) return;
    const throwNotation = withFairForcedResults(buildCocThrowNotation(net));
    setBusy(true);
    setError(null);
    try {
      await withTimeout(box.roll(throwNotation), ROLL_TIMEOUT_MS, () => {
        try {
          box.clearDice?.();
        } catch {
          /* ignore */
        }
        box.rolling = false;
      });
      const full = (box.getDiceResults?.() ?? {}) as EngineRollResult;
      const resolved = resolveCocCheck(full, net, locale);
      setLast({ label: resolved.detail, total: resolved.total });
    } catch (e) {
      setError(e instanceof Error && e.message === "timeout" ? diceT(locale, "rollFailed") : e instanceof Error ? e.message : diceT(locale, "rollFailed"));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (busy) return;
    try {
      boxRef.current?.clearDice?.();
    } catch {
      /* ignore */
    }
    setExpr("");
    setCocBp(0);
    setLast(null);
    setError(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "coc") void rollCoc();
    else void rollNormal(expr);
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ background: STAGE_BG }} data-dice-panel>
      {/* Felt total sits under the transparent WebGL canvas so dice remain on top. */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-4">
        {last ? (
          <div className="select-none text-[clamp(4.5rem,26vmin,11rem)] font-bold tabular-nums leading-none tracking-tight text-[#efe6d6]/45 [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]">
            {last.total}
          </div>
        ) : null}
      </div>

      <div
        ref={stageRef}
        id={stageId}
        className="absolute inset-0 z-[1] overflow-hidden bg-transparent"
        data-dice-stage
      />

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-3">
        <div
          className={[
            "pointer-events-auto mx-auto flex w-full max-w-4xl flex-col items-stretch gap-2.5 rounded-2xl transition-opacity duration-200",
            hudHot ? "opacity-100" : "opacity-[0.16]",
          ].join(" ")}
          onPointerEnter={() => setHudHot(true)}
          onPointerLeave={() => setHudHot(false)}
          onFocusCapture={() => setHudHot(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHudHot(false);
          }}
        >
          <div className="flex justify-center">
            <div className="inline-flex rounded-full border border-white/25 bg-black/55 p-1 shadow-md backdrop-blur-md">
              <button
                type="button"
                className={modeSegClass(mode === "normal")}
                disabled={busy}
                onClick={() => switchMode("normal")}
              >
                {diceT(locale, "modeNormal")}
              </button>
              <button
                type="button"
                className={modeSegClass(mode === "coc")}
                disabled={busy}
                onClick={() => switchMode("coc")}
              >
                {diceT(locale, "modeCoc")}
              </button>
            </div>
          </div>

          <form className="flex w-full flex-col gap-2" onSubmit={onSubmit}>
            {mode === "normal" ? (
              <>
                <input
                  className="h-12 w-full bg-transparent px-2 text-center font-mono text-2xl text-[#f2ebe0] outline-none placeholder:text-white/35"
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  placeholder={diceT(locale, "exprPlaceholder")}
                  aria-label="dice expression"
                />
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {QUICK.map((q) => (
                    <button key={q} type="button" disabled={!ready || busy} className={chipClass()} onClick={() => appendDie(q)}>
                      {q}
                    </button>
                  ))}
                  <button
                    type="submit"
                    disabled={!ready || busy}
                    className={primaryBtnClass()}
                    title={diceT(locale, "roll")}
                    aria-label={diceT(locale, "roll")}
                  >
                    {busy ? <Loader2Icon className="size-5 animate-spin" aria-hidden /> : <DicesIcon className="size-5" aria-hidden />}
                  </button>
                  <button type="button" disabled={!ready || busy} className={ghostBtnClass()} onClick={clear}>
                    {diceT(locale, "clear")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <div className="flex h-11 min-w-[13rem] items-center justify-center gap-1 rounded-md border border-white/25 bg-black/45 px-2 backdrop-blur-md">
                  <button
                    type="button"
                    disabled={!ready || busy || net <= -COC_BP_MAX}
                    className="h-10 w-10 rounded-md text-xl text-[#c4784a] hover:bg-white/10 disabled:opacity-40"
                    title="增加惩罚 / 减少奖励"
                    onClick={() => bumpCocBp(-1)}
                  >
                    −
                  </button>
                  <span className={`min-w-28 text-center text-lg tabular-nums ${cocNetClass(net)}`}>{describeCocNet(net, locale)}</span>
                  <button
                    type="button"
                    disabled={!ready || busy || net >= COC_BP_MAX}
                    className="h-10 w-10 rounded-md text-xl text-[#c4784a] hover:bg-white/10 disabled:opacity-40"
                    title="增加奖励 / 减少惩罚"
                    onClick={() => bumpCocBp(1)}
                  >
                    +
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!ready || busy}
                  className={primaryBtnClass()}
                  title={diceT(locale, "roll")}
                  aria-label={diceT(locale, "roll")}
                >
                  {busy ? <Loader2Icon className="size-5 animate-spin" aria-hidden /> : <DicesIcon className="size-5" aria-hidden />}
                </button>
                <button type="button" disabled={!ready || busy} className={ghostBtnClass()} onClick={clear}>
                  {diceT(locale, "clear")}
                </button>
              </div>
            )}
          </form>

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-950/85 px-3 py-2 text-center text-sm text-red-200">{error}</div>
          )}
        </div>
      </div>

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 -translate-y-1/2 text-center text-sm text-white/70">
          {diceT(locale, "loading")}
        </div>
      )}
    </div>
  );
}

/** Major resize: keep logical 500×300, stretch canvas CSS to fill the desk DOM. */
function syncMajorLayout(stage: HTMLElement | null, box: DiceBoxInstance | null) {
  if (!stage || !box) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (w < 8 || h < 8) return;
  try {
    box.setDimensions?.(LOGICAL_WORLD);
  } catch {
    /* ignore */
  }
  const canvas = stage.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement) {
    canvas.style.display = "block";
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.zIndex = "0";
  }
}
