import type { ComponentType } from "react";
import { BookOpenIcon } from "lucide-react";
import { defineTool } from "@ek/tool-api";
import { ScenarioPanel } from "./panels/ScenarioPanel";

export { createScenarioNode, deleteScenarioNode, duplicateScenarioNode, ensureScenarioSchema, listChildNodes, loadScenarioTree, placeScenarioNodes, renameScenarioNode } from "./db";

export const scenarioTool = defineTool({
  id: "ek.scenario",
  title: { zh: "模组", en: "Scenario" },
  icon: BookOpenIcon as ComponentType<{ className?: string }>,
  region: "center",
  minWidth: 720,
  minHeight: 420,
  dependencies: [],
  panels: [{ id: "board", component: ScenarioPanel }],
});
