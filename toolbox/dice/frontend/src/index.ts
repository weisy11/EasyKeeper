import type { ComponentType } from "react";
import { DicesIcon } from "lucide-react";
import { defineTool } from "@ek/tool-api";
import { DiceRollerPanel } from "./panels/RollerPanel";
import { disposeDiceRuntime, wasDiceHeavyLoaded } from "./runtime";

/**
 * Thin tool entry — do not statically import vendor/three here.
 * Heavy assets load only when the roller panel mounts.
 */
export const diceTool = defineTool({
  id: "ek.dice",
  title: { zh: "骰子", en: "Dice" },
  icon: DicesIcon as ComponentType<{ className?: string }>,
  region: "right",
  minWidth: 320,
  minHeight: 280,
  dependencies: [],
  panels: [{ id: "roller", component: DiceRollerPanel }],
  dispose: () => disposeDiceRuntime(),
  wasHeavyLoaded: () => wasDiceHeavyLoaded(),
});
