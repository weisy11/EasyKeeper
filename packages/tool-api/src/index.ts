import type { ComponentType } from "react";

export type LText = { zh: string; en: string };

export type ToolRegion = "center" | "left" | "right" | "bottom";

export type ToolPanelProps = {
  panelId: string;
  /** Open project directory. Empty when no project is open. */
  projectPath: string;
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
   * Must release third-party runtime resources (WebGL, audio, listeners, caches).
   */
  dispose?: () => void | Promise<void>;
  /** Host sets/reads whether heavy deps were dynamically loaded this session. */
  markHeavyLoaded?: () => void;
  wasHeavyLoaded?: () => boolean;
};

export function defineTool(def: ToolDefinition): ToolDefinition {
  let heavy = false;
  return {
    ...def,
    dependencies: def.dependencies ?? [],
    markHeavyLoaded: () => {
      heavy = true;
      def.markHeavyLoaded?.();
    },
    wasHeavyLoaded: () => heavy || def.wasHeavyLoaded?.() === true,
  };
}
