import { createStore } from "../lib/store";
import type { ProjectKind } from "../project/types";

export type ProjectAction = {
  id: "create-scenario" | "open-scenario" | "create-record" | "open-record" | "recent";
  token: string;
  started?: boolean;
  path?: string;
  kind?: ProjectKind;
};
export const projectActionStore = createStore<ProjectAction | null>(null);
