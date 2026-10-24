import { serial } from "@ek/tool-api";
import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";
import { deletePage, readPage, writePage } from "./storage";

const TOOL_PREFIX = "ek_scenario_";

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

type SqlValue = string | number | null;

export type ScenarioNode = {
  id: string;
  parentId: string | null;
  kind: "scene" | "event";
  title: string;
  position: number;
  bodyFile: string;
};

type NodeRow = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  position: number;
  body_file: string;
};

export function projectDatabaseAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isTauri() {
  return projectDatabaseAvailable();
}

async function exec(projectPath: string, sql: string, params: SqlValue[] = []) {
  if (!isTauri()) throw new Error("project database is only available in the desktop app");
  await serial(projectPath, () => invoke("project_db_exec", { projectPath, toolPrefix: TOOL_PREFIX, sql, params }));
}

async function query<T>(projectPath: string, sql: string, params: SqlValue[] = []): Promise<T[]> {
  if (!isTauri()) throw new Error("project database is only available in the desktop app");
  return serial(projectPath, () => invoke<T[]>("project_db_query", { projectPath, toolPrefix: TOOL_PREFIX, sql, params }));
}

type Statement = { sql: string; params?: SqlValue[] };

/**
 * Run write statements in one database transaction.
 * The connection is shared with other tools, so BEGIN/COMMIT must never be split across IPC calls.
 */
async function batch(projectPath: string, statements: Statement[]) {
  if (!isTauri()) throw new Error("project database is only available in the desktop app");
  if (statements.length === 0) return;
  await serial(projectPath, () => invoke("project_db_batch", { projectPath, toolPrefix: TOOL_PREFIX, statements }));
}

export const TRASH_ID = "trash";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ek_scenario_schema (
    version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_node (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES ek_scenario_node(id),
    kind TEXT NOT NULL CHECK (kind IN ('scene', 'event', 'trash')),
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    body_file TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS ek_scenario_node_parent ON ek_scenario_node(parent_id)",
  `CREATE TABLE IF NOT EXISTS ek_scenario_actor (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('npc', 'monster')),
    name TEXT NOT NULL,
    age TEXT NOT NULL,
    gender TEXT NOT NULL,
    occupation TEXT NOT NULL,
    portrait TEXT NOT NULL,
    str INTEGER NOT NULL,
    con INTEGER NOT NULL,
    siz INTEGER NOT NULL,
    dex INTEGER NOT NULL,
    app INTEGER NOT NULL,
    intellect INTEGER NOT NULL,
    pow INTEGER NOT NULL,
    edu INTEGER NOT NULL,
    luck INTEGER NOT NULL,
    hp INTEGER NOT NULL,
    mp INTEGER NOT NULL,
    san INTEGER NOT NULL,
    damage TEXT NOT NULL,
    build INTEGER NOT NULL,
    mov INTEGER NOT NULL,
    appearance TEXT NOT NULL DEFAULT '',
    portrayal TEXT NOT NULL DEFAULT '',
    backstory TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    native_language TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    trashed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_actor_skill (
    actor_id TEXT NOT NULL REFERENCES ek_scenario_actor(id),
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (actor_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_actor_attack (
    actor_id TEXT NOT NULL REFERENCES ek_scenario_actor(id),
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    chance INTEGER NOT NULL,
    damage TEXT NOT NULL,
    uses TEXT NOT NULL,
    note TEXT NOT NULL,
    PRIMARY KEY (actor_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_actor_link (
    actor_id TEXT NOT NULL REFERENCES ek_scenario_actor(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES ek_scenario_node(id) ON DELETE CASCADE,
    PRIMARY KEY (actor_id, node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_map (
    id TEXT PRIMARY KEY,
    src TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_map_link (
    map_id TEXT NOT NULL REFERENCES ek_scenario_map(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES ek_scenario_node(id) ON DELETE CASCADE,
    PRIMARY KEY (map_id, node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_article (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('clue', 'item')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    position INTEGER NOT NULL,
    trashed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_article_scene (
    article_id TEXT NOT NULL REFERENCES ek_scenario_article(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES ek_scenario_node(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_article_actor (
    article_id TEXT NOT NULL REFERENCES ek_scenario_article(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES ek_scenario_actor(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, actor_id)
  )`,
  `INSERT INTO ek_scenario_schema (version)
   SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ek_scenario_schema)`,
];

const NODE_TABLE = `CREATE TABLE ek_scenario_node (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES ek_scenario_node(id),
  kind TEXT NOT NULL CHECK (kind IN ('scene', 'event', 'trash')),
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  body_file TEXT NOT NULL
)`;

const schemaReady = new Map<string, Promise<void>>();

export function ensureScenarioSchema(projectPath: string) {
  const pending = schemaReady.get(projectPath);
  if (pending) return pending;
  const next = applyScenarioSchema(projectPath).catch((error: unknown) => {
    schemaReady.delete(projectPath);
    throw error;
  });
  schemaReady.set(projectPath, next);
  return next;
}

async function applyScenarioSchema(projectPath: string) {
  for (const sql of SCHEMA) await exec(projectPath, sql);
  await migrateNodeTable(projectPath);
  await migrateActorColumns(projectPath);
  await migrateTrashedFlag(projectPath, "ek_scenario_actor");
  await migrateTrashedFlag(projectPath, "ek_scenario_article");
  await exec(
    projectPath,
    `INSERT INTO ek_scenario_node (id, parent_id, kind, title, position, body_file)
     SELECT ?1, NULL, 'trash', '', 0, ''
     WHERE NOT EXISTS (SELECT 1 FROM ek_scenario_node WHERE id = ?1)`,
    [TRASH_ID],
  );
}

const ACTOR_TEXT_COLUMNS = ["appearance", "portrayal", "backstory", "notes", "native_language"] as const;

async function migrateTrashedFlag(projectPath: string, table: string) {
  const rows = await query<{ name: string }>(projectPath, `PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === "trashed")) return;
  await exec(projectPath, `ALTER TABLE ${table} ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0`);
}

async function migrateActorColumns(projectPath: string) {
  const rows = await query<{ name: string }>(projectPath, "PRAGMA table_info(ek_scenario_actor)");
  const names = new Set(rows.map((row) => row.name));
  for (const column of ACTOR_TEXT_COLUMNS) {
    if (names.has(column)) continue;
    await exec(projectPath, `ALTER TABLE ek_scenario_actor ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
}

async function migrateNodeTable(projectPath: string) {
  const rows = await query<{ sql: string | null }>(projectPath, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ek_scenario_node'");
  const sql = rows[0]?.sql ?? "";
  if (!sql || sql.includes("'trash'")) return;
  // Read every row first, then rebuild the table in one transaction. Parents are inserted before children.
  const existing = await query<NodeRow>(projectPath, "SELECT id, parent_id, kind, title, position, body_file FROM ek_scenario_node");
  const ordered: NodeRow[] = [];
  const pending = existing.slice();
  const inserted = new Set<string>();
  while (pending.length > 0) {
    const ready = pending.filter((row) => row.parent_id === null || inserted.has(row.parent_id));
    if (ready.length === 0) throw new Error("cycle");
    for (const row of ready) {
      ordered.push(row);
      inserted.add(row.id);
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (inserted.has(pending[index].id)) pending.splice(index, 1);
    }
  }
  await batch(projectPath, [
    { sql: "DROP TABLE IF EXISTS ek_scenario_node_next" },
    { sql: "DROP TABLE ek_scenario_node" },
    { sql: NODE_TABLE },
    ...ordered.map((row) => ({
      sql: "INSERT INTO ek_scenario_node (id, parent_id, kind, title, position, body_file) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params: [row.id, row.parent_id, row.kind, row.title, row.position, row.body_file],
    })),
    { sql: "CREATE INDEX IF NOT EXISTS ek_scenario_node_parent ON ek_scenario_node(parent_id)" },
  ]);
}

function nodeFromRow(row: NodeRow): ScenarioNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind === "event" ? "event" : "scene",
    title: row.title,
    position: row.position,
    bodyFile: row.body_file,
  };
}

const NODE_FIELDS = "id, parent_id, kind, title, position, body_file";

/** The node and every ancestor, in one query. `UNION` stops the walk if the data ever forms a loop. */
function ancestorRows(projectPath: string, id: string) {
  return query<NodeRow>(
    projectPath,
    `WITH RECURSIVE chain(id) AS (
       SELECT ?1
       UNION
       SELECT n.parent_id FROM ek_scenario_node n JOIN chain ON n.id = chain.id WHERE n.parent_id IS NOT NULL
     )
     SELECT ${NODE_FIELDS} FROM ek_scenario_node WHERE id IN (SELECT id FROM chain)`,
    [id],
  );
}

/** Ids from `parentId` up to the root. Throws when a link points at a missing row or loops. */
async function ancestorIds(projectPath: string, parentId: string | null): Promise<Set<string>> {
  const seen = new Set<string>();
  if (!parentId) return seen;
  const parentOf = new Map((await ancestorRows(projectPath, parentId)).map((row) => [row.id, row.parent_id]));
  let current: string | null = parentId;
  while (current) {
    if (seen.has(current)) throw new Error("cycle");
    seen.add(current);
    if (!parentOf.has(current)) throw new Error("missing parent");
    current = parentOf.get(current) ?? null;
  }
  return seen;
}

/** A node cannot be placed under itself or under one of its descendants. */
async function assertCanParent(projectPath: string, nodeId: string, parentId: string | null) {
  if ((await ancestorIds(projectPath, parentId)).has(nodeId)) throw new Error("cycle");
}

export async function loadScenarioNode(projectPath: string, id: string): Promise<ScenarioNode | null> {
  await ensureScenarioSchema(projectPath);
  const rows = await ancestorRows(projectPath, id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const row = byId.get(id);
  if (!row || row.kind === "trash") return null;
  const seen = new Set<string>();
  let parent = row.parent_id;
  while (parent) {
    if (parent === TRASH_ID || seen.has(parent)) return null;
    seen.add(parent);
    const next = byId.get(parent);
    if (!next || next.kind === "trash") return null;
    parent = next.parent_id;
  }
  return nodeFromRow(row);
}

export async function listActorPositions(projectPath: string): Promise<{ id: string; position: number }[]> {
  await ensureScenarioSchema(projectPath);
  return query<{ id: string; position: number }>(projectPath, "SELECT id, position FROM ek_scenario_actor WHERE trashed = 0 ORDER BY position");
}

export async function listChildNodes(projectPath: string, parentId: string | null): Promise<ScenarioNode[]> {
  await ensureScenarioSchema(projectPath);
  const rows = parentId
    ? await query<NodeRow>(projectPath, `SELECT ${NODE_FIELDS} FROM ek_scenario_node WHERE parent_id = ?1 ORDER BY position`, [parentId])
    : await query<NodeRow>(projectPath, `SELECT ${NODE_FIELDS} FROM ek_scenario_node WHERE parent_id IS NULL AND kind != 'trash' ORDER BY position`);
  return rows.map(nodeFromRow);
}

const MAX_TREE_DEPTH = 1000;

/** Every live node (nothing under the trash), parents before children, siblings by position. */
export async function listLiveNodes(projectPath: string): Promise<ScenarioNode[]> {
  await ensureScenarioSchema(projectPath);
  return (await listDescendants(projectPath, null)).map(nodeFromRow);
}

/** Every descendant of `parentId` (the roots when null), with depth so callers can order parents before children. */
async function listDescendants(projectPath: string, parentId: string | null): Promise<(NodeRow & { depth: number })[]> {
  const rootFilter = parentId ? "parent_id = ?1" : "parent_id IS NULL AND kind != 'trash'";
  return query<NodeRow & { depth: number }>(
    projectPath,
    `WITH RECURSIVE sub(id, depth) AS (
       SELECT id, 0 FROM ek_scenario_node WHERE ${rootFilter}
       UNION
       SELECT n.id, sub.depth + 1 FROM ek_scenario_node n JOIN sub ON n.parent_id = sub.id WHERE sub.depth < ${MAX_TREE_DEPTH}
     )
     SELECT ${NODE_FIELDS.split(", ").map((field) => `n.${field}`).join(", ")}, sub.depth
     FROM ek_scenario_node n JOIN sub ON n.id = sub.id
     ORDER BY sub.depth, n.position`,
    parentId ? [parentId] : [],
  );
}

/** Create the node row and its empty rich-text file together. */
export async function createScenarioNode(
  projectPath: string,
  input: { parentId: string | null; kind: "scene" | "event"; title: string },
): Promise<ScenarioNode> {
  await ensureScenarioSchema(projectPath);
  const id = crypto.randomUUID();
  await assertCanParent(projectPath, id, input.parentId);
  const positionRows = input.parentId
    ? await query<{ position: number | null }>(projectPath, "SELECT MAX(position) AS position FROM ek_scenario_node WHERE parent_id = ?1", [input.parentId])
    : await query<{ position: number | null }>(projectPath, "SELECT MAX(position) AS position FROM ek_scenario_node WHERE parent_id IS NULL");
  const position = (positionRows[0]?.position ?? -1) + 1;
  const bodyFile = `pages/${id}.json`;
  await exec(
    projectPath,
    "INSERT INTO ek_scenario_node (id, parent_id, kind, title, position, body_file) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    [id, input.parentId, input.kind, input.title, position, bodyFile],
  );
  try {
    await writePage(projectPath, id, EMPTY_DOC);
  } catch (error) {
    await exec(projectPath, "DELETE FROM ek_scenario_node WHERE id = ?1", [id]);
    throw error;
  }
  return { id, parentId: input.parentId, kind: input.kind, title: input.title, position, bodyFile };
}

export type ScenarioTreeNode = {
  id: string;
  kind: "scene" | "event";
  title: string;
  children: ScenarioTreeNode[];
};

async function loadUnder(projectPath: string, parentId: string | null): Promise<ScenarioTreeNode[]> {
  const rows = await listDescendants(projectPath, parentId);
  const nodes = new Map<string, ScenarioTreeNode>();
  const roots: ScenarioTreeNode[] = [];
  // Rows arrive parents first, so a child's parent is already in the map; ties keep sibling order by position.
  for (const row of rows) {
    const node: ScenarioTreeNode = { id: row.id, kind: row.kind === "event" ? "event" : "scene", title: row.title, children: [] };
    nodes.set(row.id, node);
    const parent = row.depth === 0 ? null : nodes.get(row.parent_id ?? "");
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export async function loadScenarioTree(projectPath: string): Promise<ScenarioTreeNode[]> {
  return loadUnder(projectPath, null);
}

export async function loadScenarioForest(projectPath: string): Promise<{ nodes: ScenarioTreeNode[]; trash: ScenarioTreeNode[] }> {
  await ensureScenarioSchema(projectPath);
  return { nodes: await loadUnder(projectPath, null), trash: await loadUnder(projectPath, TRASH_ID) };
}

export async function renameScenarioNode(projectPath: string, id: string, title: string) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "UPDATE ek_scenario_node SET title = ?1 WHERE id = ?2", [title, id]);
}

/** Rewrite one sibling list. `orderedIds` is the order after the move, and every id gets `parentId`. */
export async function placeScenarioNodes(projectPath: string, parentId: string | null, orderedIds: string[]) {
  await ensureScenarioSchema(projectPath);
  const ancestors = await ancestorIds(projectPath, parentId);
  for (const id of orderedIds) if (ancestors.has(id)) throw new Error("cycle");
  await batch(
    projectPath,
    orderedIds.map((id, index) => ({
      sql: "UPDATE ek_scenario_node SET parent_id = ?1, position = ?2 WHERE id = ?3",
      params: [parentId, index, id],
    })),
  );
}

/** Delete a node, its descendants, and their rich-text files. Children go first so the parent reference stays valid. */
export async function deleteScenarioNode(projectPath: string, id: string) {
  if (id === TRASH_ID) throw new Error("trash");
  await ensureScenarioSchema(projectPath);
  // Deepest rows first, then the node itself, so each parent reference is gone before the parent row.
  const ids = (await listDescendants(projectPath, id)).reverse().map((row) => row.id);
  ids.push(id);
  await batch(
    projectPath,
    ids.flatMap((current) => [
      { sql: "DELETE FROM ek_scenario_actor_link WHERE node_id = ?1", params: [current] },
      { sql: "DELETE FROM ek_scenario_node WHERE id = ?1", params: [current] },
    ]),
  );
  for (const current of ids) {
    try {
      await deletePage(projectPath, current);
    } catch {
      // The row is already gone. A desktop build without remove_file leaves the page file.
    }
  }
}

export type ScenarioSkill = { name: string; value: number };

export type ScenarioAttack = { name: string; chance: number; damage: string; uses: string; note: string };

export type ScenarioActor = {
  id: string;
  kind: "npc" | "monster";
  name: string;
  age: string;
  gender: string;
  occupation: string;
  portrait: string;
  stats: {
    str: number;
    con: number;
    siz: number;
    dex: number;
    app: number;
    int: number;
    pow: number;
    edu: number;
    luck: number;
  };
    derived: {
    hp: number;
    mp: number;
    san: number;
    damage: string;
    build: number;
    mov: number;
  };
  appearance: string;
  portrayal: string;
  backstory: string;
  notes: string;
  nativeLanguage: string;
  skills: ScenarioSkill[];
  attacks: ScenarioAttack[];
  links: string[];
  trashed: boolean;
  position: number;
};

type ActorRow = {
  id: string;
  kind: string;
  name: string;
  age: string;
  gender: string;
  occupation: string;
  portrait: string;
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  intellect: number;
  pow: number;
  edu: number;
  luck: number;
  hp: number;
  mp: number;
  san: number;
  damage: string;
  build: number;
  mov: number;
  appearance: string;
  portrayal: string;
  backstory: string;
  notes: string;
  native_language: string;
  trashed: number;
  position: number;
};

type SkillRow = { actor_id: string; name: string; value: number };

type AttackRow = { actor_id: string; name: string; chance: number; damage: string; uses: string; note: string };

function actorFromRow(row: ActorRow, skills: ScenarioSkill[], attacks: ScenarioAttack[], links: string[]): ScenarioActor {
  return {
    id: row.id,
    kind: row.kind === "monster" ? "monster" : "npc",
    name: row.name,
    age: row.age,
    gender: row.gender,
    occupation: row.occupation,
    portrait: row.portrait,
    stats: {
      str: row.str,
      con: row.con,
      siz: row.siz,
      dex: row.dex,
      app: row.app,
      int: row.intellect,
      pow: row.pow,
      edu: row.edu,
      luck: row.luck,
    },
    derived: {
      hp: row.hp,
      mp: row.mp,
      san: row.san,
      damage: row.damage,
      build: row.build,
      mov: row.mov,
    },
    appearance: row.appearance,
    portrayal: row.portrayal,
    backstory: row.backstory,
    notes: row.notes,
    nativeLanguage: row.native_language,
    skills,
    attacks,
    links,
    trashed: row.trashed === 1,
    position: row.position,
  };
}

function actorValues(actor: ScenarioActor): SqlValue[] {
  return [
    actor.id,
    actor.kind,
    actor.name,
    actor.age,
    actor.gender,
    actor.occupation,
    actor.portrait,
    actor.stats.str,
    actor.stats.con,
    actor.stats.siz,
    actor.stats.dex,
    actor.stats.app,
    actor.stats.int,
    actor.stats.pow,
    actor.stats.edu,
    actor.stats.luck,
    actor.derived.hp,
    actor.derived.mp,
    actor.derived.san,
    actor.derived.damage,
    actor.derived.build,
    actor.derived.mov,
    actor.appearance,
    actor.portrayal,
    actor.backstory,
    actor.notes,
    actor.nativeLanguage,
  ];
}

const ACTOR_COLUMNS = `id, kind, name, age, gender, occupation, portrait,
  str, con, siz, dex, app, intellect, pow, edu, luck,
  hp, mp, san, damage, build, mov,
  appearance, portrayal, backstory, notes, native_language`;

export async function loadScenarioActors(projectPath: string): Promise<ScenarioActor[]> {
  await ensureScenarioSchema(projectPath);
  return loadActors(projectPath, null);
}

export async function loadScenarioActor(projectPath: string, id: string): Promise<ScenarioActor | null> {
  await ensureScenarioSchema(projectPath);
  return (await loadActors(projectPath, id))[0] ?? null;
}

/** All actors, or just one when `id` is set. Detail tables are filtered the same way so one actor costs four small reads. */
async function loadActors(projectPath: string, id: string | null): Promise<ScenarioActor[]> {
  const params: SqlValue[] = id ? [id] : [];
  const actorFilter = id ? "WHERE id = ?1" : "";
  const detailFilter = id ? "WHERE actor_id = ?1" : "";
  const rows = await query<ActorRow>(
    projectPath,
    `SELECT ${ACTOR_COLUMNS}, trashed, position FROM ek_scenario_actor ${actorFilter} ORDER BY position`,
    params,
  );
  const skillRows = await query<SkillRow>(
    projectPath,
    `SELECT actor_id, name, value FROM ek_scenario_actor_skill ${detailFilter} ORDER BY position`,
    params,
  );
  const skills = new Map<string, ScenarioSkill[]>();
  for (const skill of skillRows) {
    const list = skills.get(skill.actor_id) ?? [];
    list.push({ name: skill.name, value: skill.value });
    skills.set(skill.actor_id, list);
  }
  const attackRows = await query<AttackRow>(
    projectPath,
    `SELECT actor_id, name, chance, damage, uses, note FROM ek_scenario_actor_attack ${detailFilter} ORDER BY position`,
    params,
  );
  const attacks = new Map<string, ScenarioAttack[]>();
  for (const attack of attackRows) {
    const list = attacks.get(attack.actor_id) ?? [];
    list.push({ name: attack.name, chance: attack.chance, damage: attack.damage, uses: attack.uses, note: attack.note });
    attacks.set(attack.actor_id, list);
  }
  const linkRows = await query<{ actor_id: string; node_id: string }>(
    projectPath,
    `SELECT actor_id, node_id FROM ek_scenario_actor_link ${detailFilter}`,
    params,
  );
  const links = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = links.get(link.actor_id) ?? [];
    list.push(link.node_id);
    links.set(link.actor_id, list);
  }
  return rows.map((row) => actorFromRow(row, skills.get(row.id) ?? [], attacks.get(row.id) ?? [], links.get(row.id) ?? []));
}

export async function insertScenarioActor(projectPath: string, actor: ScenarioActor) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    {
      sql: `INSERT INTO ek_scenario_actor (${ACTOR_COLUMNS}, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM ek_scenario_actor))`,
      params: actorValues(actor),
    },
    ...actorDetailStatements(actor),
  ]);
}

export async function updateScenarioActor(projectPath: string, actor: ScenarioActor) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    {
      sql: `UPDATE ek_scenario_actor SET
         kind = ?2, name = ?3, age = ?4, gender = ?5, occupation = ?6, portrait = ?7,
         str = ?8, con = ?9, siz = ?10, dex = ?11, app = ?12, intellect = ?13, pow = ?14, edu = ?15, luck = ?16,
         hp = ?17, mp = ?18, san = ?19, damage = ?20, build = ?21, mov = ?22,
         appearance = ?23, portrayal = ?24, backstory = ?25, notes = ?26, native_language = ?27
       WHERE id = ?1`,
      params: actorValues(actor),
    },
    ...actorDetailStatements(actor),
  ]);
}

/** Replace the skills, attacks, and scene links of one actor. Runs inside the caller's batch. */
function actorDetailStatements(actor: ScenarioActor): Statement[] {
  return [
    { sql: "DELETE FROM ek_scenario_actor_skill WHERE actor_id = ?1", params: [actor.id] },
    ...actor.skills.map((skill, index) => ({
      sql: "INSERT INTO ek_scenario_actor_skill (actor_id, position, name, value) VALUES (?1, ?2, ?3, ?4)",
      params: [actor.id, index, skill.name, skill.value],
    })),
    { sql: "DELETE FROM ek_scenario_actor_attack WHERE actor_id = ?1", params: [actor.id] },
    ...actor.attacks.map((attack, index) => ({
      sql: "INSERT INTO ek_scenario_actor_attack (actor_id, position, name, chance, damage, uses, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params: [actor.id, index, attack.name, attack.chance, attack.damage, attack.uses, attack.note],
    })),
    { sql: "DELETE FROM ek_scenario_actor_link WHERE actor_id = ?1", params: [actor.id] },
    ...actor.links.map((nodeId) => ({
      sql: "INSERT INTO ek_scenario_actor_link (actor_id, node_id) VALUES (?1, ?2)",
      params: [actor.id, nodeId],
    })),
  ];
}

export type ScenarioMap = { id: string; src: string; position: number; links: string[] };

export async function loadScenarioMaps(projectPath: string): Promise<ScenarioMap[]> {
  await ensureScenarioSchema(projectPath);
  const rows = await query<{ id: string; src: string; position: number }>(
    projectPath,
    "SELECT id, src, position FROM ek_scenario_map ORDER BY position, id",
  );
  const links = await query<{ map_id: string; node_id: string }>(projectPath, "SELECT map_id, node_id FROM ek_scenario_map_link");
  const byMap = new Map<string, string[]>();
  for (const link of links) {
    const list = byMap.get(link.map_id) ?? [];
    list.push(link.node_id);
    byMap.set(link.map_id, list);
  }
  return rows.map((row) => ({ id: row.id, src: row.src, position: row.position, links: byMap.get(row.id) ?? [] }));
}

export async function insertScenarioMap(projectPath: string, map: ScenarioMap) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    { sql: "INSERT INTO ek_scenario_map (id, src, position) VALUES (?1, ?2, ?3)", params: [map.id, map.src, map.position] },
    ...mapLinkStatements(map.id, map.links),
  ]);
}

/** Replace the scene links of one map. Runs inside the caller's batch. */
function mapLinkStatements(mapId: string, links: string[]): Statement[] {
  return [
    { sql: "DELETE FROM ek_scenario_map_link WHERE map_id = ?1", params: [mapId] },
    ...links.map((nodeId) => ({ sql: "INSERT INTO ek_scenario_map_link (map_id, node_id) VALUES (?1, ?2)", params: [mapId, nodeId] })),
  ];
}

export async function updateScenarioMapLinks(projectPath: string, mapId: string, links: string[]) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, mapLinkStatements(mapId, links));
}

export async function updateScenarioMapSrc(projectPath: string, id: string, src: string) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "UPDATE ek_scenario_map SET src = ?1 WHERE id = ?2", [src, id]);
}

export async function deleteScenarioMap(projectPath: string, id: string) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "DELETE FROM ek_scenario_map WHERE id = ?1", [id]);
}

export async function orderScenarioMaps(projectPath: string, ids: string[]) {
  await ensureScenarioSchema(projectPath);
  await batch(
    projectPath,
    ids.map((id, index) => ({ sql: "UPDATE ek_scenario_map SET position = ?1 WHERE id = ?2", params: [index, id] })),
  );
}

export type ScenarioArticle = {
  id: string;
  kind: "clue" | "item";
  name: string;
  description: string;
  position: number;
  scenes: string[];
  actors: string[];
  trashed: boolean;
};

export async function loadScenarioArticles(projectPath: string): Promise<ScenarioArticle[]> {
  await ensureScenarioSchema(projectPath);
  return loadArticles(projectPath, null);
}

export async function loadScenarioArticle(projectPath: string, id: string): Promise<ScenarioArticle | null> {
  await ensureScenarioSchema(projectPath);
  return (await loadArticles(projectPath, id))[0] ?? null;
}

async function loadArticles(projectPath: string, id: string | null): Promise<ScenarioArticle[]> {
  const params: SqlValue[] = id ? [id] : [];
  const articleFilter = id ? "WHERE id = ?1" : "";
  const linkFilter = id ? "WHERE article_id = ?1" : "";
  const rows = await query<{ id: string; kind: string; name: string; description: string; position: number; trashed: number }>(
    projectPath,
    `SELECT id, kind, name, description, position, trashed FROM ek_scenario_article ${articleFilter} ORDER BY position, id`,
    params,
  );
  const scenes = await query<{ article_id: string; node_id: string }>(projectPath, `SELECT article_id, node_id FROM ek_scenario_article_scene ${linkFilter}`, params);
  const actors = await query<{ article_id: string; actor_id: string }>(projectPath, `SELECT article_id, actor_id FROM ek_scenario_article_actor ${linkFilter}`, params);
  const scenesByArticle = groupIds(scenes, "article_id", "node_id");
  const actorsByArticle = groupIds(actors, "article_id", "actor_id");
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind === "item" ? "item" : "clue",
    name: row.name,
    description: row.description,
    position: row.position,
    scenes: scenesByArticle.get(row.id) ?? [],
    actors: actorsByArticle.get(row.id) ?? [],
    trashed: row.trashed === 1,
  }));
}

export async function setScenarioActorTrashed(projectPath: string, id: string, trashed: boolean) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "UPDATE ek_scenario_actor SET trashed = ?1 WHERE id = ?2", [trashed ? 1 : 0, id]);
}

export async function deleteScenarioActor(projectPath: string, id: string) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    { sql: "DELETE FROM ek_scenario_actor_skill WHERE actor_id = ?1", params: [id] },
    { sql: "DELETE FROM ek_scenario_actor_attack WHERE actor_id = ?1", params: [id] },
    { sql: "DELETE FROM ek_scenario_actor_link WHERE actor_id = ?1", params: [id] },
    { sql: "DELETE FROM ek_scenario_article_actor WHERE actor_id = ?1", params: [id] },
    { sql: "DELETE FROM ek_scenario_actor WHERE id = ?1", params: [id] },
  ]);
}

export async function setScenarioArticleTrashed(projectPath: string, id: string, trashed: boolean) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "UPDATE ek_scenario_article SET trashed = ?1 WHERE id = ?2", [trashed ? 1 : 0, id]);
}

export async function deleteScenarioArticle(projectPath: string, id: string) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "DELETE FROM ek_scenario_article WHERE id = ?1", [id]);
}

function groupIds<T extends Record<string, string>>(rows: T[], parentKey: keyof T, childKey: keyof T) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row[parentKey];
    const list = grouped.get(parent) ?? [];
    list.push(row[childKey]);
    grouped.set(parent, list);
  }
  return grouped;
}

export async function insertScenarioArticle(projectPath: string, article: ScenarioArticle) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    {
      sql: "INSERT INTO ek_scenario_article (id, kind, name, description, position) VALUES (?1, ?2, ?3, ?4, ?5)",
      params: [article.id, article.kind, article.name, article.description, article.position],
    },
    ...articleLinkStatements(article),
  ]);
}

export async function updateScenarioArticle(projectPath: string, article: ScenarioArticle) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    { sql: "UPDATE ek_scenario_article SET name = ?1, description = ?2 WHERE id = ?3", params: [article.name, article.description, article.id] },
    ...articleLinkStatements(article),
  ]);
}

export async function setActorArticles(projectPath: string, actorId: string, articleIds: string[]) {
  await ensureScenarioSchema(projectPath);
  await batch(projectPath, [
    { sql: "DELETE FROM ek_scenario_article_actor WHERE actor_id = ?1", params: [actorId] },
    ...articleIds.map((articleId) => ({
      sql: "INSERT INTO ek_scenario_article_actor (article_id, actor_id) VALUES (?1, ?2)",
      params: [articleId, actorId],
    })),
  ]);
}

/** Replace the scene and actor links of one article. Runs inside the caller's batch. */
function articleLinkStatements(article: ScenarioArticle): Statement[] {
  return [
    { sql: "DELETE FROM ek_scenario_article_scene WHERE article_id = ?1", params: [article.id] },
    ...article.scenes.map((nodeId) => ({
      sql: "INSERT INTO ek_scenario_article_scene (article_id, node_id) VALUES (?1, ?2)",
      params: [article.id, nodeId],
    })),
    { sql: "DELETE FROM ek_scenario_article_actor WHERE article_id = ?1", params: [article.id] },
    ...article.actors.map((actorId) => ({
      sql: "INSERT INTO ek_scenario_article_actor (article_id, actor_id) VALUES (?1, ?2)",
      params: [article.id, actorId],
    })),
  ];
}

/** Copy a node under `parentId`, including its rich text and descendants. The copy is the last sibling. */
export async function duplicateScenarioNode(projectPath: string, source: ScenarioTreeNode, parentId: string | null): Promise<ScenarioTreeNode> {
  const created = await createScenarioNode(projectPath, { parentId, kind: source.kind, title: source.title });
  const doc = await readPage(projectPath, source.id);
  if (doc) await writePage(projectPath, created.id, doc);
  const children: ScenarioTreeNode[] = [];
  for (const child of source.children) children.push(await duplicateScenarioNode(projectPath, child, created.id));
  return { id: created.id, kind: created.kind, title: created.title, children };
}
