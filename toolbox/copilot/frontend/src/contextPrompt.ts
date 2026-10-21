import type { ActorRecord, ArticleRecord, ModuleDataSource, ModuleRecord, SceneRecord } from "@ek/tool-api";
import type { ContextTag } from "./panels/ContextDialog";

const MARKERS = ["scene_list", "npc_list", "monster_list", "item_list", "clue_list", "user_input"] as const;

type TipNode = {
  type?: string;
  text?: string;
  content?: TipNode[];
  marks?: { type?: string; attrs?: { kind?: string; id?: string } }[];
};

function mentionKind(kind: string | undefined): "scene" | "actor" | "article" | null {
  if (kind === "scene" || kind === "event") return "scene";
  if (kind === "npc" || kind === "monster" || kind === "actor") return "actor";
  if (kind === "clue" || kind === "item" || kind === "article") return "article";
  return null;
}

function inlineText(nodes: TipNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") {
        const link = node.marks?.find((mark) => mark.type === "entityLink");
        const kind = mentionKind(link?.attrs?.kind);
        const id = link?.attrs?.id;
        if (kind && id) return `[[${kind}:${id}|${node.text ?? ""}]]`;
        return node.text ?? "";
      }
      if (node.type === "hardBreak") return "\n";
      return inlineText(node.content);
    })
    .join("");
}

function sceneBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const blocks = (body as TipNode).content ?? [];
  return blocks
    .map((block) => inlineText(block.content))
    .join("\n")
    .trim();
}

function isScene(record: ModuleRecord): record is SceneRecord {
  return "body" in record && "title" in record;
}

function isActor(record: ModuleRecord): record is ActorRecord {
  return "stats" in record;
}

function isArticle(record: ModuleRecord): record is ArticleRecord {
  return "description" in record && !("stats" in record);
}

function sceneJson(record: SceneRecord) {
  return { id: record.id, title: record.title, parentId: record.parentId, body: sceneBody(record.body) };
}

function actorJson(record: ActorRecord) {
  return {
    id: record.id,
    name: record.name,
    age: record.age,
    gender: record.gender,
    occupation: record.occupation,
    nativeLanguage: record.nativeLanguage,
    stats: record.stats,
    appearance: record.appearance,
    portrayal: record.portrayal,
    backstory: record.backstory,
    notes: record.notes,
  };
}

function articleJson(record: ArticleRecord) {
  return { id: record.id, name: record.name, description: record.description };
}

/** Rough token count for mixed Chinese and JSON. Non-ASCII counts as one token. ASCII counts as one token per four characters. */
export function estimateTokens(text: string) {
  let ascii = 0;
  let tokens = 0;
  const flush = () => {
    if (ascii === 0) return;
    tokens += Math.ceil(ascii / 4);
    ascii = 0;
  };
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 128) {
      ascii += 1;
      continue;
    }
    flush();
    tokens += 1;
  }
  flush();
  return tokens;
}

function listText(items: unknown[]) {
  return JSON.stringify(items, null, 2);
}

function fillMarker(template: string, marker: (typeof MARKERS)[number], value: string) {
  const token = `{{${marker}}}`;
  if (!template.includes(token)) return template;
  return template.split(token).join(value);
}

export async function contextMessage(source: ModuleDataSource | null | undefined, moduleDir: string, tags: ContextTag[], userText: string, template: string) {
  const scenes: unknown[] = [];
  const npcs: unknown[] = [];
  const monsters: unknown[] = [];
  const items: unknown[] = [];
  const clues: unknown[] = [];
  const wanted = new Set(MARKERS.filter((marker) => template.includes(`{{${marker}}}`)));
  if (source && moduleDir && (wanted.has("scene_list") || wanted.has("npc_list") || wanted.has("monster_list") || wanted.has("item_list") || wanted.has("clue_list"))) {
    for (const tag of tags) {
      const record = await source.readModuleRecord(moduleDir, tag.kind, tag.id).catch(() => null);
      if (!record) continue;
      if (tag.kind === "scene" && wanted.has("scene_list") && isScene(record)) scenes.push(sceneJson(record));
      if (tag.kind === "actor" && isActor(record)) {
        if (record.kind === "monster" && wanted.has("monster_list")) monsters.push(actorJson(record));
        if (record.kind === "npc" && wanted.has("npc_list")) npcs.push(actorJson(record));
      }
      if (tag.kind === "article" && isArticle(record)) {
        if (record.kind === "clue" && wanted.has("clue_list")) clues.push(articleJson(record));
        if (record.kind === "item" && wanted.has("item_list")) items.push(articleJson(record));
      }
    }
  }
  let text = template;
  text = fillMarker(text, "scene_list", listText(scenes));
  text = fillMarker(text, "npc_list", listText(npcs));
  text = fillMarker(text, "monster_list", listText(monsters));
  text = fillMarker(text, "item_list", listText(items));
  text = fillMarker(text, "clue_list", listText(clues));
  text = fillMarker(text, "user_input", wanted.has("user_input") ? userText : "");
  return text;
}
