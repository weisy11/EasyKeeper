import type { ComponentType } from "react";
import { defineTool } from "@ek/tool-api";
import { CopilotIcon } from "./icon";
import { CopilotPanel } from "./panels/CopilotPanel";

export const copilotTool = defineTool({
  id: "ek.copilot",
  title: { zh: "KP Copilot", en: "KP Copilot" },
  icon: CopilotIcon as ComponentType<{ className?: string }>,
  region: "center",
  minWidth: 280,
  minHeight: 320,
  dependencies: [],
  panels: [{ id: "chat", component: CopilotPanel }],
});
