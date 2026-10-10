import { createStore } from "@/lib/store";
import type { SessionContext } from "./types";

/** Open project for this launch. Not persisted, so a reload returns to the welcome page. */
export const sessionStore = createStore<SessionContext | null>(null);
