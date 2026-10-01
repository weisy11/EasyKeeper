/** CoC 7e percentile check: 1d100 + optional bonus/penalty tens dice. */

const MODE_KEY = "ek.dice.mode";

export type DicePanelMode = "normal" | "coc";

export function loadDiceMode(): DicePanelMode {
  try {
    return localStorage.getItem(MODE_KEY) === "coc" ? "coc" : "normal";
  } catch {
    return "normal";
  }
}

export function saveDiceMode(mode: DicePanelMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Tens face: 00→0, 10→10…90→90 (engine may report 00 as 0 or 100). */
export function cocTens(value: number): number {
  if (value === 100 || value === 0) return 0;
  return value;
}

/** Units face: 0–9; some tables use 10 for the 0 pip. */
export function cocUnits(value: number): number {
  if (value === 10) return 0;
  return value;
}

/** CoC read: 00+0 = 100, otherwise tens+units. */
export function cocPercentile(tensValue: number, unitsValue: number): number {
  const n = cocTens(tensValue) + cocUnits(unitsValue);
  return n === 0 ? 100 : n;
}

/** Positive → net bonus dice; negative → net penalty; 0 → plain 1d100. */
export function netBonusPenalty(bonus: number, penalty: number): number {
  return Math.max(0, bonus) - Math.max(0, penalty);
}

/** Build throw notation: (1+|net|)×d100 + d10. */
export function buildCocThrowNotation(net: number): string {
  const tensCount = 1 + Math.abs(net);
  const tens = Array.from({ length: tensCount }, () => "d100").join("+");
  return `${tens}+d10`;
}

export function describeCocNet(net: number, locale: "zh" | "en" = "zh"): string {
  if (net > 0) return locale === "zh" ? `奖励×${net}` : `Bonus ×${net}`;
  if (net < 0) return locale === "zh" ? `惩罚×${Math.abs(net)}` : `Penalty ×${Math.abs(net)}`;
  return locale === "zh" ? "无奖惩" : "No bonus/penalty";
}

export type EngineDieRoll = {
  type?: string;
  value?: number;
  sides?: number;
};

export type EngineRollResult = {
  notation?: string;
  total?: number;
  modifier?: number;
  sets?: Array<{
    type?: string;
    total?: number;
    rolls?: EngineDieRoll[];
  }>;
};

function flattenRolls(result: EngineRollResult): EngineDieRoll[] {
  const out: EngineDieRoll[] = [];
  for (const set of result.sets ?? []) {
    for (const roll of set.rolls ?? []) out.push({ ...roll, type: roll.type ?? set.type });
  }
  return out;
}

export type CocCheckResolved = {
  total: number;
  tensUsed: number;
  tensAll: number[];
  units: number;
  net: number;
  summary: string;
  /** Bottom-bar detail (no leading 1d100 → total). */
  detail: string;
};

/** Resolve engine faces with CoC bonus/penalty: pair each tens die with the units die, then pick best/worst final. */
export function resolveCocCheck(result: EngineRollResult, net: number, locale: "zh" | "en" = "zh"): CocCheckResolved {
  const rolls = flattenRolls(result);
  const tensFaces = rolls
    .filter((r) => (r.type ?? "").toLowerCase() === "d100")
    .map((r) => (typeof r.value === "number" ? r.value : 0));
  const unitsRoll = rolls.find((r) => (r.type ?? "").toLowerCase() === "d10");
  const unitsRaw = typeof unitsRoll?.value === "number" ? unitsRoll.value : 0;
  const units = cocUnits(unitsRaw);

  const candidates = (tensFaces.length ? tensFaces : [0]).map((raw) => {
    const tensDigit = cocTens(raw);
    const total = cocPercentile(raw, unitsRaw);
    return { raw, tensDigit, total };
  });

  let chosen = candidates[0]!;
  if (net > 0) {
    chosen = candidates.reduce((a, b) => (b.total < a.total ? b : a));
  } else if (net < 0) {
    chosen = candidates.reduce((a, b) => (b.total > a.total ? b : a));
  }

  const totalsLabel = candidates.map((c) => String(c.total)).join("/");
  const pick =
    net > 0
      ? locale === "zh"
        ? `取最好 ${chosen.total}`
        : `Best ${chosen.total}`
      : net < 0
        ? locale === "zh"
          ? `取最差 ${chosen.total}`
          : `Worst ${chosen.total}`
        : null;
  const combo = locale === "zh" ? `组合[${totalsLabel}]` : `Combo [${totalsLabel}]`;
  const detail = [net !== 0 ? describeCocNet(net, locale) : null, combo, pick].filter(Boolean).join(" · ");
  const summary = [`1d100 → ${chosen.total}`, detail].filter(Boolean).join(" · ");

  return {
    total: chosen.total,
    tensUsed: chosen.tensDigit,
    tensAll: tensFaces.map(cocTens),
    units,
    net,
    summary,
    detail,
  };
}
