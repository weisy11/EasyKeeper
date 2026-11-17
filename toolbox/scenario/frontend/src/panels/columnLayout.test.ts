import assert from "node:assert/strict";
import test from "node:test";
import { columnLayoutKey, DEFAULT_COLUMNS, fitColumns, readColumnShares } from "./columnLayout.ts";

test("saved ratios round-trip and modes use separate keys", () => {
  const shares = { left: 0.18, right: 0.32 };
  assert.deepEqual(readColumnShares(JSON.stringify({ version: 1, ...shares })), shares);
  assert.notEqual(columnLayoutKey("prep"), columnLayoutKey("play"));
  assert.equal(columnLayoutKey(undefined), columnLayoutKey("prep"));
});

test("missing, malformed and incompatible preferences fall back", () => {
  for (const raw of [null, "{", "null", "{}", '{"version":2,"left":0.2,"right":0.2}',
    '{"version":1,"left":"0.2","right":0.2}', '{"version":1,"left":0,"right":0.2}',
    '{"version":1,"left":0.6,"right":0.5}', '{"version":1,"left":1e999,"right":0.2}']) {
    assert.deepEqual(readColumnShares(raw), DEFAULT_COLUMNS);
  }
});

test("resizing preserves preferences while keeping center readable", () => {
  const shares = { left: 0.4, right: 0.35 };
  assert.deepEqual(fitColumns(1600, shares), { left: 640, right: 560 });
  for (const width of [0, 80, 280, 282, 300, 480, 601, 602, 800, 1200]) {
    const fitted = fitColumns(width, shares);
    const center = width - 2 - fitted.left - fitted.right;
    assert.ok(fitted.left >= 0 && fitted.right >= 0);
    if (width >= 282) assert.ok(center >= 280 - 1e-8);
    if (width >= 602) assert.ok(fitted.left >= 160 && fitted.right >= 160);
  }
  assert.deepEqual(shares, { left: 0.4, right: 0.35 });
  assert.deepEqual(fitColumns(1600, shares), { left: 640, right: 560 });
});

test("minimum side widths and separator space apply during restore", () => {
  assert.deepEqual(fitColumns(1000, { left: 0.01, right: 0.01 }), { left: 160, right: 160 });
  assert.deepEqual(fitColumns(480, DEFAULT_COLUMNS), { left: 99, right: 99 });
});
