import assert from "node:assert/strict";
import test from "node:test";
import { compactDiceExpression, normalizeDiceExpression, totalDiceResult, withFairForcedResults } from "./fairRoll.ts";
import { DiceNotation } from "../vendor/dice-box-threejs/src/DiceNotation.js";

test("the actual engine preserves our group order and the forced result count", () => {
  for (const input of ["d6-d4", "-d6", "d6-d6+2", "d4+d4-d4+d100-7", "d6+d20+1"]) {
    const expression = normalizeDiceExpression(input);
    assert.ok(expression.ok);
    const engine = new DiceNotation(withFairForcedResults(expression.expression));
    assert.equal(engine.error, false);
    assert.deepEqual(engine.set.map((set) => ({ type: set.type, count: set.num, sign: set.op === "-" ? -1 : 1 })), expression.groups);
    assert.equal(engine.result.length, expression.dice.length);
  }
});

test("subtraction preserves independent dice and uses signed totals, including a leading minus", () => {
  for (const [input, totals, expected] of [
    ["1d6-1d4", [3, 5], 2], // normalized order is -d4+d6
    ["-1d6", [4], -4],
    ["d6-d6+2", [5, 2], 5],
    ["2d6+1", [7], 8],
    ["d20-2", [12], 10],
  ] as const) {
    const expression = normalizeDiceExpression(input);
    assert.ok(expression.ok, input);
    const result = { sets: expression.groups.map((group, index) => ({ type: group.type, total: totals[index] })) };
    assert.equal(totalDiceResult(expression, result), expected, input);
    assert.equal(expression.dice.length, expression.groups.reduce((sum, group) => sum + group.count, 0));
  }
});

test("unsafe counts and malformed expressions are rejected before dice expansion", () => {
  for (const input of ["0d6", "d6d4", "d6++d4", "d6+-1", "d6@6", "d6+1+2", "d6*2", "d6+9007199254740991", "d6".repeat(10000)]) {
    assert.equal(normalizeDiceExpression(input).ok, false, input.slice(0, 40));
  }
  for (const input of ["41d6", "20d6+21d4", "1000000000d6", `${"9".repeat(400)}d6`]) {
    assert.deepEqual(normalizeDiceExpression(input), { ok: false, error: "tooMany" });
  }
  assert.ok(normalizeDiceExpression("40d6").ok);
  assert.deepEqual(normalizeDiceExpression("d7"), { ok: false, error: "unsupported", detail: "d7" });
});

test("quick dice compaction never repairs invalid input or cancels opposite random rolls", () => {
  assert.equal(compactDiceExpression("d6+d6+1"), "2d6+1");
  assert.equal(compactDiceExpression("d6-d6"), "d6-d6");
  assert.equal(compactDiceExpression("0d6+d6"), "0d6+d6");
  const expression = normalizeDiceExpression(" 2D6 + d% - 3 ");
  assert.ok(expression.ok);
  assert.equal(expression.expression, "2d6+d100-3");
  const forced = withFairForcedResults(expression.expression).split("@")[1].split(",").map(Number);
  assert.equal(forced.length, 3);
  assert.ok(forced[0] >= 1 && forced[0] <= 6);
  assert.ok(forced[1] >= 1 && forced[1] <= 6);
  assert.ok(forced[2] >= 10 && forced[2] <= 100 && forced[2] % 10 === 0);
});
