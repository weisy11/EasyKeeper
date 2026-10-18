import type { ComponentType } from "react";
import { UserIcon } from "lucide-react";
import { defineTool } from "@ek/tool-api";
import { CharacterPanel } from "./panels/CharacterPanel";

export const characterTool = defineTool({
  id: "ek.character",
  title: { zh: "角色", en: "Character" },
  icon: UserIcon as ComponentType<{ className?: string }>,
  region: "center",
  minWidth: 720,
  minHeight: 420,
  dependencies: [],
  panels: [{ id: "sheet", component: CharacterPanel }],
});
