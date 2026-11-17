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

export type DiceGroup = { type: string; count: number; sign: 1 | -1 };
export type ValidExpr = { ok: true; expression: string; dice: string[]; groups: DiceGroup[]; modifier: number };

export type NormalizedExpr =
  | ValidExpr
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

const DIE_ORDER = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"] as const;
const MAX_EXPRESSION_LENGTH = 1024;

/** Validate counts before allocating dice; each signed group represents separate random rolls. */
export function normalizeDiceExpression(notation: string): NormalizedExpr {
  if (notation.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: "invalid" };
  const raw = notation.replace(/\s+/g, "").toLowerCase();
  if (!raw) return { ok: false, error: "empty" };
  const terms: DiceGroup[] = [];
  let offset = 0;
  let countTotal = 0;
  let modifier = 0;
  while (offset < raw.length) {
    const match = /^([+-]?)(\d*)(d(?:\d+|%))/.exec(raw.slice(offset));
    if (!match || (offset > 0 && !match[1])) return { ok: false, error: "invalid" };
    const count = match[2] ? Number(match[2]) : 1;
    const type = match[3] === "d%" ? "d100" : match[3];
    if (!Number.isFinite(count) || count > MAX_DICE_PER_ROLL) return { ok: false, error: "tooMany" };
    if (!Number.isSafeInteger(count) || count <= 0) return { ok: false, error: "invalid" };
    if (!DIE_FACES[type]) return { ok: false, error: "unsupported", detail: type };
    countTotal += count;
    if (countTotal > MAX_DICE_PER_ROLL) return { ok: false, error: "tooMany" };
    terms.push({ type, count, sign: match[1] === "-" ? -1 : 1 });
    offset += match[0].length;
    const rest = raw.slice(offset);
    if (/^[+-]\d+$/.test(rest)) {
      modifier = Number(rest);
      // Leave enough headroom for all supported dice so the displayed result stays exact.
      if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > Number.MAX_SAFE_INTEGER - MAX_DICE_PER_ROLL * 100) {
        return { ok: false, error: "invalid" };
      }
      offset = raw.length;
    }
  }
  if (!terms.length) return { ok: false, error: "noDice" };
  const groups: DiceGroup[] = [];
  for (const type of DIE_ORDER) {
    for (const sign of [1, -1] as const) {
      const count = terms.filter((term) => term.type === type && term.sign === sign)
        .reduce((sum, term) => sum + term.count, 0);
      if (count) groups.push({ type, count, sign });
    }
  }
  const expression = groups.map((group, i) =>
    `${group.sign < 0 ? "-" : i ? "+" : ""}${group.count === 1 ? "" : group.count}${group.type}`,
  ).join("") + (modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : "");
  const dice = groups.flatMap((group) => Array<string>(group.count).fill(group.type));
  return { ok: true, expression, dice, groups, modifier };
}

export function expandDiceTerms(notation: string): string[] {
  const normalized = normalizeDiceExpression(notation.split("@")[0] ?? "");
  return normalized.ok ? normalized.dice : [];
}

/** Invalid input must remain visible instead of being silently repaired by the quick-die buttons. */
export function compactDiceExpression(notation: string): string {
  const normalized = normalizeDiceExpression(notation);
  return normalized.ok ? normalized.expression : notation;
}

/** The vendor adds every set, ignoring its operator. Apply our validated signs to the actual rolls. */
export function totalDiceResult(expression: ValidExpr, result: { sets?: { type?: string; total?: number }[] }): number {
  if (result.sets?.length !== expression.groups.length) throw new Error("Invalid dice result");
  return expression.groups.reduce((total, group, index) => {
    const set = result.sets![index];
    if (set.type !== group.type || !Number.isFinite(set.total)) throw new Error("Invalid dice result");
    return total + group.sign * set.total!;
  }, expression.modifier);
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
