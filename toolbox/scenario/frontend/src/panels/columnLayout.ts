export type ColumnShares = { left: number; right: number };

export const DEFAULT_COLUMNS: ColumnShares = { left: 0.25, right: 0.25 };
export const MIN_COLUMN = 160;
export const MIN_CENTER = 280;
const SEPARATORS = 2;

export function columnLayoutKey(mode: string | undefined) {
  return `ek.scenario.${mode === "play" ? "play" : "prep"}.columns`;
}

export function readColumnShares(raw: string | null): ColumnShares {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value?.version === 1 && Number.isFinite(value.left) && Number.isFinite(value.right)
      && value.left > 0 && value.right > 0 && value.left + value.right < 1) {
      return { left: value.left, right: value.right };
    }
  } catch {
    // Missing or invalid preferences use the built-in layout.
  }
  return { ...DEFAULT_COLUMNS };
}

/** Fit preferences without changing them: a temporary narrow window must not overwrite the save. */
export function fitColumns(width: number, shares: ColumnShares): ColumnShares {
  const budget = Math.max(0, width - SEPARATORS - MIN_CENTER);
  const floor = Math.min(MIN_COLUMN, budget / 2);
  const left = Math.max(floor, shares.left * width);
  const right = Math.max(floor, shares.right * width);
  if (left + right <= budget) return { left, right };
  const excess = left + right - 2 * floor;
  const scale = excess > 0 ? Math.max(0, budget - 2 * floor) / excess : 0;
  return { left: floor + (left - floor) * scale, right: floor + (right - floor) * scale };
}
