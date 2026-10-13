import type { ScenarioTreeNode } from "./db";

export type SceneCatalog = {
  nodes: ScenarioTreeNode[];
  trash: ScenarioTreeNode[];
  ready: boolean;
};

export type SceneLinkRow = {
  id: string;
  title: string;
  trashed: boolean;
};

const EMPTY: SceneCatalog = { nodes: [], trash: [], ready: false };

let current: SceneCatalog = EMPTY;
const listeners = new Set<(catalog: SceneCatalog) => void>();

export function readSceneCatalog(): SceneCatalog {
  return current;
}

export function publishSceneCatalog(catalog: SceneCatalog) {
  current = catalog;
  for (const listener of listeners) listener(current);
}

export function subscribeSceneCatalog(listener: (catalog: SceneCatalog) => void) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function presentSceneIds(nodes: ScenarioTreeNode[], trash: ScenarioTreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: ScenarioTreeNode[]) {
    for (const node of list) {
      ids.add(node.id);
      walk(node.children);
    }
  }
  walk(nodes);
  walk(trash);
  return ids;
}

/** Live scenes and events in tree order, then linked items that are currently in the trash. */
export function sceneLinkRows(nodes: ScenarioTreeNode[], trash: ScenarioTreeNode[], linkedIds: ReadonlySet<string>): SceneLinkRow[] {
  const rows: SceneLinkRow[] = [];
  function walk(list: ScenarioTreeNode[], trashed: boolean) {
    for (const node of list) {
      if (!trashed || linkedIds.has(node.id)) rows.push({ id: node.id, title: node.title, trashed });
      walk(node.children, trashed);
    }
  }
  walk(nodes, false);
  walk(trash, true);
  return rows;
}
