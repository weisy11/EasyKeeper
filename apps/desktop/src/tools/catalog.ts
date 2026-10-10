import type { ComponentType } from "react";
import { BookOpenIcon, DicesIcon, SquareIcon, type LucideIcon } from "lucide-react";
import type { LText } from "@/lib/i18n";
import type { ToolDefinition } from "@ek/tool-api";

export type BuiltinToolMeta = {
  id: string;
  title: LText;
  icon: LucideIcon;
  /** If true on first launch (no saved allow-list), tool appears in the open menu. */
  defaultAllowed: boolean;
  /** Load thin tool entry only — must not pull vendor/three. */
  load: () => Promise<ToolDefinition>;
};

export const BUILTIN_CATALOG: BuiltinToolMeta[] = [
  {
    id: "ek.dice",
    title: { zh: "骰子", en: "Dice" },
    icon: DicesIcon,
    defaultAllowed: true,
    load: () => import("@ek-tool/dice").then((m) => m.diceTool),
  },
  {
    id: "ek.scenario",
    title: { zh: "模组", en: "Scenario" },
    icon: BookOpenIcon,
    defaultAllowed: true,
    load: () => import("@ek-tool/scenario").then((m) => m.scenarioTool),
  },
];

export const CATALOG_MAP = Object.fromEntries(BUILTIN_CATALOG.map((t) => [t.id, t]));

export const UNKNOWN_ICON = SquareIcon;

export type Region = "center" | "left" | "right" | "bottom";

/** Menu / chrome metadata (not the live loaded definition). */
export type ToolDef = {
  id: string;
  title: LText;
  icon: LucideIcon | ComponentType<{ className?: string }>;
  region: Region;
  minWidth: number;
  minHeight: number;
};

export const TOOLS: ToolDef[] = BUILTIN_CATALOG.map((t) => ({
  id: t.id,
  title: t.title,
  icon: t.icon,
  region: "center",
  minWidth: 240,
  minHeight: 160,
}));

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
