import type { ComponentType } from "react";
import { UserIcon } from "lucide-react";
import { defineTool } from "@ek/tool-api";
import { CharacterPanel } from "./panels/CharacterPanel";

export const characterTool = defineTool({
  id: "ek.character",
  title: { zh: "角色", en: "Character" },
  icon: UserIcon as ComponentType<{ className?: string }>,
  region: "center",
  // Same floor as the scenario tool: 480px for this column plus 240px for the side
  // column keeps the fixed two-column workspace at 720px.
  minWidth: 480,
  minHeight: 420,
  dependencies: [],
  panels: [{ id: "sheet", component: CharacterPanel }],
});
