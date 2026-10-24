import { invoke } from "@tauri-apps/api/core";
import { readProjectImageBase64, writeProjectImageBase64 } from "@ek/tool-api";
import { emptyInvestigator, type Fellow, type Investigator, type Skill, type Weapon } from "./db";
import { md5 } from "./md5";

const KIND = "ek.investigators";
const FILE_NAME = "investigators.json";
const IMAGE_SRC = /^images\/([^/\\]+)$/;

type InvestigatorFile = {
  kind: typeof KIND;
  investigators: Investigator[];
};

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickExportFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("pick_export_folder");
  } catch {
    return pickFolder();
  }
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true, multiple: false });
  if (!path || Array.isArray(path)) return null;
  return path;
}

export async function createTimestampedFolder(parent: string, label: string): Promise<string> {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const base = `${label.trim() || "export"}-${stamp}`;
  let path = await invoke<string>("join_path", { parent, name: base });
  if (await invoke<boolean>("path_exists", { path })) {
    path = await invoke<string>("join_path", { parent, name: `${base}-${now.getMilliseconds()}` });
  }
  await invoke("ensure_dir", { path });
  return path;
}

export async function writeInvestigatorFolder(folder: string, projectPath: string, investigators: Investigator[]) {
  const copied = new Set<string>();
  for (const person of investigators) {
    const filename = imageName(person.portrait);
    if (!filename || copied.has(person.portrait)) continue;
    const contents = await readProjectImageBase64(projectPath, person.portrait);
    if (!contents) continue;
    const images = await invoke<string>("join_path", { parent: folder, name: "images" });
    const path = await invoke<string>("join_path", { parent: images, name: filename });
    await invoke("write_base64_file", { path, contents });
    copied.add(person.portrait);
  }
  const file: InvestigatorFile = { kind: KIND, investigators };
  const jsonPath = await invoke<string>("join_path", { parent: folder, name: FILE_NAME });
  await invoke("write_text_file", { path: jsonPath, contents: JSON.stringify(file) });
}

export async function readInvestigatorFolder(folder: string, projectPath: string): Promise<Investigator[] | null> {
  let parsed: unknown;
  try {
    const jsonPath = await invoke<string>("join_path", { parent: folder, name: FILE_NAME });
    parsed = JSON.parse(await invoke<string>("read_text_file", { path: jsonPath }));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const file = parsed as Partial<InvestigatorFile>;
  if (file.kind !== KIND || !Array.isArray(file.investigators)) return null;
  const rewritten = new Map<string, string>();
  const people: Investigator[] = [];
  for (const raw of file.investigators) {
    const person = personFromUnknown(raw);
    if (!person) continue;
    person.portrait = await placePortrait(folder, projectPath, person.portrait, rewritten);
    people.push(person);
  }
  return people;
}

async function placePortrait(folder: string, projectPath: string, portrait: string, rewritten: Map<string, string>) {
  const filename = imageName(portrait);
  if (!filename) return "";
  const cached = rewritten.get(portrait);
  if (cached) return cached;
  let contents: string;
  try {
    const images = await invoke<string>("join_path", { parent: folder, name: "images" });
    const path = await invoke<string>("join_path", { parent: images, name: filename });
    contents = await invoke<string>("read_base64_file", { path });
  } catch {
    return "";
  }
  const kept = `images/${filename}`;
  try {
    const images = await invoke<string>("join_path", { parent: projectPath, name: "images" });
    const path = await invoke<string>("join_path", { parent: images, name: filename });
    const current = await invoke<string>("read_base64_file", { path });
    if (md5(decodeBase64(current)) === md5(decodeBase64(contents))) {
      rewritten.set(portrait, kept);
      return kept;
    }
  } catch {
    const images = await invoke<string>("join_path", { parent: projectPath, name: "images" });
    const path = await invoke<string>("join_path", { parent: images, name: filename });
    await invoke("write_base64_file", { path, contents });
    rewritten.set(portrait, kept);
    return kept;
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
  const next = await writeProjectImageBase64(projectPath, contents, ext);
  rewritten.set(portrait, next);
  return next;
}

function imageName(portrait: string) {
  return IMAGE_SRC.exec(portrait)?.[1] ?? "";
}

function decodeBase64(contents: string) {
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function personFromUnknown(raw: unknown): Investigator | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const person = emptyInvestigator(typeof row.id === "string" ? row.id : "", whole(row.position));
  person.name = text(row.name);
  person.occupation = text(row.occupation);
  person.age = text(row.age);
  person.gender = text(row.gender);
  person.player = text(row.player);
  person.birthplace = text(row.birthplace);
  person.residence = text(row.residence);
  person.portrait = text(row.portrait);
  person.str = whole(row.str);
  person.con = whole(row.con);
  person.siz = whole(row.siz);
  person.dex = whole(row.dex);
  person.app = whole(row.app);
  person.edu = whole(row.edu);
  person.int = whole(row.int);
  person.pow = whole(row.pow);
  person.hp = whole(row.hp);
  person.mp = whole(row.mp);
  person.luck = whole(row.luck);
  person.san = whole(row.san);
  person.sanStart = whole(row.sanStart);
  person.mov = whole(row.mov);
  person.build = whole(row.build);
  person.damage = text(row.damage);
  person.dodge = whole(row.dodge);
  person.story = text(row.story);
  person.description = text(row.description);
  person.ideology = text(row.ideology);
  person.traits = text(row.traits);
  person.people = text(row.people);
  person.possessions = text(row.possessions);
  person.locations = text(row.locations);
  person.injuries = text(row.injuries);
  person.phobias = text(row.phobias);
  person.tomes = text(row.tomes);
  person.spells = text(row.spells);
  person.encounters = text(row.encounters);
  person.gear = text(row.gear);
  person.cash = text(row.cash);
  person.assets = text(row.assets);
  person.weapons = list(row.weapons).map(weaponFromUnknown).filter((item): item is Weapon => item !== null);
  person.skills = list(row.skills).map(skillFromUnknown).filter((item): item is Skill => item !== null);
  person.fellows = list(row.fellows).map(fellowFromUnknown).filter((item): item is Fellow => item !== null);
  return person;
}

function weaponFromUnknown(raw: unknown): Weapon | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    name: text(row.name),
    skill: text(row.skill),
    damage: text(row.damage),
    attacks: text(row.attacks),
    range: text(row.range),
    ammo: text(row.ammo),
    malfunction: text(row.malfunction),
  };
}

function skillFromUnknown(raw: unknown): Skill | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return { name: text(row.name), value: whole(row.value) };
}

function fellowFromUnknown(raw: unknown): Fellow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return { player: text(row.player), investigator: text(row.investigator) };
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function whole(value: unknown) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : 0;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}
