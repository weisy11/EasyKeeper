export type MoveNode = {
  id: string;
  children: MoveNode[];
};

export type Place = "before" | "after" | "inside";

type Spot = {
  area: "main" | "trash";
  parentId: string | null;
  siblings: MoveNode[];
  index: number;
};

function findSpot(nodes: MoveNode[], id: string, parent: MoveNode | null = null): { parent: MoveNode | null; siblings: MoveNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === id) return { parent, siblings: nodes, index };
    const nested = findSpot(nodes[index].children, id, nodes[index]);
    if (nested) return nested;
  }
  return null;
}

function forestSpot(nodes: MoveNode[], trash: MoveNode[], id: string, trashParent: string): Spot | null {
  const main = findSpot(nodes, id);
  if (main) return { area: "main", parentId: main.parent?.id ?? null, siblings: main.siblings, index: main.index };
  const bin = findSpot(trash, id);
  if (!bin) return null;
  return { area: "trash", parentId: bin.parent?.id ?? trashParent, siblings: bin.siblings, index: bin.index };
}

function contains(node: MoveNode, id: string): boolean {
  return node.id === id || node.children.some((child) => contains(child, id));
}

function lineage(nodes: MoveNode[], trash: MoveNode[], id: string, trashParent: string) {
  const line: { id: string; parentId: string | null }[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const spot = forestSpot(nodes, trash, current, trashParent);
    if (!spot) break;
    line.push({ id: current, parentId: spot.parentId });
    if (spot.parentId === null || spot.parentId === trashParent) break;
    current = spot.parentId;
  }
  return line;
}

/** Sibling ids between two clicks, in list order. Endpoints that are not siblings walk up until they are. */
export function siblingRange(nodes: MoveNode[], trash: MoveNode[], anchorId: string, targetId: string, trashParent: string): string[] | null {
  const anchor = forestSpot(nodes, trash, anchorId, trashParent);
  const target = forestSpot(nodes, trash, targetId, trashParent);
  if (!anchor || !target || anchor.area !== target.area) return null;
  const chainA = lineage(nodes, trash, anchorId, trashParent);
  const chainB = lineage(nodes, trash, targetId, trashParent);
  let indexA = Math.max(0, chainA.length - chainB.length);
  let indexB = Math.max(0, chainB.length - chainA.length);
  while (indexA < chainA.length && indexB < chainB.length) {
    if (chainA[indexA].parentId === chainB[indexB].parentId) {
      const spot = forestSpot(nodes, trash, chainA[indexA].id, trashParent);
      if (!spot) return null;
      const start = spot.siblings.findIndex((node) => node.id === chainA[indexA].id);
      const end = spot.siblings.findIndex((node) => node.id === chainB[indexB].id);
      if (start < 0 || end < 0) return null;
      const [from, to] = start < end ? [start, end] : [end, start];
      return spot.siblings.slice(from, to + 1).map((node) => node.id);
    }
    indexA += 1;
    indexB += 1;
  }
  return null;
}

function orderedGroup(nodes: MoveNode[], trash: MoveNode[], ids: string[], trashParent: string) {
  const spots = ids.map((id) => forestSpot(nodes, trash, id, trashParent));
  if (spots.some((spot) => !spot)) return null;
  const first = spots[0];
  if (!first) return null;
  if (spots.some((spot) => spot!.area !== first.area || spot!.parentId !== first.parentId)) return null;
  const wanted = new Set(ids);
  return { parentId: first.parentId, moving: first.siblings.filter((node) => wanted.has(node.id)) };
}

function removeIds<T extends MoveNode>(nodes: T[], ids: Set<string>): { nodes: T[]; removed: Map<string, T> } {
  const removed = new Map<string, T>();
  const walk = (list: T[]): T[] => {
    const next: T[] = [];
    for (const item of list) {
      if (ids.has(item.id)) {
        removed.set(item.id, item);
        continue;
      }
      const children = walk(item.children as T[]);
      next.push(children === item.children ? item : { ...item, children });
    }
    return next;
  };
  return { nodes: walk(nodes), removed };
}

function insertBlock<T extends MoveNode>(nodes: T[], targetId: string, place: Place, block: T[]): { nodes: T[]; found: boolean } {
  let found = false;
  const next: T[] = [];
  for (const item of nodes) {
    if (item.id === targetId) {
      found = true;
      if (place === "before") next.push(...block);
      if (place === "inside") next.push({ ...item, children: [...item.children, ...block] });
      else next.push(item);
      if (place === "after") next.push(...block);
      continue;
    }
    const nested = insertBlock(item.children as T[], targetId, place, block);
    if (nested.found) {
      found = true;
      next.push({ ...item, children: nested.nodes });
    } else {
      next.push(item);
    }
  }
  return { nodes: next, found };
}

/**
 * Move sibling nodes as one block. `ids` may be in any order; the result keeps their current list order.
 * Inserting after the target is one splice, so the block is not reversed.
 */
export function moveBlock<T extends MoveNode>(nodes: T[], trash: T[], ids: string[], targetId: string, place: Place, trashParent: string): { nodes: T[]; trash: T[] } | null {
  if (ids.length === 0 || ids.includes(targetId)) return null;
  const group = orderedGroup(nodes, trash, ids, trashParent);
  if (!group || group.moving.some((node) => contains(node, targetId))) return null;
  const idSet = new Set(group.moving.map((node) => node.id));
  const main = removeIds(nodes, idSet);
  const bin = removeIds(trash, idSet);
  const block = group.moving.map((node) => main.removed.get(node.id) ?? bin.removed.get(node.id)).filter((node): node is T => !!node);
  if (block.length !== group.moving.length) return null;
  const intoMain = insertBlock(main.nodes, targetId, place, block);
  if (intoMain.found) return { nodes: intoMain.nodes, trash: bin.nodes };
  const intoTrash = insertBlock(bin.nodes, targetId, place, block);
  if (intoTrash.found) return { nodes: main.nodes, trash: intoTrash.nodes };
  return null;
}

/** Append siblings to the end of the trash, keeping their current order. */
export function appendBlockToTrash<T extends MoveNode>(nodes: T[], trash: T[], ids: string[], trashParent: string): { nodes: T[]; trash: T[] } | null {
  const group = orderedGroup(nodes, trash, ids, trashParent);
  if (!group || group.moving.length === 0) return null;
  if (group.moving.some((node) => forestSpot(nodes, trash, node.id, trashParent)?.area !== "main")) return null;
  const idSet = new Set(group.moving.map((node) => node.id));
  const main = removeIds(nodes, idSet);
  const block = group.moving.map((node) => main.removed.get(node.id)).filter((node): node is T => !!node);
  if (block.length !== group.moving.length) return null;
  return { nodes: main.nodes, trash: [...trash, ...block] };
}
