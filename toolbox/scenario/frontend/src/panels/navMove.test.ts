import assert from "node:assert/strict";
import test from "node:test";
import { appendBlockToTrash, moveBlock, siblingRange, type MoveNode } from "./navMove.ts";

const TRASH = "trash";

function n(id: string, children: MoveNode[] = []): MoveNode {
  return { id, children };
}

function ids(nodes: MoveNode[]) {
  return nodes.map((node) => node.id);
}

const tree = [
  n("scene1", [n("a"), n("b"), n("c")]),
  n("scene2", [n("d")]),
  n("scene3"),
];

test("shift on siblings stays on that level", () => {
  assert.deepEqual(siblingRange(tree, [], "b", "c", TRASH), ["b", "c"]);
  assert.deepEqual(siblingRange(tree, [], "c", "a", TRASH), ["a", "b", "c"]);
});

test("shift across levels promotes to the shared sibling range", () => {
  assert.deepEqual(siblingRange(tree, [], "b", "scene2", TRASH), ["scene1", "scene2"]);
  assert.deepEqual(siblingRange(tree, [], "scene3", "b", TRASH), ["scene1", "scene2", "scene3"]);
  assert.deepEqual(siblingRange(tree, [], "b", "d", TRASH), ["scene1", "scene2"]);
  assert.deepEqual(siblingRange(tree, [], "c", "scene1", TRASH), ["scene1"]);
});

test("moving a block keeps list order when dropped after a later sibling", () => {
  const nodes = [n("A"), n("B"), n("C"), n("D"), n("E")];
  const moved = moveBlock(nodes, [], ["C", "B"], "E", "after", TRASH);
  assert.deepEqual(ids(moved!.nodes), ["A", "D", "E", "B", "C"]);
});

test("moving a block before an earlier sibling keeps list order", () => {
  const nodes = [n("A"), n("B"), n("C"), n("D"), n("E")];
  const moved = moveBlock(nodes, [], ["E", "D"], "B", "before", TRASH);
  assert.deepEqual(ids(moved!.nodes), ["A", "D", "E", "B", "C"]);
});

test("dropping a block on its own edge does not reshuffle it", () => {
  const nodes = [n("A"), n("B"), n("C"), n("D"), n("E")];
  const afterPrev = moveBlock(nodes, [], ["B", "C"], "A", "after", TRASH);
  const beforeNext = moveBlock(nodes, [], ["B", "C"], "D", "before", TRASH);
  assert.deepEqual(ids(afterPrev!.nodes), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(ids(beforeNext!.nodes), ["A", "B", "C", "D", "E"]);
});

test("dropping inside appends the block in list order", () => {
  const nodes = [n("A", [n("B"), n("C")]), n("D", [n("x")])];
  const moved = moveBlock(nodes, [], ["C", "B"], "D", "inside", TRASH);
  assert.deepEqual(ids(moved!.nodes), ["A", "D"]);
  assert.deepEqual(ids(moved!.nodes[0].children), []);
  assert.deepEqual(ids(moved!.nodes[1].children), ["x", "B", "C"]);
});

test("a block cannot be dropped onto itself or its descendant", () => {
  const nodes = [n("A", [n("B"), n("C")])];
  assert.equal(moveBlock(nodes, [], ["A"], "B", "before", TRASH), null);
  assert.equal(moveBlock(nodes, [], ["B", "C"], "B", "after", TRASH), null);
});

test("trash append keeps sibling order after existing trash", () => {
  const nodes = [n("scene1", [n("a"), n("b"), n("c")]), n("scene2")];
  const moved = appendBlockToTrash(nodes, [n("old")], ["c", "a"], TRASH);
  assert.deepEqual(ids(moved!.nodes), ["scene1", "scene2"]);
  assert.deepEqual(ids(moved!.nodes[0].children), ["b"]);
  assert.deepEqual(ids(moved!.trash), ["old", "a", "c"]);
});

test("dragging a trash block back out keeps order", () => {
  const trash = [n("a"), n("b"), n("c")];
  const moved = moveBlock([n("scene2")], trash, ["c", "a"], "scene2", "before", TRASH);
  assert.deepEqual(ids(moved!.nodes), ["a", "c", "scene2"]);
  assert.deepEqual(ids(moved!.trash), ["b"]);
});
