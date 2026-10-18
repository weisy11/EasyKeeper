import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Link2, List as ListIcon, ListOrdered } from "lucide-react";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { readActorIndex, readArticles, subscribeActorIndex, subscribeArticles, type ActorIndexEntry } from "../articleStore";
import type { ScenarioArticle, ScenarioTreeNode } from "../db";
import { EntityLink, entityKind, entityLinkModifier, openEntityLink, type EntityKind } from "../entityLink";
import { readSceneCatalog, subscribeSceneCatalog, type SceneCatalog } from "../sceneLinks";
import { scenarioT, type ScenarioLocale, type ScenarioStringKey } from "../i18n";
import { useScenarioLocale } from "../locale";
import { ProjectPath } from "../projectPath";
import { loadImageObjectUrl, readPage, savePastedImage, writePage } from "../storage";
import "../editor.css";

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

export function BodyEditor({ projectPath, pageId, editable }: { projectPath: string; pageId: string; editable: boolean }) {
  const locale = useScenarioLocale();
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const editorRef = useRef<Editor | null>(null);
  const projectRef = useRef(projectPath);
  const editableRef = useRef(editable);
  projectRef.current = projectPath;
  editableRef.current = editable;
  const ready = useRef(false);
  const dirty = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [...HEADING_LEVELS] } }),
      storedImage,
      Placeholder.configure({ placeholder: t("placeholder") }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      FindAndReplace.configure({ searchDebounceMs: 0 }),
      EntityLink,
    ],
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const target = event.target;
        const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
        const link = node?.closest("[data-entity-id]");
        const id = link?.getAttribute("data-entity-id") ?? "";
        const kind = entityKind(link?.getAttribute("data-entity-kind") ?? null);
        if (!link || !id || !kind) return false;
        if (editableRef.current) {
          if (!entityLinkModifier(event)) return false;
          event.preventDefault();
          openEntityLink({ kind, id, mode: "edit" });
          return true;
        }
        event.preventDefault();
        openEntityLink({ kind, id, mode: "read" });
        return true;
      },
      handlePaste: (_view, event) => {
        const current = editorRef.current;
        const root = projectRef.current;
        const files = imageFiles(event);
        if (!editableRef.current || !current || !root || files.length === 0) return false;
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
    const surface = surfaceRef.current;
    if (!surface) return;
    const sync = (event: KeyboardEvent) => {
      surface.classList.toggle("entity-link-armed", entityLinkModifier(event));
    };
    const clear = () => surface.classList.remove("entity-link-armed");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useEffect(() => {
    editor?.setEditable(editable);
    if (!editable) {
      setFindOpen(false);
      editor?.commands.clearSearch();
    }
  }, [editor, editable]);

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
    if (!editor || !editable) return;
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
  }, [editor, editable, pageId, projectPath]);

  useEffect(() => {
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
      {editable && <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
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
        <EntityLinkButton editor={editor} locale={locale} pageId={pageId} />
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
      </div>}
      {editable && findOpen && (
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
      <div ref={surfaceRef} className="scenario-editor min-h-0 flex-1 overflow-auto" data-entity-links={editable ? "edit" : "read"}>
        <EditorContent editor={editor} className="h-full [&_.ProseMirror]:h-full" />
      </div>
    </div>
  );
}

type LinkChoice = { id: string; kind: EntityKind; name: string; badge: string };

function EntityLinkButton({ editor, locale, pageId }: { editor: Editor | null; locale: ScenarioLocale; pageId: string }) {
  const t = (key: ScenarioStringKey) => scenarioT(locale, key);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"scenes" | "npcs" | "clues" | null>(null);
  const [actors, setActors] = useState<ActorIndexEntry[]>(readActorIndex);
  const [articles, setArticles] = useState<ScenarioArticle[]>(readArticles);
  const [catalog, setCatalog] = useState<SceneCatalog>(readSceneCatalog);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = editor?.isActive("entityLink") ?? false;

  useEffect(() => subscribeActorIndex(setActors), []);
  useEffect(() => subscribeArticles(setArticles), []);
  useEffect(() => subscribeSceneCatalog(setCatalog), []);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function labelFor(kind: EntityKind, name: string) {
    const trimmed = name.trim();
    if (trimmed) return trimmed;
    if (kind === "npc") return t("untitledNpc");
    if (kind === "monster") return t("untitledMonster");
    if (kind === "scene") return t("untitledScene");
    if (kind === "event") return t("untitledEvent");
    return kind === "clue" ? t("untitledClue") : t("untitledItem");
  }

  function badgeFor(kind: EntityKind) {
    if (kind === "npc") return "NPC";
    if (kind === "monster") return t("monster");
    if (kind === "clue") return t("clue");
    if (kind === "item") return t("item");
    return kind === "scene" ? t("scenes") : t("event");
  }

  function apply(choice: LinkChoice) {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty) {
      const label = labelFor(choice.kind, choice.name);
      editor.chain().focus().insertContent([
        { type: "text", text: " " },
        { type: "text", text: label, marks: [{ type: "entityLink", attrs: { kind: choice.kind, id: choice.id } }] },
        { type: "text", text: " " },
      ]).run();
    } else {
      editor.chain().focus().setMark("entityLink", { kind: choice.kind, id: choice.id }).run();
    }
    setCategory(null);
    setOpen(false);
  }

  const people = actors.filter((actor) => !actor.trashed).map((actor) => ({
    id: actor.id,
    kind: actor.kind,
    name: labelFor(actor.kind, actor.name),
    badge: badgeFor(actor.kind),
    linked: pageId !== "" && actor.links.includes(pageId),
  }));
  const clues = articles.filter((article) => !article.trashed).map((article) => ({
    id: article.id,
    kind: article.kind,
    name: labelFor(article.kind, article.name),
    badge: badgeFor(article.kind),
    linked: pageId !== "" && article.scenes.includes(pageId),
  }));
  const sceneIds = relatedSceneIds(catalog.nodes, pageId);
  const scenes = flattenScenes(catalog.nodes)
    .filter((node) => node.id !== pageId)
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      name: labelFor(node.kind, node.title),
      badge: badgeFor(node.kind),
      linked: sceneIds.has(node.id),
    }));
  for (const list of [people, clues]) list.sort((a, b) => labelFor(a.kind, a.name).localeCompare(labelFor(b.kind, b.name)));
  const shown = category === "scenes" ? scenes : category === "npcs" ? people : category === "clues" ? clues : [];
  const linkedRows = shown.filter((row) => row.linked);
  const otherRows = shown.filter((row) => !row.linked);

  return (
    <div ref={rootRef} className="relative">
      <ToolButton title={t("entityLink")} active={open || category !== null || active} onClick={() => setOpen((value) => !value)}>
        <Link2 className="size-4" strokeWidth={1.75} />
      </ToolButton>
      {open && (
        <div data-entity-picker className="absolute top-8 left-0 z-20 w-40 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md">
          {active && (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor?.chain().focus().unsetMark("entityLink").run();
                setOpen(false);
              }}
            >
              {t("entityLinkRemove")}
            </button>
          )}
          {(["scenes", "npcs", "clues"] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-entity-category={key}
              className="block w-full px-3 py-1.5 text-left hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setCategory(key);
                setOpen(false);
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
      {category && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-6" onPointerDown={() => setCategory(null)}>
          <div
            role="dialog"
            data-entity-form={category}
            aria-label={t(category)}
            className="flex max-h-full w-[min(440px,100%)] flex-col gap-3 overflow-hidden rounded-md border border-border bg-background p-4 text-[13px] shadow-lg"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold">{t(category)}</h2>
            <LinkPanel title={t("linkedHere")} rows={linkedRows} onPick={apply} />
            <LinkPanel title={t("otherItems")} rows={otherRows} onPick={apply} />
            <div className="flex justify-end">
              <button type="button" className="rounded-md px-3 py-1 hover:bg-muted" onClick={() => setCategory(null)}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkPanel({ title, rows, onPick }: { title: string; rows: LinkChoice[]; onPick: (row: LinkChoice) => void }) {
  return (
    <section className="flex min-h-0 flex-col">
      <h3 className="mb-1 text-xs text-muted-foreground">{title}</h3>
      <div className="max-h-40 overflow-auto">
        {rows.length === 0 ? <p className="text-muted-foreground">—</p> : (
          <div className="flex flex-wrap gap-1.5">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-entity-target={row.id}
                title={row.badge}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(row)}
              >
                {row.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function flattenScenes(nodes: ScenarioTreeNode[]): ScenarioTreeNode[] {
  const rows: ScenarioTreeNode[] = [];
  for (const node of nodes) {
    rows.push(node);
    rows.push(...flattenScenes(node.children));
  }
  return rows;
}

function relatedSceneIds(nodes: ScenarioTreeNode[], selectedId: string) {
  const ids = new Set<string>();
  function walk(list: ScenarioTreeNode[], parent: ScenarioTreeNode | null): boolean {
    for (const node of list) {
      if (node.id === selectedId) {
        if (parent) ids.add(parent.id);
        for (const child of node.children) ids.add(child.id);
        return true;
      }
      if (walk(node.children, node)) return true;
    }
    return false;
  }
  walk(nodes, null);
  ids.delete(selectedId);
  return ids;
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

