export type AppMode = "prep" | "play";

export type ProjectKind = "scenario" | "gameRecord";

export type EzkpManifest =
  | { kind: "scenario"; name: string; version: 1 }
  | { kind: "gameRecord"; name: string; version: 1; modulePath: string };

export type SessionContext = {
  mode: AppMode;
  projectPath: string;
  name: string;
  kind: ProjectKind;
  modulePath: string | null;
  moduleEditable: boolean;
};

export type RecentProject = {
  path: string;
  name: string;
  kind: ProjectKind;
  modulePath: string | null;
  openedAt: number;
};
