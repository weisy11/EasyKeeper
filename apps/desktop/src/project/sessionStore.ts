import { createStore } from "@/lib/store";
import type { SessionContext } from "./types";

/** Open project for this page. The desktop process keeps a copy across reloads; quitting the app drops it. */
export const sessionStore = createStore<SessionContext | null>(null);
