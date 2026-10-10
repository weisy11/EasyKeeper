/** Scenario tool UI strings. Locale follows host `document.documentElement.lang`. */

export type ScenarioLocale = "zh" | "en";

const strings = {
  scenes: { zh: "场景", en: "Scenes" },
  body: { zh: "描述、原文", en: "Description" },
  npcs: { zh: "NPC 和怪物", en: "NPCs and monsters" },
  clues: { zh: "线索和物品", en: "Clues and items" },
  map: { zh: "地图", en: "Map" },
  placeholder: { zh: "在这里写描述和原文，也可以粘贴图片。", en: "Write here. You can paste images." },
  bold: { zh: "粗体", en: "Bold" },
  italic: { zh: "斜体", en: "Italic" },
  strike: { zh: "删除线", en: "Strikethrough" },
  code: { zh: "代码", en: "Code" },
  bodyText: { zh: "正文", en: "Body" },
  heading1: { zh: "标题 1", en: "Heading 1" },
  heading2: { zh: "标题 2", en: "Heading 2" },
  heading3: { zh: "标题 3", en: "Heading 3" },
  heading4: { zh: "标题 4", en: "Heading 4" },
  heading5: { zh: "标题 5", en: "Heading 5" },
  font: { zh: "字体", en: "Font" },
  fontDefault: { zh: "默认", en: "Default" },
  fontSans: { zh: "无衬线", en: "Sans" },
  fontMono: { zh: "等宽", en: "Mono" },
  textColor: { zh: "文字颜色", en: "Text color" },
  highlight: { zh: "背景颜色", en: "Highlight color" },
  findReplace: { zh: "查找替换", en: "Find and replace" },
  find: { zh: "查找", en: "Find" },
  replaceWith: { zh: "替换为", en: "Replace with" },
  replace: { zh: "替换", en: "Replace" },
  replaceAll: { zh: "全部替换", en: "Replace all" },
  previous: { zh: "上一处", en: "Previous" },
  next: { zh: "下一处", en: "Next" },
  bullet: { zh: "无序列表", en: "Bullet list" },
  ordered: { zh: "有序列表", en: "Numbered list" },
  more: { zh: "更多", en: "More" },
  addChildScene: { zh: "新建子场景", en: "New child scene" },
  addEvent: { zh: "新建事件", en: "New event" },
  addRootScene: { zh: "新建场景", en: "New scene" },
  rename: { zh: "重命名", en: "Rename" },
  duplicate: { zh: "复制", en: "Duplicate" },
  moveToTrash: { zh: "移入回收站", en: "Move to trash" },
  trash: { zh: "回收站", en: "Trash" },
  resizeTrash: { zh: "调整回收站高度", en: "Resize trash" },
  deleteNode: { zh: "删除", en: "Delete" },
  untitledScene: { zh: "未命名场景", en: "Untitled scene" },
  untitledEvent: { zh: "未命名事件", en: "Untitled event" },
  catalogLoadFailed: { zh: "目录没有读出来", en: "Could not load the catalog" },
  scene1: { zh: "场景 1", en: "Scene 1" },
  event1: { zh: "事件 1", en: "Event 1" },
  event2: { zh: "事件 2", en: "Event 2" },
  scene2: { zh: "场景 2", en: "Scene 2" },
  scene3: { zh: "场景 3", en: "Scene 3" },
  person1: { zh: "人物 1", en: "Person 1" },
  person2: { zh: "人物 2", en: "Person 2" },
  monster1: { zh: "怪物 1", en: "Monster 1" },
  clue1: { zh: "线索 1", en: "Clue 1" },
  item1: { zh: "物品 1", en: "Item 1" },
  clue2: { zh: "线索 2", en: "Clue 2" },
} as const;

export type ScenarioStringKey = keyof typeof strings;

export function readScenarioLocale(): ScenarioLocale {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "zh";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function scenarioT(locale: ScenarioLocale, key: ScenarioStringKey): string {
  return strings[key][locale] ?? strings[key].zh;
}
