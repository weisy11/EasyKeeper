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
  await invoke("project_db_exec", { projectPath, toolPrefix: TOOL_PREFIX, sql, params });
}

async function query<T>(projectPath: string, sql: string, params: SqlValue[] = []): Promise<T[]> {
  if (!isTauri()) throw new Error("project database is only available in the desktop app");
  return invoke<T[]>("project_db_query", { projectPath, toolPrefix: TOOL_PREFIX, sql, params });
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
    position INTEGER NOT NULL
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

export async function ensureScenarioSchema(projectPath: string) {
  for (const sql of SCHEMA) await exec(projectPath, sql);
  await migrateNodeTable(projectPath);
  await migrateActorColumns(projectPath);
  await exec(
    projectPath,
    `INSERT INTO ek_scenario_node (id, parent_id, kind, title, position, body_file)
     SELECT ?1, NULL, 'trash', '', 0, ''
     WHERE NOT EXISTS (SELECT 1 FROM ek_scenario_node WHERE id = ?1)`,
    [TRASH_ID],
  );
}

const ACTOR_TEXT_COLUMNS = ["appearance", "portrayal", "backstory", "notes", "native_language"] as const;

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
  await exec(projectPath, "BEGIN");
  try {
    await exec(projectPath, "DROP TABLE IF EXISTS ek_scenario_node_next");
    await exec(
      projectPath,
      `CREATE TABLE ek_scenario_node_next (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('scene', 'event', 'trash')),
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        body_file TEXT NOT NULL
      )`,
    );
    await exec(
      projectPath,
      "INSERT INTO ek_scenario_node_next (id, parent_id, kind, title, position, body_file) SELECT id, parent_id, kind, title, position, body_file FROM ek_scenario_node",
    );
    await exec(projectPath, "DROP TABLE ek_scenario_node");
    await exec(projectPath, NODE_TABLE);
    const copied = await query<NodeRow>(
      projectPath,
      "SELECT id, parent_id, kind, title, position, body_file FROM ek_scenario_node_next",
    );
    const pending = copied.slice();
    const inserted = new Set<string>();
    while (pending.length > 0) {
      const ready = pending.filter((row) => row.parent_id === null || inserted.has(row.parent_id));
      if (ready.length === 0) throw new Error("cycle");
      for (const row of ready) {
        await exec(
          projectPath,
          "INSERT INTO ek_scenario_node (id, parent_id, kind, title, position, body_file) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
          [row.id, row.parent_id, row.kind, row.title, row.position, row.body_file],
        );
        inserted.add(row.id);
      }
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (inserted.has(pending[index].id)) pending.splice(index, 1);
      }
    }
    await exec(projectPath, "DROP TABLE ek_scenario_node_next");
    await exec(projectPath, "CREATE INDEX IF NOT EXISTS ek_scenario_node_parent ON ek_scenario_node(parent_id)");
    await exec(projectPath, "COMMIT");
  } catch (error) {
    await exec(projectPath, "ROLLBACK");
    throw error;
  }
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

/** Walk parents. A node cannot be placed under itself or under one of its descendants. */
async function assertCanParent(projectPath: string, nodeId: string, parentId: string | null) {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === nodeId || seen.has(current)) throw new Error("cycle");
    seen.add(current);
    const rows = await query<{ parent_id: string | null }>(projectPath, "SELECT parent_id FROM ek_scenario_node WHERE id = ?1", [current]);
    if (rows.length === 0) throw new Error("missing parent");
    current = rows[0].parent_id;
  }
}

export async function listChildNodes(projectPath: string, parentId: string | null): Promise<ScenarioNode[]> {
  await ensureScenarioSchema(projectPath);
  const rows = parentId
    ? await query<NodeRow>(
        projectPath,
        "SELECT id, parent_id, kind, title, position, body_file FROM ek_scenario_node WHERE parent_id = ?1 ORDER BY position",
        [parentId],
      )
    : await query<NodeRow>(
        projectPath,
        "SELECT id, parent_id, kind, title, position, body_file FROM ek_scenario_node WHERE parent_id IS NULL AND kind != 'trash' ORDER BY position",
      );
  return rows.map(nodeFromRow);
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
  const rows = await listChildNodes(projectPath, parentId);
  const nodes: ScenarioTreeNode[] = [];
  for (const row of rows) {
    nodes.push({ id: row.id, kind: row.kind, title: row.title, children: await loadUnder(projectPath, row.id) });
  }
  return nodes;
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
  for (const id of orderedIds) await assertCanParent(projectPath, id, parentId);
  for (let index = 0; index < orderedIds.length; index += 1) {
    await exec(projectPath, "UPDATE ek_scenario_node SET parent_id = ?1, position = ?2 WHERE id = ?3", [parentId, index, orderedIds[index]]);
  }
}

/** Delete a node, its descendants, and their rich-text files. Children go first so the parent reference stays valid. */
export async function deleteScenarioNode(projectPath: string, id: string) {
  if (id === TRASH_ID) throw new Error("trash");
  await ensureScenarioSchema(projectPath);
  const ids: string[] = [];
  async function collect(current: string) {
    const children = await listChildNodes(projectPath, current);
    for (const child of children) await collect(child.id);
    ids.push(current);
  }
  await collect(id);
  await exec(projectPath, "BEGIN");
  try {
    for (const current of ids) {
      await exec(projectPath, "DELETE FROM ek_scenario_actor_link WHERE node_id = ?1", [current]);
      await exec(projectPath, "DELETE FROM ek_scenario_node WHERE id = ?1", [current]);
    }
    await exec(projectPath, "COMMIT");
  } catch (error) {
    await exec(projectPath, "ROLLBACK");
    throw error;
  }
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
  const rows = await query<ActorRow>(
    projectPath,
    `SELECT ${ACTOR_COLUMNS} FROM ek_scenario_actor ORDER BY position`,
  );
  const skillRows = await query<SkillRow>(
    projectPath,
    "SELECT actor_id, name, value FROM ek_scenario_actor_skill ORDER BY position",
  );
  const skills = new Map<string, ScenarioSkill[]>();
  for (const skill of skillRows) {
    const list = skills.get(skill.actor_id) ?? [];
    list.push({ name: skill.name, value: skill.value });
    skills.set(skill.actor_id, list);
  }
  const attackRows = await query<AttackRow>(
    projectPath,
    "SELECT actor_id, name, chance, damage, uses, note FROM ek_scenario_actor_attack ORDER BY position",
  );
  const attacks = new Map<string, ScenarioAttack[]>();
  for (const attack of attackRows) {
    const list = attacks.get(attack.actor_id) ?? [];
    list.push({ name: attack.name, chance: attack.chance, damage: attack.damage, uses: attack.uses, note: attack.note });
    attacks.set(attack.actor_id, list);
  }
  const linkRows = await query<{ actor_id: string; node_id: string }>(
    projectPath,
    "SELECT actor_id, node_id FROM ek_scenario_actor_link",
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
  await exec(projectPath, "BEGIN");
  try {
    await exec(
      projectPath,
      `INSERT INTO ek_scenario_actor (${ACTOR_COLUMNS}, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM ek_scenario_actor))`,
      actorValues(actor),
    );
    await writeActorSkills(projectPath, actor);
    await writeActorAttacks(projectPath, actor);
    await writeActorLinks(projectPath, actor);
    await exec(projectPath, "COMMIT");
  } catch (error) {
    await exec(projectPath, "ROLLBACK");
    throw error;
  }
}

export async function updateScenarioActor(projectPath: string, actor: ScenarioActor) {
  await ensureScenarioSchema(projectPath);
  await exec(projectPath, "BEGIN");
  try {
    await exec(
      projectPath,
      `UPDATE ek_scenario_actor SET
         kind = ?2, name = ?3, age = ?4, gender = ?5, occupation = ?6, portrait = ?7,
         str = ?8, con = ?9, siz = ?10, dex = ?11, app = ?12, intellect = ?13, pow = ?14, edu = ?15, luck = ?16,
         hp = ?17, mp = ?18, san = ?19, damage = ?20, build = ?21, mov = ?22,
         appearance = ?23, portrayal = ?24, backstory = ?25, notes = ?26, native_language = ?27
       WHERE id = ?1`,
      actorValues(actor),
    );
    await writeActorSkills(projectPath, actor);
    await writeActorAttacks(projectPath, actor);
    await writeActorLinks(projectPath, actor);
    await exec(projectPath, "COMMIT");
  } catch (error) {
    await exec(projectPath, "ROLLBACK");
    throw error;
  }
}

async function writeActorSkills(projectPath: string, actor: ScenarioActor) {
  await exec(projectPath, "DELETE FROM ek_scenario_actor_skill WHERE actor_id = ?1", [actor.id]);
  for (let index = 0; index < actor.skills.length; index += 1) {
    const skill = actor.skills[index];
    await exec(
      projectPath,
      "INSERT INTO ek_scenario_actor_skill (actor_id, position, name, value) VALUES (?1, ?2, ?3, ?4)",
      [actor.id, index, skill.name, skill.value],
    );
  }
}

async function writeActorLinks(projectPath: string, actor: ScenarioActor) {
  await exec(projectPath, "DELETE FROM ek_scenario_actor_link WHERE actor_id = ?1", [actor.id]);
  for (const nodeId of actor.links) {
    await exec(
      projectPath,
      "INSERT INTO ek_scenario_actor_link (actor_id, node_id) VALUES (?1, ?2)",
      [actor.id, nodeId],
    );
  }
}

async function writeActorAttacks(projectPath: string, actor: ScenarioActor) {
  await exec(projectPath, "DELETE FROM ek_scenario_actor_attack WHERE actor_id = ?1", [actor.id]);
  for (let index = 0; index < actor.attacks.length; index += 1) {
    const attack = actor.attacks[index];
    await exec(
      projectPath,
      "INSERT INTO ek_scenario_actor_attack (actor_id, position, name, chance, damage, uses, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [actor.id, index, attack.name, attack.chance, attack.damage, attack.uses, attack.note],
    );
  }
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
