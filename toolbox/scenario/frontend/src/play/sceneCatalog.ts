import type { ScenarioTreeNode } from "../db";

export type { SceneLinkRow } from "../sceneLinks";
export { presentSceneIds, sceneLinkRows } from "../sceneLinks";

export type SceneCatalog = {
  nodes: ScenarioTreeNode[];
  trash: ScenarioTreeNode[];
  ready: boolean;
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
