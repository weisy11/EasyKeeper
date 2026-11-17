import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DOC_PAGES, GITHUB, docFolder, headingSlug, prepareDocMarkdown, resolveDocLink } from "../src/shell/docs.ts";

test("offline documentation resolves page, language, history anchor, and project links", () => {
  const route = { locale: "zh", page: "quick-start" } as const;
  assert.deepEqual(resolveDocLink("copilot.md#接入模型", route), { locale: "zh", page: "copilot", hash: "#%E6%8E%A5%E5%85%A5%E6%A8%A1%E5%9E%8B" });
  assert.deepEqual(resolveDocLink("../en_US/quick-start.md", route), { locale: "en", page: "quick-start", hash: "" });
  assert.deepEqual(resolveDocLink("#1-整理模组", route), { ...route, hash: "#1-%E6%95%B4%E7%90%86%E6%A8%A1%E7%BB%84" });
  assert.deepEqual(resolveDocLink("../../README_zh.md", route), { external: GITHUB });
  assert.equal(resolveDocLink("javascript:alert(1)", route), null);
  assert.equal(resolveDocLink("//other.invalid/scenario.md", route), null);
  assert.equal(resolveDocLink("../../secret.txt", route), null);
});

test("all current guide links resolve in the offline reader", () => {
  for (const locale of ["zh", "en"] as const) {
    for (const page of DOC_PAGES) {
      const text = readFileSync(new URL(`../../../docs/${docFolder(locale)}/${page}.md`, import.meta.url), "utf8");
      for (const match of text.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
        assert.ok(resolveDocLink(match[1], { locale, page }), `${locale}/${page}: ${match[1]}`);
      }
    }
  }
});

test("repository image tags become markdown without executing raw HTML", () => {
  assert.equal(prepareDocMarkdown('<div align="center">\n<img src="../images/panel.png" alt="Panel" width="600" />\n</div>').trim(), '![Panel](<../images/panel.png> "600")');
  assert.equal(headingSlug("1. 整理模组"), "1-整理模组");
  assert.equal(headingSlug("Connecting a Model"), "connecting-a-model");
});
