import assert from "node:assert/strict";
import test from "node:test";
import { resolveRecordModule } from "../src/project/recordModule.ts";
import { parseManifest, serializeManifest } from "../src/project/manifest.ts";

test("a copied record uses its own association rather than recent-project state", async () => {
  const stored = parseManifest(serializeManifest({ kind: "gameRecord", version: 1, name: "record", modulePath: "/scenario" }));
  assert.equal(stored?.kind, "gameRecord");
  assert.ok(stored?.kind === "gameRecord");
  const path = await resolveRecordModule({ stored, legacyPath: "/stale", isScenario: async (candidate) => candidate === "/scenario",
    recover: async () => { assert.fail("must not prompt for an existing scenario"); }, save: async () => { assert.fail("must not rewrite"); } });
  assert.equal(path, "/scenario");
});

test("a moved scenario can be reconnected and the new location is saved", async () => {
  const saved: (string | null)[] = [];
  assert.equal(await resolveRecordModule({ stored: { modulePath: "/old" }, legacyPath: "/recent",
    isScenario: async () => false, recover: async (missing) => { assert.equal(missing, "/old"); return "/new"; },
    save: async (path) => { saved.push(path); } }), "/new");
  assert.deepEqual(saved, ["/new"]);
});

test("opening without the missing scenario retains its association for the next attempt", async () => {
  assert.equal(await resolveRecordModule({ stored: { modulePath: "/missing" }, legacyPath: null,
    isScenario: async () => false, recover: async () => null, save: async () => { assert.fail("do not clear missing path"); } }), null);
});

test("legacy markers migrate from recents; legacy records without recents prompt for a scenario", async () => {
  assert.equal(parseManifest(""), null);
  const saved: (string | null)[] = [];
  assert.equal(await resolveRecordModule({ stored: null, legacyPath: "/legacy", isScenario: async () => true,
    recover: async () => { assert.fail(); }, save: async (path) => { saved.push(path); } }), "/legacy");
  assert.deepEqual(saved, ["/legacy"]);
  let prompted = false;
  await resolveRecordModule({ stored: null, legacyPath: null, isScenario: async () => { assert.fail(); },
    recover: async (path) => { prompted = true; assert.equal(path, null); return null; }, save: async () => { assert.fail(); } });
  assert.ok(prompted);
});

test("an intentionally unlinked record does not acquire a stale recent association", async () => {
  assert.deepEqual(parseManifest(serializeManifest({ kind: "gameRecord", name: "record", version: 1, modulePath: null })),
    { kind: "gameRecord", name: "record", version: 1, modulePath: null });
  assert.equal(await resolveRecordModule({ stored: { modulePath: null }, legacyPath: "/stale",
    isScenario: async () => { assert.fail(); }, recover: async () => { assert.fail(); }, save: async () => { assert.fail(); } }), null);
});
