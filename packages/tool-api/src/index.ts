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
};

export type ToolPanelDef = {
  id: string;
  title?: LText;
  component: ComponentType<ToolPanelProps>;
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
