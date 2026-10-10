import { createStore } from "@/lib/store";
import type { RecentProject } from "./types";

const MAX_RECENT = 12;

export const recentStore = createStore<{ items: RecentProject[] }>({ items: [] }, "ek.recentProjects");

export function rememberProject(project: Omit<RecentProject, "openedAt">) {
  recentStore.set((state) => {
    const next: RecentProject = { ...project, openedAt: Date.now() };
    const items = [next, ...state.items.filter((item) => item.path !== project.path)].slice(0, MAX_RECENT);
    return { items };
  });
}
