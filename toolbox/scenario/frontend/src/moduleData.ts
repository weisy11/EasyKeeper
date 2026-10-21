import type {
  ActorListItem,
  ActorRecord,
  ArticleListItem,
  ArticleRecord,
  CurrentScene,
  ModuleDataSource,
  ModuleRecord,
  ModuleRecordKind,
  SceneListNode,
  SceneRecord,
} from "@ek/tool-api";
import { listActorPositions, listChildNodes, loadScenarioActors, loadScenarioArticles, loadScenarioNode } from "./db";
import { readPage } from "./storage";

const EMPTY_BODY = { type: "doc", content: [{ type: "paragraph" }] };
const openScene = new Map<string, string>();

function moduleKey(moduleDir: string) {
  return moduleDir.trim().replace(/[\\/]+$/, "");
}

/** The scenario panel reports the node open in the editor. An empty id clears it. */
export function publishCurrentScene(moduleDir: string, id: string) {
  const key = moduleKey(moduleDir);
  if (!key) return;
  if (!id) openScene.delete(key);
  else openScene.set(key, id);
}

export function clearCurrentScene(moduleDir: string) {
  openScene.delete(moduleKey(moduleDir));
}

export async function currentScene(moduleDir: string): Promise<CurrentScene | null> {
  const id = openScene.get(moduleKey(moduleDir));
  return id ? { id } : null;
}

function collectIds(nodes: SceneListNode[], into = new Set<string>()) {
  for (const node of nodes) {
    into.add(node.id);
    collectIds(node.children, into);
  }
  return into;
}

async function sceneTree(moduleDir: string, parentId: string | null): Promise<SceneListNode[]> {
  const rows = await listChildNodes(moduleDir, parentId);
  const nodes: SceneListNode[] = [];
  for (const row of rows) {
    if (row.kind !== "scene" && row.kind !== "event") continue;
    nodes.push({
      id: row.id,
      kind: row.kind,
      title: row.title,
      position: row.position,
      children: await sceneTree(moduleDir, row.id),
    });
  }
  return nodes;
}

async function liveSceneIds(moduleDir: string) {
  return collectIds(await sceneTree(moduleDir, null));
}

export async function listScenes(moduleDir: string): Promise<SceneListNode[]> {
  return sceneTree(moduleDir, null);
}

export async function listActors(moduleDir: string): Promise<ActorListItem[]> {
  const scenes = await liveSceneIds(moduleDir);
  const [actors, positions] = await Promise.all([loadScenarioActors(moduleDir), listActorPositions(moduleDir)]);
  const positionOf = new Map(positions.map((row) => [row.id, row.position]));
  return actors
    .filter((actor) => !actor.trashed)
    .map((actor) => ({
      id: actor.id,
      kind: actor.kind,
      name: actor.name,
      position: positionOf.get(actor.id) ?? 0,
      sceneIds: actor.links.filter((id) => scenes.has(id)),
    }));
}

export async function listArticles(moduleDir: string): Promise<ArticleListItem[]> {
  const scenes = await liveSceneIds(moduleDir);
  const articles = await loadScenarioArticles(moduleDir);
  return articles
    .filter((article) => !article.trashed)
    .map((article) => ({
      id: article.id,
      kind: article.kind,
      name: article.name,
      position: article.position,
      sceneIds: article.scenes.filter((id) => scenes.has(id)),
    }));
}

async function readScene(moduleDir: string, id: string): Promise<SceneRecord | null> {
  const node = await loadScenarioNode(moduleDir, id);
  if (!node) return null;
  const body = (await readPage(moduleDir, id)) ?? EMPTY_BODY;
  return { id: node.id, kind: node.kind, parentId: node.parentId, title: node.title, position: node.position, body };
}

async function readActor(moduleDir: string, id: string): Promise<ActorRecord | null> {
  const scenes = await liveSceneIds(moduleDir);
  const [actors, positions] = await Promise.all([loadScenarioActors(moduleDir), listActorPositions(moduleDir)]);
  const actor = actors.find((item) => item.id === id && !item.trashed);
  if (!actor) return null;
  return {
    id: actor.id,
    kind: actor.kind,
    name: actor.name,
    age: actor.age,
    gender: actor.gender,
    occupation: actor.occupation,
    portrait: actor.portrait,
    stats: actor.stats,
    derived: actor.derived,
    appearance: actor.appearance,
    portrayal: actor.portrayal,
    backstory: actor.backstory,
    notes: actor.notes,
    nativeLanguage: actor.nativeLanguage,
    skills: actor.skills,
    attacks: actor.attacks,
    sceneIds: actor.links.filter((sceneId) => scenes.has(sceneId)),
    position: positions.find((row) => row.id === id)?.position ?? 0,
  };
}

async function readArticle(moduleDir: string, id: string): Promise<ArticleRecord | null> {
  const scenes = await liveSceneIds(moduleDir);
  const [articles, actors] = await Promise.all([loadScenarioArticles(moduleDir), loadScenarioActors(moduleDir)]);
  const article = articles.find((item) => item.id === id && !item.trashed);
  if (!article) return null;
  const liveActors = new Set(actors.filter((actor) => !actor.trashed).map((actor) => actor.id));
  return {
    id: article.id,
    kind: article.kind,
    name: article.name,
    description: article.description,
    position: article.position,
    sceneIds: article.scenes.filter((sceneId) => scenes.has(sceneId)),
    actorIds: article.actors.filter((actorId) => liveActors.has(actorId)),
  };
}

export async function readModuleRecord(moduleDir: string, kind: ModuleRecordKind, id: string): Promise<ModuleRecord | null> {
  if (kind === "scene") return readScene(moduleDir, id);
  if (kind === "actor") return readActor(moduleDir, id);
  return readArticle(moduleDir, id);
}

export const scenarioModuleData: ModuleDataSource = {
  listScenes,
  listActors,
  listArticles,
  readModuleRecord,
  currentScene,
};
