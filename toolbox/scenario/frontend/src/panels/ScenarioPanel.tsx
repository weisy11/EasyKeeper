import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import type { ToolPanelProps } from "@ek/tool-api";
import { List as ListIcon, ListOrdered } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { readScenarioLocale, scenarioT, type ScenarioStringKey } from "../i18n";
import { SceneNav } from "./SceneNav";
import { loadImageObjectUrl, readPage, savePastedImage, writePage } from "../storage";
import "../editor.css";

const ProjectPath = createContext("");

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

const storedImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(StoredImage);
  },
});

const FONTS = [
  { value: "", key: "fontDefault" },
  { value: "sans-serif", key: "fontSans" },
  { value: "monospace", key: "fontMono" },
] as const;

const HEADING_LEVELS = [1, 2, 3, 4, 5] as const;

const TEXT_COLORS = ["#9b9a97", "#9f6b53", "#d9730d", "#cb912f", "#e85d4c", "#448361", "#337ea9", "#9065b0", "#c14c8a", "#d44c47"];
const HIGHLIGHT_COLORS = ["#f7f6f3", "#e9e9e7", "#f4eeee", "#fbf3db", "#fdecc8", "#edf3ec", "#e7f3f8", "#f4f0f7", "#faf1f5", "#fdebec"];

function blockLevel(editor: Editor | null) {
  for (const level of HEADING_LEVELS) {
    if (editor?.isActive("heading", { level })) return String(level);
  }
  return "p";
}

function fontValue(editor: Editor | null) {
  const value = editor?.getAttributes("textStyle").fontFamily;
  return FONTS.some((font) => font.value === value) ? String(value ?? "") : "";
}

function activeColor(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sameColor(value: string | null, hex: string) {
  return value?.trim().toLowerCase() === hex.toLowerCase();
}

function useScenarioLocale() {
  const [locale, setLocale] = useState(readScenarioLocale);
  useEffect(() => {
    const update = () => setLocale(readScenarioLocale());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return locale;
}

function imageFiles(event: ClipboardEvent) {
  return [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function StoredImage({ node }: ReactNodeViewProps) {
  const projectPath = useContext(ProjectPath);
  const src = String(node.attrs.src ?? "");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void loadImageObjectUrl(projectPath, src).then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      objectUrl = next;
      setUrl(next);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectPath, src]);

  return <NodeViewWrapper>{url ? <img src={url} alt="" /> : null}</NodeViewWrapper>;
}

function BodyEditor({ projectPath, pageId }: { projectPath: string; pageId: string }) {
  const locale = useScenarioLocale();
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const editorRef = useRef<Editor | null>(null);
  const projectRef = useRef(projectPath);
  projectRef.current = projectPath;
  const ready = useRef(false);
  const dirty = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [...HEADING_LEVELS] } }),
      storedImage,
      Placeholder.configure({ placeholder: t("placeholder") }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      FindAndReplace.configure({ searchDebounceMs: 0 }),
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const current = editorRef.current;
        const root = projectRef.current;
        const files = imageFiles(event);
        if (!current || !root || files.length === 0) return false;
        void (async () => {
          for (const file of files) {
            const src = await savePastedImage(root, file);
            current.chain().focus().setImage({ src }).run();
          }
        })();
        return true;
      },
    },
    content: EMPTY_DOC,
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    editorRef.current = editor;
    ready.current = false;
    dirty.current = false;
    if (!editor) return;
    let cancelled = false;
    void readPage(projectPath, pageId).then((doc) => {
      if (cancelled) return;
      editor.commands.setContent(doc ?? EMPTY_DOC, { emitUpdate: false });
      ready.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [editor, pageId, projectPath]);

  useEffect(() => {
    if (!editor) return;
    const save = () => {
      if (!ready.current || !dirty.current || !projectPath) return;
      dirty.current = false;
      void writePage(projectPath, pageId, editor.getJSON());
    };
    let timer = 0;
    const onUpdate = () => {
      if (!ready.current) return;
      dirty.current = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 400);
    };
    const onFlush = (event: Event) => {
      const pending = (event as CustomEvent<{ pending?: Promise<void>[] }>).detail?.pending;
      if (!pending || !ready.current || !dirty.current || !projectPath) return;
      window.clearTimeout(timer);
      dirty.current = false;
      pending.push(writePage(projectPath, pageId, editor.getJSON()));
    };
    const onHide = () => save();
    editor.on("update", onUpdate);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("ek:flush-pages", onFlush);
    return () => {
      editor.off("update", onUpdate);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("ek:flush-pages", onFlush);
      window.clearTimeout(timer);
      save();
    };
  }, [editor, pageId, projectPath]);

  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return;
    const update = () => setTick((n) => n + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const results = editor?.storage.findAndReplace?.results ?? [];
  const current = editor?.storage.findAndReplace?.currentIndex;
  const countLabel = results.length === 0 ? "0" : `${(current ?? 0) + 1}/${results.length}`;

  function closeFind() {
    setFindOpen(false);
    setFindTerm("");
    setReplaceTerm("");
    editor?.commands.clearSearch();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-page={pageId}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <select
          data-heading
          aria-label={t("heading1")}
          value={blockLevel(editor)}
          onChange={(event) => {
            if (!editor) return;
            const value = event.target.value;
            const chain = editor.chain().focus();
            if (HEADING_LEVELS.some((level) => String(level) === value)) chain.setHeading({ level: Number(value) as (typeof HEADING_LEVELS)[number] }).run();
            else chain.setParagraph().run();
          }}
          className="h-6 rounded border border-border bg-background px-1 text-xs"
        >
          <option value="p">{t("bodyText")}</option>
          <option value="1">{t("heading1")}</option>
          <option value="2">{t("heading2")}</option>
          <option value="3">{t("heading3")}</option>
          <option value="4">{t("heading4")}</option>
          <option value="5">{t("heading5")}</option>
        </select>
        <ToolDivider />
        <ToolButton title={t("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")}><span className="font-serif text-[15px] leading-none font-semibold">B</span></ToolButton>
        <ToolButton title={t("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")}><span className="font-serif text-[15px] leading-none italic">I</span></ToolButton>
        <ToolButton title={t("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive("strike")}><span className="font-serif text-[15px] leading-none line-through">S</span></ToolButton>
        <ToolButton title={t("code")} onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive("code")}><span className="font-mono text-[11px] leading-none">&lt;/&gt;</span></ToolButton>
        <ToolDivider />
        <ColorMenu editor={editor} label={t("textColor")} textLabel={t("textColor")} highlightLabel={t("highlight")} defaultLabel={t("fontDefault")} />
        <ToolDivider />
        <ToolButton title={t("bullet")} onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")}><ListIcon className="size-4" strokeWidth={1.75} /></ToolButton>
        <ToolButton title={t("ordered")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")}><ListOrdered className="size-4" strokeWidth={1.75} /></ToolButton>
        <ToolDivider />
        <select
          data-font
          aria-label={t("font")}
          value={fontValue(editor)}
          onChange={(event) => {
            if (!editor) return;
            const value = event.target.value;
            if (value) editor.chain().focus().setFontFamily(value).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
          className="h-6 max-w-24 rounded border border-border bg-background px-1 text-xs"
        >
          {FONTS.map((font) => (
            <option key={font.key} value={font.value}>{t(font.key)}</option>
          ))}
        </select>
        <ToolButton title={t("findReplace")} active={findOpen} onClick={() => (findOpen ? closeFind() : setFindOpen(true))}>{t("find")}</ToolButton>
      </div>
      {findOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1" data-find-bar>
          <input
            data-find
            aria-label={t("find")}
            value={findTerm}
            onChange={(event) => {
              const value = event.target.value;
              setFindTerm(value);
              editor?.commands.setSearchTerm(value);
            }}
            className="h-6 w-28 rounded border border-border bg-background px-1.5 text-xs"
          />
          <span className="text-xs text-muted-foreground" data-find-count>{countLabel}</span>
          <ToolButton title={t("previous")} onClick={() => editor?.commands.goToPreviousResult()}>↑</ToolButton>
          <ToolButton title={t("next")} onClick={() => editor?.commands.goToNextResult()}>↓</ToolButton>
          <input
            data-replace
            aria-label={t("replaceWith")}
            value={replaceTerm}
            onChange={(event) => {
              const value = event.target.value;
              setReplaceTerm(value);
              editor?.commands.setReplaceTerm(value);
            }}
            className="h-6 w-28 rounded border border-border bg-background px-1.5 text-xs"
          />
          <ToolButton title={t("replace")} onClick={() => editor?.commands.replace()}>{t("replace")}</ToolButton>
          <ToolButton title={t("replaceAll")} onClick={() => editor?.commands.replaceAll()}>{t("replaceAll")}</ToolButton>
        </div>
      )}
      <div className="scenario-editor min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} className="h-full [&_.ProseMirror]:h-full" />
      </div>
    </div>
  );
}

function ColorMenu({ editor, label, textLabel, highlightLabel, defaultLabel }: { editor: Editor | null; label: string; textLabel: string; highlightLabel: string; defaultLabel: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const text = activeColor(editor?.getAttributes("textStyle").color);
  const highlight = activeColor(editor?.getAttributes("highlight").color);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function applyText(color: string | null) {
    if (!editor) return;
    if (color === null || sameColor(text, color)) editor.chain().focus().unsetColor().run();
    else editor.chain().focus().setColor(color).run();
  }

  function applyHighlight(color: string | null) {
    if (!editor) return;
    if (color === null || sameColor(highlight, color)) editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().setHighlight({ color }).run();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-color-menu
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-0.5 rounded-full pr-0.5 text-muted-foreground hover:bg-accent/60"
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-full bg-white text-[13px] leading-none font-semibold"
          style={{ color: text ?? "#171717" }}
        >
          A
        </span>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.2 2.6 4 5.4 6.8 2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {open && (
        <div data-color-panel className="absolute top-7 left-0 z-20 w-52 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="mb-2 text-xs font-medium">{textLabel}</div>
          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              data-text-swatch="default"
              aria-label={`${textLabel} ${defaultLabel}`}
              aria-pressed={text === null}
              title={defaultLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyText(null)}
              className={`grid h-7 w-7 place-items-center rounded-full border border-foreground/30 text-xs font-semibold text-foreground ${text === null ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""}`}
            >
              A
            </button>
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-text-swatch={color}
                aria-label={`${textLabel} ${color}`}
                aria-pressed={sameColor(text, color)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyText(color)}
                className={`grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-semibold ${sameColor(text, color) ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""}`}
                style={{ borderColor: color, color }}
              >
                A
              </button>
            ))}
          </div>
          <div className="mt-3 mb-2 text-xs font-medium">{highlightLabel}</div>
          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              data-highlight-swatch="default"
              aria-label={`${highlightLabel} ${defaultLabel}`}
              aria-pressed={highlight === null}
              title={defaultLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyHighlight(null)}
              className={`grid h-7 w-7 place-items-center rounded-full border border-foreground/30 text-foreground ${highlight === null ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""}`}
            >
              <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden="true">
                <circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9 19 19 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-highlight-swatch={color}
                aria-label={`${highlightLabel} ${color}`}
                aria-pressed={sameColor(highlight, color)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyHighlight(color)}
                className={`h-7 w-7 rounded-full border border-black/10 ${sameColor(highlight, color) ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolDivider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />;
}

function ToolButton({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function ScenarioPanel({ projectPath }: ToolPanelProps) {
  const locale = useScenarioLocale();
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [selected, setSelected] = useState("scene1");

  return (
    <ProjectPath.Provider value={projectPath}>
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_240px] grid-rows-2 gap-px bg-border text-[13px]">
        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <SceneNav locale={locale} projectPath={projectPath} selected={selected} onSelect={setSelected} />
        </section>

        <section className="col-start-2 row-span-2 flex min-h-0 min-w-0 flex-col bg-background">
          <Header>{t("body")}</Header>
          <BodyEditor key={selected} projectPath={projectPath} pageId={selected} />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <Header>{t("npcs")}</Header>
          <List items={[t("person1"), t("person2"), t("monster1")]} />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <Header>{t("clues")}</Header>
          <List items={[t("clue1"), t("item1"), t("clue2")]} />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col bg-background">
          <Header>{t("map")}</Header>
          <div className="m-2.5 flex flex-1 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground">
            {t("map")}
          </div>
        </section>
      </div>
    </ProjectPath.Provider>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className="flex h-7 shrink-0 items-center border-b border-border bg-card px-2.5 text-xs font-semibold">{children}</div>;
}

function List({ items }: { items: string[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {items.map((item) => (
        <div key={item} className="px-2.5 py-1">{item}</div>
      ))}
    </div>
  );
}
