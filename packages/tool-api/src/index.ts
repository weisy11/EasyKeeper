import type { ComponentType } from "react";

export type LText = { zh: string; en: string };

export type ToolRegion = "center" | "left" | "right" | "bottom";

export type ToolPanelProps = {
  panelId: string;
  /** Open project directory. Empty when no project is open. */
  projectPath: string;
  /** Scenario directory for a game record. Empty in prep. */
  modulePath?: string | null;
  mode?: "prep" | "play";
  /** Play mode writes the scenario only while this is on. Prep ignores it. */
  moduleEditable?: boolean;
  /** Host-owned lookup. A tool asks for another tool's published data through this. */
  loadModuleData?: (toolId: string) => Promise<ModuleDataSource | null>;
};

export type ToolPanelDef = {
  id: string;
  title?: LText;
  component: ComponentType<ToolPanelProps>;
};

export type ModuleRecordKind = "scene" | "actor" | "article";

export type SceneListNode = {
  id: string;
  kind: "scene" | "event";
  title: string;
  position: number;
  children: SceneListNode[];
};

export type ActorListItem = {
  id: string;
  kind: "npc" | "monster";
  name: string;
  position: number;
  sceneIds: string[];
};

export type ArticleListItem = {
  id: string;
  kind: "clue" | "item";
  name: string;
  position: number;
  sceneIds: string[];
};

export type SceneRecord = {
  id: string;
  kind: "scene" | "event";
  parentId: string | null;
  title: string;
  position: number;
  /** Editor document, stored as-is. */
  body: unknown;
};

export type ActorSkillRecord = { name: string; value: number };

export type ActorAttackRecord = { name: string; chance: number; damage: string; uses: string; note: string };

export type ActorRecord = {
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
  skills: ActorSkillRecord[];
  attacks: ActorAttackRecord[];
  sceneIds: string[];
  position: number;
};

export type ArticleRecord = {
  id: string;
  kind: "clue" | "item";
  name: string;
  description: string;
  position: number;
  sceneIds: string[];
  actorIds: string[];
};

export type ModuleRecord = SceneRecord | ActorRecord | ArticleRecord;

/** The scene or event open in the scenario editor. Absent when that panel has no selection. */
export type CurrentScene = { id: string };

/** Scenario-owned reads. Other tools ask the host, which forwards here. */
export type ModuleDataSource = {
  listScenes(moduleDir: string): Promise<SceneListNode[]>;
  listActors(moduleDir: string): Promise<ActorListItem[]>;
  listArticles(moduleDir: string): Promise<ArticleListItem[]>;
  readModuleRecord(moduleDir: string, kind: ModuleRecordKind, id: string): Promise<ModuleRecord | null>;
  currentScene(moduleDir: string): Promise<CurrentScene | null>;
};

export type ToolDefinition = {
  id: string;
  title: LText;
  /** Lucide icon component or any React component used as icon. */
  icon: ComponentType<{ className?: string }>;
  region?: ToolRegion;
  minWidth?: number;
  minHeight?: number;
  /** Tool ids that must be started before this tool. Omit or [] = none. */
  dependencies?: string[];
  /** Published data. Present when this tool can answer another tool's reads. */
  moduleData?: ModuleDataSource;
  panels: ToolPanelDef[];
  /**
   * Called by the host when this tool's window is closed.
   * Release this instance (WebGL, audio, listeners). Loaded code stays until the app exits.
   */
  dispose?: () => void | Promise<void>;
};

export function defineTool(def: ToolDefinition): ToolDefinition {
  return { ...def, dependencies: def.dependencies ?? [] };
}
