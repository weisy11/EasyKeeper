import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} className="underline" onClick={(event) => openLink(event, href)}>
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted p-2 text-sm leading-5">{children}</pre>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
};

function openLink(event: MouseEvent<HTMLAnchorElement>, href: string | undefined) {
  event.preventDefault();
  if (!href || !/^https?:\/\//i.test(href)) return;
  void invoke("open_http_url", { url: href });
}

/** Assistant replies are GFM. Raw HTML is left unparsed. User text stays plain. */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words leading-5 [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:font-semibold [&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:font-semibold [&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:font-semibold [&_hr]:my-2 [&_hr]:border-border [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <Markdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
