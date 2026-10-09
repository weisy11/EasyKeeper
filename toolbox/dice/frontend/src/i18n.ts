/** Dice tool UI strings (zh/en). Locale follows host `document.documentElement.lang`. */

export type DiceLocale = "zh" | "en";

const strings = {
  modeNormal: { zh: "普通", en: "Normal" },
  modeCoc: { zh: "CoC 1d100", en: "CoC 1d100" },
  roll: { zh: "掷骰子", en: "Roll" },
  clear: { zh: "清空", en: "Clear" },
  exprPlaceholder: { zh: "2d6+1d20", en: "2d6+1d20" },
  loading: { zh: "正在加载 3D 骰子…", en: "Loading 3D dice…" },
  rolling: { zh: "掷骰中…", en: "Rolling…" },
  noDice: { zh: "表达式里没有可掷的骰子", en: "No rollable dice in the expression" },
  invalidExpr: { zh: "表达式不合法", en: "Invalid dice expression" },
  unsupportedDie: { zh: "不支持的骰子类型", en: "Unsupported die type" },
  tooManyDice: { zh: "一次最多掷 40 颗骰子", en: "At most 40 dice per roll" },
  rollFailed: { zh: "掷骰失败", en: "Roll failed" },
  bpNone: { zh: "无奖惩", en: "No bonus/penalty" },
  bpBonus: { zh: "奖励×{n}", en: "Bonus ×{n}" },
  bpPenalty: { zh: "惩罚×{n}", en: "Penalty ×{n}" },
  bpDecTitle: { zh: "增加惩罚 / 减少奖励", en: "Add penalty / remove bonus" },
  bpIncTitle: { zh: "增加奖励 / 减少惩罚", en: "Add bonus / remove penalty" },
  pickBest: { zh: "取最好 {n}", en: "Best {n}" },
  pickWorst: { zh: "取最差 {n}", en: "Worst {n}" },
  combo: { zh: "组合[{list}]", en: "Combo [{list}]" },
} as const;

export type DiceStringKey = keyof typeof strings;

export function readDiceLocale(): DiceLocale {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "zh";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function diceT(locale: DiceLocale, key: DiceStringKey, vars?: Record<string, string | number>): string {
  let s: string = strings[key][locale] ?? strings[key].zh;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
