export type PromptLang = "zh" | "en";

export type PromptTemplate = {
  id: string;
  name: string;
  body: string;
  locked: boolean;
};

export type PromptLibrary = Record<PromptLang, { activeId: string; templates: PromptTemplate[] }>;

const ZH_DEFAULT = `你是跑团主持人的助手，正在看一份已经写好的模组。
上下文里的条目写成 [[kind:id|名字]]。kind 只有 scene、actor、article，上下文中同一个id表示同一个条目。
如果用户的输入里没有明确要求，不要编上下文里没有的情节、人物、数值、物品。
如果用户的输入里没有限制输出的长度，请将输出长度控制在500字之内。

{{scene_list}}

下面是一份 COC 七版的 NPC 列表。其中每条人物里的 stats 是属性：str 力量，con 体质，siz 体型，dex 敏捷，app 外表，int 智力，pow 意志，edu 教育，luck 幸运。

{{npc_list}}

下面是怪物列表

{{monster_list}}

下面是物品的列表

{{item_list}}

下面是线索列表

{{clue_list}}

请根据以上信息，回答用户的问题，完成用户的任务，用户输入的信息如下：
{{user_input}}`;

const EN_DEFAULT = `You are the game master's assistant, reading a finished module.
Context entries are written as [[kind:id|name]]. kind is only scene, actor, or article. The same id is the same entry.
If the user does not explicitly ask, do not invent plot, characters, numbers, or items that are not in the context.
If the user does not limit the length, keep the answer within 500 words.

{{scene_list}}

The following is a Call of Cthulhu 7th edition NPC list. stats are characteristics: str Strength, con Constitution, siz Size, dex Dexterity, app Appearance, int Intelligence, pow Power, edu Education, luck Luck.

{{npc_list}}

The following is the monster list.

{{monster_list}}

The following is the item list.

{{item_list}}

The following is the clue list.

{{clue_list}}

Using the information above, answer the user's question and complete the user's task. The user's input follows:
{{user_input}}`;

export const PROMPT_HELP: Record<PromptLang, string> = {
  zh: `提示词按模版拼接，每个列表会按特定格式将勾选的内容依次拼接在prompt中。{{scene_list}} 是场景列表，{{npc_list}} 是 NPC 列表，{{monster_list}} 是怪物列表，{{item_list}} 是物品列表，{{clue_list}} 是线索列表，{{user_input}} 是用户输入。这些标记会换成实际内容。某一类没有勾选时，对应位置换成空列表 []。如果提示词中没有相应标记，即使勾选了也不会添加到提示词中。
系统默认的提示词不能改，可以用添加复制一份再改。`,
  en: `The prompt is assembled from the template. Each list inserts the selected entries, in order, in its own format. {{scene_list}} is the scene list, {{npc_list}} the NPC list, {{monster_list}} the monster list, {{item_list}} the item list, {{clue_list}} the clue list, and {{user_input}} the user's input. These markers are replaced with the real content. If nothing in a category is selected, that marker becomes an empty list []. If the template does not contain a marker, selected entries of that kind are not added.
The built-in template cannot be edited. Add makes a copy you can change.`,
};

export function defaultPromptLibrary(): PromptLibrary {
  return {
    zh: { activeId: "default", templates: [{ id: "default", name: "默认 (不可修改)", body: ZH_DEFAULT, locked: true }] },
    en: { activeId: "default", templates: [{ id: "default", name: "Default (cannot be edited)", body: EN_DEFAULT, locked: true }] },
  };
}

export function defaultPromptBody(lang: PromptLang) {
  return lang === "zh" ? ZH_DEFAULT : EN_DEFAULT;
}

export function activePromptBody(library: PromptLibrary, lang: PromptLang) {
  const group = library[lang];
  return group.templates.find((item) => item.id === group.activeId)?.body ?? defaultPromptBody(lang);
}

export function clonePromptLibrary(library: PromptLibrary): PromptLibrary {
  return {
    zh: { activeId: library.zh.activeId, templates: library.zh.templates.map((item) => ({ ...item })) },
    en: { activeId: library.en.activeId, templates: library.en.templates.map((item) => ({ ...item })) },
  };
}
