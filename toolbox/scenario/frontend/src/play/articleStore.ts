import type { ScenarioArticle } from "../db";

export type ActorIndexEntry = { id: string; name: string; kind: "npc" | "monster"; trashed: boolean };

let articles: ScenarioArticle[] = [];
let actors: ActorIndexEntry[] = [];
const articleListeners = new Set<(items: ScenarioArticle[]) => void>();
const actorListeners = new Set<(items: ActorIndexEntry[]) => void>();

export function readArticles() {
  return articles;
}

export function publishArticles(next: ScenarioArticle[]) {
  articles = next;
  for (const listener of articleListeners) listener(articles);
}

export function subscribeArticles(listener: (items: ScenarioArticle[]) => void) {
  articleListeners.add(listener);
  listener(articles);
  return () => {
    articleListeners.delete(listener);
  };
}

export function readActorIndex() {
  return actors;
}

export function publishActorIndex(next: ActorIndexEntry[]) {
  actors = next;
  for (const listener of actorListeners) listener(actors);
}

export function subscribeActorIndex(listener: (items: ActorIndexEntry[]) => void) {
  actorListeners.add(listener);
  listener(actors);
  return () => {
    actorListeners.delete(listener);
  };
}

/** Point this character at exactly these clues and items. One shared link, visible from both sides. */
export function applyActorArticles(items: ScenarioArticle[], actorId: string, articleIds: string[]) {
  const chosen = new Set(articleIds);
  return items.map((item) => {
    const actors = item.actors.filter((id) => id !== actorId);
    return chosen.has(item.id) ? { ...item, actors: [...actors, actorId] } : { ...item, actors };
  });
}
