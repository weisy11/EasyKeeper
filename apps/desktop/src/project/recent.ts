import { createStore } from "@/lib/store";
import { joinPath, pathExists } from "./fs";
import type { ProjectKind, RecentProject } from "./types";

const KEY = "ek.recentProjects";
const MAX_RECENT = 12;
const SCENARIO_MARKER = "scenario.ezkp";
const RECORD_MARKER = "record.ezkp";

export type RecentState = {
  recentRecords: RecentProject[];
  recentScenario: RecentProject[];
};

function emptyState(): RecentState {
  return { recentRecords: [], recentScenario: [] };
}

function asRecent(value: unknown): RecentProject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RecentProject>;
  if (typeof item.path !== "string" || typeof item.name !== "string") return null;
  if (item.kind !== "scenario" && item.kind !== "gameRecord") return null;
  return {
    path: item.path,
    name: item.name,
    kind: item.kind,
    modulePath: typeof item.modulePath === "string" ? item.modulePath : null,
    openedAt: typeof item.openedAt === "number" ? item.openedAt : 0,
  };
}

function listFrom(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecent).filter((item): item is RecentProject => item !== null);
}

/** Old `{ items }` payload. Kept only until the one-time marker check finishes. */
let legacyItems: RecentProject[] | null = null;

function loadInitial(): RecentState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as { items?: unknown; recentRecords?: unknown; recentScenario?: unknown };
    if (Array.isArray(parsed.recentRecords) || Array.isArray(parsed.recentScenario)) {
      return {
        recentRecords: listFrom(parsed.recentRecords),
        recentScenario: listFrom(parsed.recentScenario),
      };
    }
    if (Array.isArray(parsed.items)) {
      legacyItems = listFrom(parsed.items);
    }
  } catch {
    /* ignore corrupt storage */
  }
  return emptyState();
}

export const recentStore = createStore<RecentState>(loadInitial());

const writeState = recentStore.set.bind(recentStore);
recentStore.set = (next) => {
  writeState(next);
  localStorage.setItem(KEY, JSON.stringify(recentStore.get()));
};

function listKey(kind: ProjectKind): keyof RecentState {
  return kind === "scenario" ? "recentScenario" : "recentRecords";
}

function trim(items: RecentProject[]) {
  return items.slice(0, MAX_RECENT);
}

export function rememberProject(project: Omit<RecentProject, "openedAt">) {
  recentStore.set((state) => {
    const key = listKey(project.kind);
    const next: RecentProject = { ...project, openedAt: Date.now() };
    return {
      ...state,
      [key]: trim([next, ...state[key].filter((item) => item.path !== project.path)]),
    };
  });
}

export function forgetProject(kind: ProjectKind, path: string) {
  recentStore.set((state) => {
    const key = listKey(kind);
    return { ...state, [key]: state[key].filter((item) => item.path !== path) };
  });
}

let migrating: Promise<void> | null = null;

/**
 * Split a saved `{ items }` list by the marker files on disk.
 * A folder with both markers is kept as a game record. A folder with neither is dropped.
 */
export function migrateLegacyRecent(): Promise<void> {
  if (!migrating) migrating = migrateLegacyRecentOnce();
  return migrating;
}

async function migrateLegacyRecentOnce() {
  const pending = legacyItems;
  legacyItems = null;
  if (!pending?.length) return;
  const recentRecords: RecentProject[] = [];
  const recentScenario: RecentProject[] = [];
  for (const item of pending) {
    let scenario = false;
    let record = false;
    try {
      scenario = await pathExists(await joinPath(item.path, SCENARIO_MARKER));
      record = await pathExists(await joinPath(item.path, RECORD_MARKER));
    } catch {
      continue;
    }
    if (record) {
      recentRecords.push({
        ...item,
        kind: "gameRecord",
        modulePath: item.kind === "gameRecord" ? item.modulePath : null,
      });
    } else if (scenario) {
      recentScenario.push({ ...item, kind: "scenario", modulePath: null });
    }
  }
  recentStore.set((state) => ({
    recentRecords: trim([...state.recentRecords, ...recentRecords.filter((item) => !state.recentRecords.some((kept) => kept.path === item.path))]),
    recentScenario: trim([...state.recentScenario, ...recentScenario.filter((item) => !state.recentScenario.some((kept) => kept.path === item.path))]),
  }));
}
