import assert from "node:assert/strict";
import test from "node:test";
import { presentSceneIds, sceneLinkRows } from "./sceneLinks.ts";
import type { ScenarioTreeNode } from "./db.ts";

const tree: ScenarioTreeNode[] = [
  {
    id: "s1",
    kind: "scene",
    title: "场景 1",
    children: [
      { id: "e1", kind: "event", title: "事件 1", children: [] },
      { id: "e2", kind: "event", title: "事件 2", children: [] },
    ],
  },
  { id: "s2", kind: "scene", title: "场景 2", children: [] },
];

test("lists scenes and events flat, without implying a parent link", () => {
  const rows = sceneLinkRows(tree, [], new Set(["e1", "e2"]));
  assert.deepEqual(
    rows.map((row) => row.title),
    ["场景 1", "事件 1", "事件 2", "场景 2"],
  );
  assert.equal(rows.every((row) => !row.trashed), true);
  assert.equal(rows.some((row) => row.id === "s1"), true);
});

test("keeps a trashed link gray and omits trash that was never linked", () => {
  const trash: ScenarioTreeNode[] = [
    { id: "e1", kind: "event", title: "事件 1", children: [] },
    { id: "e3", kind: "event", title: "事件 3", children: [] },
  ];
  const live: ScenarioTreeNode[] = [
    {
      id: "s1",
      kind: "scene",
      title: "场景 1",
      children: [{ id: "e2", kind: "event", title: "事件 2", children: [] }],
    },
  ];
  const rows = sceneLinkRows(live, trash, new Set(["e1", "s1"]));
  assert.deepEqual(
    rows.map((row) => [row.id, row.trashed]),
    [
      ["s1", false],
      ["e2", false],
      ["e1", true],
    ],
  );
});

test("drops a link whose scene was permanently deleted", () => {
  const rows = sceneLinkRows(tree, [], new Set(["e1", "gone"]));
  assert.equal(rows.some((row) => row.id === "gone"), false);
  const present = presentSceneIds(tree, []);
  assert.deepEqual(
    ["e1", "gone"].filter((id) => present.has(id)),
    ["e1"],
  );
});
