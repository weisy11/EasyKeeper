export const GITHUB = "https://github.com/weisy11/EasyKeeper";
export const DOC_PAGES = ["README", "quick-start", "prep-and-play", "scenario", "copilot", "character", "dice"] as const;
export type DocPage = (typeof DOC_PAGES)[number];
export type DocLocale = "zh" | "en";
export type DocRoute = { locale: DocLocale; page: DocPage; hash?: string };
export const DOC_TITLES: Record<DocPage, [string, string]> = {
  README: ["文档目录", "Documentation"], "quick-start": ["快速上手", "Quick Start"],
  "prep-and-play": ["备团与跑团", "Prep and Play"], scenario: ["模组工具", "Scenario Tool"],
  copilot: ["KP Copilot", "KP Copilot"], character: ["角色工具", "Character Tool"], dice: ["骰子工具", "Dice Tool"],
};
export function docFolder(locale: DocLocale) { return locale === "zh" ? "zh_CN" : "en_US"; }
export function isDocPage(page: string): page is DocPage { return DOC_PAGES.includes(page as DocPage); }

export function resolveDocLink(href: string, route: DocRoute): DocRoute | { external: string } | null {
  if (/^https?:\/\//i.test(href)) return { external: href };
  const base = `https://docs.invalid/${docFolder(route.locale)}/${route.page}.md`;
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.origin !== "https://docs.invalid") return null;
  if (/^\/README_(zh|en)\.md$/.test(url.pathname)) return { external: GITHUB };
  const match = /^\/(zh_CN|en_US)\/([^/]+)\.md$/.exec(url.pathname);
  if (!match || !isDocPage(match[2])) return null;
  return { locale: match[1] === "zh_CN" ? "zh" : "en", page: match[2], hash: url.hash };
}

/** Repository docs use only these HTML wrappers and image tags; do not enable arbitrary raw HTML. */
export function prepareDocMarkdown(text: string): string {
  return text.replace(/<\/?div\b[^>]*>/gi, "").replace(/<img\b[^>]*>/gi, (tag) => {
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? "";
    return `\n\n![${attr("alt").replaceAll("[", "").replaceAll("]", "")}](<${attr("src")}> "${attr("width")}")\n\n`;
  });
}

export function headingSlug(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").trim().replace(/\s/g, "-");
}
