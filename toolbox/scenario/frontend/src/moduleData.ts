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
import { listActorPositions, listLiveNodes, loadScenarioActor, loadScenarioActors, loadScenarioArticle, loadScenarioArticles, loadScenarioNode } from "./db";
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

/** Ids of every node outside the trash. */
async function liveSceneIds(moduleDir: string) {
  return new Set((await listLiveNodes(moduleDir)).map((node) => node.id));
}

/** One query for the whole tree. Rows come parents first, so each child's parent is already placed. */
export async function listScenes(moduleDir: string): Promise<SceneListNode[]> {
  const rows = await listLiveNodes(moduleDir);
  const nodes = new Map<string, SceneListNode>();
  const roots: SceneListNode[] = [];
  for (const row of rows) {
    const node: SceneListNode = { id: row.id, kind: row.kind, title: row.title, position: row.position, children: [] };
    nodes.set(row.id, node);
    const parent = row.parentId ? nodes.get(row.parentId) : null;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export async function listActors(moduleDir: string): Promise<ActorListItem[]> {
  const [scenes, actors] = await Promise.all([liveSceneIds(moduleDir), loadScenarioActors(moduleDir)]);
  return actors
    .filter((actor) => !actor.trashed)
    .map((actor) => ({
      id: actor.id,
      kind: actor.kind,
      name: actor.name,
      position: actor.position,
      sceneIds: actor.links.filter((id) => scenes.has(id)),
    }));
}

export async function listArticles(moduleDir: string): Promise<ArticleListItem[]> {
  const [scenes, articles] = await Promise.all([liveSceneIds(moduleDir), loadScenarioArticles(moduleDir)]);
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
  const [scenes, actor] = await Promise.all([liveSceneIds(moduleDir), loadScenarioActor(moduleDir, id)]);
  if (!actor || actor.trashed) return null;
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
    position: actor.position,
  };
}

async function readArticle(moduleDir: string, id: string): Promise<ArticleRecord | null> {
  const [scenes, article, actors] = await Promise.all([liveSceneIds(moduleDir), loadScenarioArticle(moduleDir, id), listActorPositions(moduleDir)]);
  if (!article || article.trashed) return null;
  const liveActors = new Set(actors.map((actor) => actor.id));
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
