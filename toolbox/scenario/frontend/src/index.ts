import type { ComponentType } from "react";
import { BookOpenIcon } from "lucide-react";
import { defineTool } from "@ek/tool-api";
import { scenarioModuleData } from "./moduleData";
import { ScenarioPanel } from "./panels/ScenarioPanel";

export { createScenarioNode, deleteScenarioNode, duplicateScenarioNode, ensureScenarioSchema, listChildNodes, loadScenarioTree, placeScenarioNodes, renameScenarioNode } from "./db";

export const scenarioTool = defineTool({
  id: "ek.scenario",
  title: { zh: "模组", en: "Scenario" },
  icon: BookOpenIcon as ComponentType<{ className?: string }>,
  region: "center",
  // Left column of the fixed two-column workspace. Together with the 240px side column
  // this sets the 720px floor the main window must not go below.
  minWidth: 480,
  minHeight: 420,
  dependencies: [],
  moduleData: scenarioModuleData,
  panels: [{ id: "board", component: ScenarioPanel }],
});
