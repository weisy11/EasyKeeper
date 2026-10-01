/** Fair dice: crypto-pick faces, then let the engine `@`-force them after physics. */

const DIE_FACES: Record<string, readonly number[]> = {
  d4: [1, 2, 3, 4],
  d6: [1, 2, 3, 4, 5, 6],
  d8: [1, 2, 3, 4, 5, 6, 7, 8],
  d10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  d12: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  d20: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  /** Tens die: 00 is stored as 100 by the engine. */
  d100: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};

export const MAX_DICE_PER_ROLL = 40;

export type ExprErrorKind = "empty" | "noDice" | "invalid" | "unsupported" | "tooMany";

export type NormalizedExpr =
  | { ok: true; expression: string; dice: string[] }
  | { ok: false; error: ExprErrorKind; detail?: string };

/** Uniform integer in `[0, maxExclusive)`. */
export function cryptoUniform(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be > 0");
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let x = 0;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return x % maxExclusive;
}

export function expandDiceTerms(notation: string): string[] {
  const dice: string[] = [];
  const re = /(\d*)(d\d+|d%)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(notation)) !== null) {
    const count = m[1] ? Number.parseInt(m[1], 10) : 1;
    const type = m[2].toLowerCase() === "d%" ? "d100" : m[2].toLowerCase();
    for (let i = 0; i < Math.max(1, count); i++) dice.push(type);
  }
  return dice;
}

const DIE_ORDER = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const;

/** Merge like `d4+d4` → `2d4`; keeps a trailing constant (`2d6+1`). */
export function compactDiceExpression(notation: string): string {
  const text = (notation.split("@")[0] ?? "").replace(/\s+/g, "");
  if (!text) return "";

  const counts = new Map<string, number>();
  const re = /(\d*)(d\d+|d%)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const count = m[1] ? Number.parseInt(m[1], 10) : 1;
    const type = m[2].toLowerCase() === "d%" ? "d100" : m[2].toLowerCase();
    counts.set(type, (counts.get(type) ?? 0) + Math.max(1, count));
  }

  let constant = 0;
  const rest = text.replace(/(\d*)(d\d+|d%)/gi, "");
  const constRe = /([+-]\d+)/g;
  let cm: RegExpExecArray | null;
  while ((cm = constRe.exec(rest)) !== null) {
    constant += Number.parseInt(cm[1], 10);
  }

  const parts: string[] = [];
  for (const type of DIE_ORDER) {
    const n = counts.get(type);
    if (!n) continue;
    parts.push(n === 1 ? type : `${n}${type}`);
    counts.delete(type);
  }
  for (const [type, n] of counts) {
    parts.push(n === 1 ? type : `${n}${type}`);
  }

  let out = parts.join("+");
  if (constant > 0) out += `+${constant}`;
  else if (constant < 0) out += String(constant);
  return out;
}

/**
 * Reject junk the engine would choke on (unknown types, leftover letters, too many dice).
 * Returns a compacted expression safe to send to dice-box-threejs.
 */
export function normalizeDiceExpression(notation: string): NormalizedExpr {
  const raw = (notation.split("@")[0] ?? "").replace(/\s+/g, "");
  if (!raw) return { ok: false, error: "empty" };

  // Only dice terms, optional leading/joining +-, and a trailing integer constant.
  if (!/^([+-]?\d*(d\d+|d%))+([+-]\d+)?$/i.test(raw)) {
    return { ok: false, error: "invalid" };
  }

  const dice = expandDiceTerms(raw);
  if (dice.length === 0) return { ok: false, error: "noDice" };
  if (dice.length > MAX_DICE_PER_ROLL) return { ok: false, error: "tooMany" };

  for (const type of dice) {
    if (!DIE_FACES[type]) return { ok: false, error: "unsupported", detail: type };
  }

  const expression = compactDiceExpression(raw);
  if (!expression) return { ok: false, error: "noDice" };
  return { ok: true, expression, dice: expandDiceTerms(expression) };
}

export function pickFairFace(type: string): number {
  const faces = DIE_FACES[type.toLowerCase()];
  if (!faces?.length) throw new Error(`unsupported die type: ${type}`);
  return faces[cryptoUniform(faces.length)]!;
}

/**
 * Append `@v1,v2,...` so dice-box-threejs swaps faces after the simulated throw.
 * Strips any existing forced list first. Caller must pass a normalized expression.
 */
export function withFairForcedResults(notation: string): string {
  const base = notation.split("@")[0]?.trim() ?? "";
  if (!base) return notation;
  const dice = expandDiceTerms(base);
  if (dice.length === 0) return base;
  const forced = dice.map((t) => pickFairFace(t));
  return `${base}@${forced.join(",")}`;
}
