import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MarkdownText, type MarkdownComponents } from "@ek-tool/copilot/markdown";
import { settingsStore } from "../lib/store";
import { DOC_PAGES, DOC_TITLES, docFolder, headingSlug, isDocPage, prepareDocMarkdown, resolveDocLink, type DocRoute } from "./docs";
import "./help.css";

const documents = import.meta.glob("../../../../docs/{zh_CN,en_US}/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const assets = import.meta.glob("../../../../docs/images/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const images = Object.fromEntries(Object.entries(assets).map(([path, url]) => [path.split("/").at(-1), url]));

function plainText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (node && typeof node === "object" && "props" in node) return plainText((node as { props: { children?: unknown } }).props.children);
  return "";
}

export function Help({ page }: { page: string }) {
  const initial: DocRoute = { locale: settingsStore.get().locale, page: isDocPage(page) ? page : "README" };
  const [history, setHistory] = useState<DocRoute[]>([initial]);
  const [position, setPosition] = useState(0);
  const route = history[position];
  const scroller = useRef<HTMLElement>(null);
  const en = route.locale === "en";
  function visit(next: DocRoute) {
    setHistory((items) => [...items.slice(0, position + 1), next]);
    setPosition((value) => value + 1);
  }
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void listen<string>("ek:help-page", ({ payload }) => {
      if (!isDocPage(payload)) return;
      setHistory([{ locale: settingsStore.get().locale, page: payload }]);
      setPosition(0);
    }).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
  useEffect(() => {
    let locale = settingsStore.get().locale;
    return settingsStore.subscribe(() => {
      const next = settingsStore.get().locale;
      if (locale === next) return;
      locale = next;
      setHistory((items) => items.map((item) => ({ ...item, locale: next, hash: undefined })));
    });
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    if (route.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(route.hash!.slice(1)))?.scrollIntoView());
  }, [route]);

  const counts = new Map<string, number>();
  const heading = (tag: string) => ({ children }: { children?: ReactNode }) => {
    const slug = headingSlug(plainText(children));
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return createElement(tag, { id: count ? `${slug}-${count}` : slug }, children);
  };
  const components: MarkdownComponents = {
    h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4"),
    a: ({ href, children }) => <a href={href} onClick={(event) => {
      event.preventDefault();
      if (!href) return;
      const next = resolveDocLink(href, route);
      if (next && "external" in next) void invoke("open_http_url", { url: next.external });
      else if (next) visit(next);
    }}>{children}</a>,
    img: ({ src, alt, title }) => {
      const url = typeof src === "string" ? images[src.split("/").at(-1)!] : undefined;
      return url ? <img src={url} alt={alt} loading="lazy" style={{ width: Number(title) || undefined, maxWidth: "100%", height: "auto" }} /> : <span>{alt}</span>;
    },
  };
  const key = `../../../../docs/${docFolder(route.locale)}/${route.page}.md`;
  return <div className="flex h-screen flex-col bg-background text-foreground">
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      <button type="button" disabled={position === 0} onClick={() => setPosition((value) => value - 1)} className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40">{en ? "← Back" : "← 后退"}</button>
      <button type="button" disabled={position === history.length - 1} onClick={() => setPosition((value) => value + 1)} className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40">{en ? "Forward →" : "前进 →"}</button>
      <span className="ml-2 truncate font-semibold">{DOC_TITLES[route.page][en ? 1 : 0]}</span>
    </header>
    <div className="flex min-h-0 flex-1">
      <nav aria-label={en ? "Documentation" : "文档目录"} className="hidden w-44 shrink-0 overflow-auto border-r border-border p-3 sm:block">
        {DOC_PAGES.map((id) => <button key={id} type="button" aria-current={route.page === id ? "page" : undefined} className={`mb-1 block w-full rounded px-3 py-2 text-left text-sm ${route.page === id ? "bg-muted font-medium" : "hover:bg-muted"}`} onClick={() => visit({ locale: route.locale, page: id })}>{DOC_TITLES[id][en ? 1 : 0]}</button>)}
      </nav>
      <main ref={scroller} className="min-w-0 flex-1 overflow-auto px-5 py-4 sm:px-8">
        <article lang={en ? "en" : "zh-CN"} className="help-content mx-auto max-w-3xl">
          <MarkdownText text={prepareDocMarkdown(documents[key] ?? (en ? "Document unavailable." : "无法加载文档。"))} components={components} />
        </article>
      </main>
    </div>
  </div>;
}
