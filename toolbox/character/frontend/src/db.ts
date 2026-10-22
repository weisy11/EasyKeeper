import { serial } from "@ek/tool-api";
import { invoke } from "@tauri-apps/api/core";

/** Player-character rows in the open project's sqlite file. */
const TOOL_PREFIX = "ek_character_";

type SqlValue = string | number | null;

function databaseReady() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function exec(projectPath: string, sql: string, params: SqlValue[] = []) {
  await serial(projectPath, () => invoke("project_db_exec", { projectPath, toolPrefix: TOOL_PREFIX, sql, params }));
}

async function query<T>(projectPath: string, sql: string, params: SqlValue[] = []): Promise<T[]> {
  return serial(projectPath, () => invoke<T[]>("project_db_query", { projectPath, toolPrefix: TOOL_PREFIX, sql, params }));
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS ek_character_investigator (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  player TEXT NOT NULL DEFAULT '',
  birthplace TEXT NOT NULL DEFAULT '',
  residence TEXT NOT NULL DEFAULT '',
  portrait TEXT NOT NULL DEFAULT '',
  str INTEGER NOT NULL DEFAULT 0,
  con INTEGER NOT NULL DEFAULT 0,
  siz INTEGER NOT NULL DEFAULT 0,
  dex INTEGER NOT NULL DEFAULT 0,
  app INTEGER NOT NULL DEFAULT 0,
  edu INTEGER NOT NULL DEFAULT 0,
  intellect INTEGER NOT NULL DEFAULT 0,
  pow INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 0,
  mp INTEGER NOT NULL DEFAULT 0,
  luck INTEGER NOT NULL DEFAULT 0,
  san INTEGER NOT NULL DEFAULT 0,
  san_start INTEGER NOT NULL DEFAULT 0,
  mov INTEGER NOT NULL DEFAULT 0,
  build INTEGER NOT NULL DEFAULT 0,
  damage TEXT NOT NULL DEFAULT '',
  dodge INTEGER NOT NULL DEFAULT 0,
  story TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ideology TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '',
  significant_people TEXT NOT NULL DEFAULT '',
  treasured TEXT NOT NULL DEFAULT '',
  locations TEXT NOT NULL DEFAULT '',
  injuries TEXT NOT NULL DEFAULT '',
  phobias TEXT NOT NULL DEFAULT '',
  tomes TEXT NOT NULL DEFAULT '',
  spells TEXT NOT NULL DEFAULT '',
  encounters TEXT NOT NULL DEFAULT '',
  gear TEXT NOT NULL DEFAULT '',
  cash TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '',
  weapons TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  fellows TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0
)`;

export type Skill = { name: string; value: number };

export type Weapon = {
  name: string;
  skill: string;
  damage: string;
  attacks: string;
  range: string;
  ammo: string;
  malfunction: string;
};

export type Fellow = { player: string; investigator: string };

export type Investigator = {
  id: string;
  name: string;
  occupation: string;
  age: string;
  gender: string;
  player: string;
  birthplace: string;
  residence: string;
  portrait: string;
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  edu: number;
  int: number;
  pow: number;
  hp: number;
  mp: number;
  luck: number;
  san: number;
  sanStart: number;
  mov: number;
  build: number;
  damage: string;
  dodge: number;
  story: string;
  description: string;
  ideology: string;
  traits: string;
  people: string;
  possessions: string;
  locations: string;
  injuries: string;
  phobias: string;
  tomes: string;
  spells: string;
  encounters: string;
  gear: string;
  cash: string;
  assets: string;
  weapons: Weapon[];
  skills: Skill[];
  fellows: Fellow[];
  position: number;
};

type Row = {
  id: string;
  name: string;
  occupation: string;
  age: string;
  gender: string;
  player: string;
  birthplace: string;
  residence: string;
  portrait: string;
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  edu: number;
  intellect: number;
  pow: number;
  hp: number;
  mp: number;
  luck: number;
  san: number;
  san_start: number;
  mov: number;
  build: number;
  damage: string;
  dodge: number;
  story: string;
  description: string;
  ideology: string;
  traits: string;
  significant_people: string;
  treasured: string;
  locations: string;
  injuries: string;
  phobias: string;
  tomes: string;
  spells: string;
  encounters: string;
  gear: string;
  cash: string;
  assets: string;
  weapons: string;
  skills: string;
  fellows: string;
  position: number;
};

function listOf<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function fromRow(row: Row): Investigator {
  return {
    id: row.id,
    name: row.name,
    occupation: row.occupation,
    age: row.age,
    gender: row.gender,
    player: row.player,
    birthplace: row.birthplace,
    residence: row.residence,
    portrait: row.portrait,
    str: row.str,
    con: row.con,
    siz: row.siz,
    dex: row.dex,
    app: row.app,
    edu: row.edu,
    int: row.intellect,
    pow: row.pow,
    hp: row.hp,
    mp: row.mp,
    luck: row.luck,
    san: row.san,
    sanStart: row.san_start,
    mov: row.mov,
    build: row.build,
    damage: row.damage,
    dodge: row.dodge,
    story: row.story,
    description: row.description,
    ideology: row.ideology,
    traits: row.traits,
    people: row.significant_people,
    possessions: row.treasured,
    locations: row.locations,
    injuries: row.injuries,
    phobias: row.phobias,
    tomes: row.tomes,
    spells: row.spells,
    encounters: row.encounters,
    gear: row.gear,
    cash: row.cash,
    assets: row.assets,
    weapons: listOf<Weapon>(row.weapons),
    skills: listOf<Skill>(row.skills),
    fellows: listOf<Fellow>(row.fellows),
    position: row.position,
  };
}

export function emptyInvestigator(id: string, position: number): Investigator {
  return {
    id,
    name: "",
    occupation: "",
    age: "",
    gender: "",
    player: "",
    birthplace: "",
    residence: "",
    portrait: "",
    str: 0,
    con: 0,
    siz: 0,
    dex: 0,
    app: 0,
    edu: 0,
    int: 0,
    pow: 0,
    hp: 0,
    mp: 0,
    luck: 0,
    san: 0,
    sanStart: 0,
    mov: 0,
    build: 0,
    damage: "",
    dodge: 0,
    story: "",
    description: "",
    ideology: "",
    traits: "",
    people: "",
    possessions: "",
    locations: "",
    injuries: "",
    phobias: "",
    tomes: "",
    spells: "",
    encounters: "",
    gear: "",
    cash: "",
    assets: "",
    weapons: [],
    skills: [],
    fellows: [],
    position,
  };
}

export function canSaveInvestigators() {
  return databaseReady();
}

const schemaReady = new Map<string, Promise<void>>();

/** Runs the schema and migrations once per project path. A failed attempt is forgotten so the next call retries. */
function ensureSchema(projectPath: string): Promise<void> {
  const pending = schemaReady.get(projectPath);
  if (pending) return pending;
  const next = applySchema(projectPath).catch((error: unknown) => {
    schemaReady.delete(projectPath);
    throw error;
  });
  schemaReady.set(projectPath, next);
  return next;
}

async function applySchema(projectPath: string) {
  await exec(projectPath, SCHEMA);
  const columns = await query<{ name: string }>(projectPath, "PRAGMA table_info(ek_character_investigator)");
  if (!columns.some((column) => column.name === "player") && columns.some((column) => column.name === "pronoun")) {
    await exec(projectPath, "ALTER TABLE ek_character_investigator ADD COLUMN player TEXT NOT NULL DEFAULT ''");
    await exec(projectPath, "UPDATE ek_character_investigator SET player = pronoun");
  }
  if (!columns.some((column) => column.name === "portrait")) {
    await exec(projectPath, "ALTER TABLE ek_character_investigator ADD COLUMN portrait TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((column) => column.name === "skills")) {
    await exec(projectPath, "ALTER TABLE ek_character_investigator ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'");
  }
}

export async function loadInvestigators(projectPath: string): Promise<Investigator[]> {
  if (!databaseReady() || !projectPath) return [];
  await ensureSchema(projectPath);
  const rows = await query<Row>(projectPath, "SELECT * FROM ek_character_investigator ORDER BY position, id");
  return rows.map(fromRow);
}

export async function saveInvestigator(projectPath: string, investigator: Investigator) {
  if (!databaseReady() || !projectPath) return;
  await ensureSchema(projectPath);
  await exec(
    projectPath,
    `INSERT INTO ek_character_investigator (
      id, name, occupation, age, gender, player, birthplace, residence,
      str, con, siz, dex, app, edu, intellect, pow, hp, mp, luck, san, san_start,
      mov, build, damage, dodge, story, description, ideology, traits, significant_people,
      treasured, locations, injuries, phobias, tomes, spells, encounters, gear, cash, assets,
      weapons, fellows, position, portrait, skills
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
      ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
      ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
      ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40,
      ?41, ?42, ?43, ?44, ?45
    )
    ON CONFLICT(id) DO UPDATE SET
      name = ?2, occupation = ?3, age = ?4, gender = ?5, player = ?6, birthplace = ?7, residence = ?8, portrait = ?44,
      str = ?9, con = ?10, siz = ?11, dex = ?12, app = ?13, edu = ?14, intellect = ?15, pow = ?16,
      hp = ?17, mp = ?18, luck = ?19, san = ?20, san_start = ?21,
      mov = ?22, build = ?23, damage = ?24, dodge = ?25, story = ?26, description = ?27, ideology = ?28,
      traits = ?29, significant_people = ?30, treasured = ?31, locations = ?32, injuries = ?33, phobias = ?34,
      tomes = ?35, spells = ?36, encounters = ?37, gear = ?38, cash = ?39, assets = ?40,
      weapons = ?41, fellows = ?42, position = ?43, skills = ?45`,
    [
      investigator.id, investigator.name, investigator.occupation, investigator.age, investigator.gender, investigator.player, investigator.birthplace, investigator.residence,
      investigator.str, investigator.con, investigator.siz, investigator.dex, investigator.app, investigator.edu, investigator.int, investigator.pow,
      investigator.hp, investigator.mp, investigator.luck, investigator.san, investigator.sanStart,
      investigator.mov, investigator.build, investigator.damage, investigator.dodge, investigator.story, investigator.description, investigator.ideology,
      investigator.traits, investigator.people, investigator.possessions, investigator.locations, investigator.injuries, investigator.phobias,
      investigator.tomes, investigator.spells, investigator.encounters, investigator.gear, investigator.cash, investigator.assets,
      JSON.stringify(investigator.weapons), JSON.stringify(investigator.fellows), investigator.position, investigator.portrait, JSON.stringify(investigator.skills),
    ],
  );
}

export async function deleteInvestigator(projectPath: string, id: string) {
  if (!databaseReady() || !projectPath) return;
  await ensureSchema(projectPath);
  await exec(projectPath, "DELETE FROM ek_character_investigator WHERE id = ?1", [id]);
}
