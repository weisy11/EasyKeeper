import assert from "node:assert/strict";
import test from "node:test";
import { investigatorDerived } from "./derived.ts";

const base = { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50, age: "" };

test("calculation uses NPC rules, including age-adjusted movement", () => {
  const person = { ...base, str: 80, dex: 80, siz: 60, con: 55, pow: 65, age: "45" };
  assert.deepEqual(investigatorDerived(person), { hp: 11, mp: 13, san: 65, damage: "+1D4", build: 1, mov: 8 });
});

test("applying the calculated patch preserves historical and custom values", () => {
  const person = { ...base, name: "Lin An", luck: 53, sanStart: 70, dodge: 75,
    skills: [{ name: "Spot Hidden", value: 60 }], hp: 3, mp: 2, san: 30,
    str: 50, dex: 60, siz: 50, con: 60, pow: 65 };
  const before = structuredClone(person);
  const next = { ...person, ...investigatorDerived(person) };
  assert.deepEqual(person, before);
  assert.equal(next.hp, 11);
  assert.equal(next.mp, 13);
  assert.equal(next.san, 65);
  assert.equal(next.luck, 53);
  assert.equal(next.sanStart, 70);
  assert.equal(next.dodge, 75);
  assert.deepEqual(next.skills, before.skills);
  assert.equal(next.name, "Lin An");
});

test("unknown age does not introduce a spurious age penalty", () => {
  const person = { ...base, str: 80, dex: 80, siz: 60 };
  for (const age of ["", "unknown", "Infinity"]) assert.equal(investigatorDerived({ ...person, age }).mov, 9);
});
