import { Mark, mergeAttributes } from "@tiptap/core";

export type EntityKind = "npc" | "monster" | "clue" | "item" | "scene" | "event";

export type EntityLinkOpen = {
  kind: EntityKind;
  id: string;
  mode: "edit" | "read";
};

const KINDS = new Set<EntityKind>(["npc", "monster", "clue", "item", "scene", "event"]);

export function entityKind(value: string | null): EntityKind | null {
  return value && KINDS.has(value as EntityKind) ? (value as EntityKind) : null;
}

export function entityLinkModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? event.metaKey : event.ctrlKey;
}

export function openEntityLink(detail: EntityLinkOpen) {
  window.dispatchEvent(new CustomEvent<EntityLinkOpen>("ek:open-entity", { detail }));
}

export function onOpenEntity(listener: (detail: EntityLinkOpen) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<EntityLinkOpen>).detail;
    if (!detail || !entityKind(detail.kind) || !detail.id) return;
    listener(detail);
  };
  window.addEventListener("ek:open-entity", handler);
  return () => window.removeEventListener("ek:open-entity", handler);
}

export const EntityLink = Mark.create({
  name: "entityLink",
  inclusive: false,
  excludes: "",
  keepOnSplit: false,

  addAttributes() {
    return {
      kind: {
        default: "npc",
        parseHTML: (element) => element.getAttribute("data-entity-kind"),
        renderHTML: (attributes) => ({ "data-entity-kind": attributes.kind }),
      },
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-entity-id"),
        renderHTML: (attributes) => ({ "data-entity-id": attributes.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-entity-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "entity-link" }), 0];
  },
});
