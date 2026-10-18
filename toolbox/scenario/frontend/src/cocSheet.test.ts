import assert from "node:assert/strict";
import test from "node:test";
import { damageAndBuild, derive, hitPoints, magicPoints, movement, rollCharacteristics } from "./cocSheet.ts";

test("hit points and magic points round down", () => {
  assert.equal(hitPoints(50, 65), 11);
  assert.equal(hitPoints(11, 10), 2);
  assert.equal(magicPoints(50), 10);
  assert.equal(magicPoints(9), 1);
});

test("damage bonus and build follow the 7e bands", () => {
  assert.deepEqual(damageAndBuild(20, 40), { damage: "-2", build: -2 });
  assert.deepEqual(damageAndBuild(40, 40), { damage: "-1", build: -1 });
  assert.deepEqual(damageAndBuild(50, 60), { damage: "0", build: 0 });
  assert.deepEqual(damageAndBuild(70, 80), { damage: "+1D4", build: 1 });
  assert.deepEqual(damageAndBuild(90, 90), { damage: "+1D6", build: 2 });
  assert.deepEqual(damageAndBuild(110, 110), { damage: "+2D6", build: 3 });
  assert.deepEqual(damageAndBuild(200, 200), { damage: "+4D6", build: 5 });
});

test("movement uses size and age", () => {
  assert.equal(movement(40, 40, 80, null), 7);
  assert.equal(movement(80, 80, 40, null), 9);
  assert.equal(movement(50, 40, 50, null), 8);
  assert.equal(movement(80, 80, 40, 45), 8);
  assert.equal(movement(80, 80, 40, 80), 4);
});

test("characteristic rolls stay inside the 7e dice ranges", () => {
  const low = rollCharacteristics(() => 0);
  assert.deepEqual(low, { str: 15, con: 15, siz: 40, dex: 15, app: 15, int: 40, pow: 15, edu: 40, luck: 15 });
  const high = rollCharacteristics(() => 0.999);
  assert.deepEqual(high, { str: 90, con: 90, siz: 90, dex: 90, app: 90, int: 90, pow: 90, edu: 90, luck: 90 });
});

test("derive combines the eight characteristics", () => {
  const derived = derive({ str: 60, con: 50, siz: 60, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 55 }, 25);
  assert.deepEqual(derived, { hp: 11, mp: 10, san: 50, damage: "0", build: 0, mov: 8 });
});
