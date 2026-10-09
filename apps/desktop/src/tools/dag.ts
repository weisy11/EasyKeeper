/** Topological sort for tool ids using dependency edges. */

export type TopoResult =
  | { ok: true; order: string[] }
  | { ok: false; error: string; blocked: string[] };

export function topoSort(ids: string[], depsOf: (id: string) => string[] | undefined): TopoResult {
  const set = new Set(ids);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of set) {
    indeg.set(id, 0);
    adj.set(id, []);
  }

  for (const id of set) {
    const deps = depsOf(id) ?? [];
    for (const d of deps) {
      if (!set.has(d)) continue; // missing dep handled by caller before sort
      adj.get(d)!.push(id);
      indeg.set(id, (indeg.get(id) ?? 0) + 1);
    }
  }

  const queue = [...set].filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      const next = (indeg.get(m) ?? 0) - 1;
      indeg.set(m, next);
      if (next === 0) queue.push(m);
    }
    queue.sort();
  }

  if (order.length !== set.size) {
    const blocked = [...set].filter((id) => !order.includes(id));
    return { ok: false, error: `dependency cycle among: ${blocked.join(", ")}`, blocked };
  }
  return { ok: true, order };
}
