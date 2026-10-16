import { invoke } from "@tauri-apps/api/core";

/**
 * Game-record database at `{record}/data/project.sqlite`.
 * Tables stay on the scenario tool prefix. Add a statement to SCHEMA, then a load/save pair.
 * Scenario files keep the starting values. This file keeps what changes during play.
 */
const TOOL_PREFIX = "ek_scenario_";

type SqlValue = string | number | null;

export type RecordActorVitals = {
  actorId: string;
  hp: number;
  mp: number;
  san: number;
  luck: number;
};

function databaseReady() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function exec(projectPath: string, sql: string, params: SqlValue[] = []) {
  await invoke("project_db_exec", { projectPath, toolPrefix: TOOL_PREFIX, sql, params });
}

async function query<T>(projectPath: string, sql: string, params: SqlValue[] = []): Promise<T[]> {
  return invoke<T[]>("project_db_query", { projectPath, toolPrefix: TOOL_PREFIX, sql, params });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ek_scenario_record_actor (
    actor_id TEXT PRIMARY KEY,
    hp INTEGER NOT NULL,
    mp INTEGER NOT NULL,
    san INTEGER NOT NULL,
    luck INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_record_article (
    article_id TEXT PRIMARY KEY
  )`,
  `CREATE TABLE IF NOT EXISTS ek_scenario_record_monster (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    hp INTEGER NOT NULL,
    mp INTEGER NOT NULL,
    san INTEGER NOT NULL,
    luck INTEGER NOT NULL
  )`,
];

export async function loadFoundArticles(recordPath: string): Promise<string[]> {
  if (!databaseReady() || !recordPath) return [];
  await ensureRecordSchema(recordPath);
  const rows = await query<{ article_id: string }>(recordPath, "SELECT article_id FROM ek_scenario_record_article");
  return rows.map((row) => row.article_id);
}

export async function discoverArticle(recordPath: string, articleId: string) {
  if (!databaseReady() || !recordPath) return;
  await ensureRecordSchema(recordPath);
  await exec(recordPath, "INSERT INTO ek_scenario_record_article (article_id) VALUES (?1) ON CONFLICT(article_id) DO NOTHING", [articleId]);
}

export async function resetArticle(recordPath: string, articleId: string) {
  if (!databaseReady() || !recordPath) return;
  await ensureRecordSchema(recordPath);
  await exec(recordPath, "DELETE FROM ek_scenario_record_article WHERE article_id = ?1", [articleId]);
}

export async function ensureRecordSchema(recordPath: string) {
  if (!databaseReady() || !recordPath) return;
  for (const sql of SCHEMA) await exec(recordPath, sql);
}

type ActorRow = { actor_id: string; hp: number; mp: number; san: number; luck: number };

function actorFromRow(row: ActorRow): RecordActorVitals {
  return { actorId: row.actor_id, hp: row.hp, mp: row.mp, san: row.san, luck: row.luck };
}

/** Current vitals for this game. An id with no row still uses the scenario's initial values. */
export async function loadRecordActors(recordPath: string): Promise<RecordActorVitals[]> {
  if (!databaseReady() || !recordPath) return [];
  await ensureRecordSchema(recordPath);
  const rows = await query<ActorRow>(recordPath, "SELECT actor_id, hp, mp, san, luck FROM ek_scenario_record_actor");
  return rows.map(actorFromRow);
}

/** Copy scenario starting values into the record once. Later play changes are left alone. */
export async function seedRecordActors(recordPath: string, actors: RecordActorVitals[]) {
  if (!databaseReady() || !recordPath || actors.length === 0) return;
  await ensureRecordSchema(recordPath);
  for (const actor of actors) {
    await exec(
      recordPath,
      `INSERT INTO ek_scenario_record_actor (actor_id, hp, mp, san, luck)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(actor_id) DO NOTHING`,
      [actor.actorId, actor.hp, actor.mp, actor.san, actor.luck],
    );
  }
}

export type RecordMonster = {
  id: string;
  actorId: string;
  position: number;
  hp: number;
  mp: number;
  san: number;
  luck: number;
};

type MonsterRow = { id: string; actor_id: string; position: number; hp: number; mp: number; san: number; luck: number };

function monsterFromRow(row: MonsterRow): RecordMonster {
  return { id: row.id, actorId: row.actor_id, position: row.position, hp: row.hp, mp: row.mp, san: row.san, luck: row.luck };
}

export async function loadRecordMonsters(recordPath: string): Promise<RecordMonster[]> {
  if (!databaseReady() || !recordPath) return [];
  await ensureRecordSchema(recordPath);
  const rows = await query<MonsterRow>(
    recordPath,
    "SELECT id, actor_id, position, hp, mp, san, luck FROM ek_scenario_record_monster ORDER BY position, id",
  );
  return rows.map(monsterFromRow);
}

/** One creature of this monster type, starting from the scenario's initial vitals. */
export async function insertRecordMonster(recordPath: string, actorId: string, vitals: { hp: number; mp: number; san: number; luck: number }): Promise<RecordMonster | null> {
  if (!databaseReady() || !recordPath) return null;
  await ensureRecordSchema(recordPath);
  const id = crypto.randomUUID();
  const positions = await query<{ position: number | null }>(recordPath, "SELECT MAX(position) AS position FROM ek_scenario_record_monster WHERE actor_id = ?1", [actorId]);
  const position = (positions[0]?.position ?? -1) + 1;
  await exec(
    recordPath,
    "INSERT INTO ek_scenario_record_monster (id, actor_id, position, hp, mp, san, luck) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    [id, actorId, position, vitals.hp, vitals.mp, vitals.san, vitals.luck],
  );
  const rows = await query<MonsterRow>(recordPath, "SELECT id, actor_id, position, hp, mp, san, luck FROM ek_scenario_record_monster WHERE id = ?1", [id]);
  return rows[0] ? monsterFromRow(rows[0]) : null;
}

export async function saveRecordMonster(recordPath: string, monster: Pick<RecordMonster, "id" | "hp" | "mp" | "san" | "luck">) {
  if (!databaseReady() || !recordPath) return;
  await ensureRecordSchema(recordPath);
  await exec(
    recordPath,
    "UPDATE ek_scenario_record_monster SET hp = ?1, mp = ?2, san = ?3, luck = ?4 WHERE id = ?5",
    [monster.hp, monster.mp, monster.san, monster.luck, monster.id],
  );
}

export async function saveRecordActor(recordPath: string, actor: RecordActorVitals) {
  if (!databaseReady() || !recordPath) return;
  await ensureRecordSchema(recordPath);
  await exec(
    recordPath,
    `INSERT INTO ek_scenario_record_actor (actor_id, hp, mp, san, luck)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(actor_id) DO UPDATE SET hp = ?2, mp = ?3, san = ?4, luck = ?5`,
    [actor.actorId, actor.hp, actor.mp, actor.san, actor.luck],
  );
}
