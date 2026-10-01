import type { ComponentType } from "react";
import { LayoutTemplateIcon, SquareIcon, type LucideIcon } from "lucide-react";
import { useL, type LText } from "@/lib/i18n";

export type Region = "center" | "left" | "right" | "bottom";

export type ToolDef = {
  id: string;
  title: LText;
  icon: LucideIcon;
  region: Region;
  minWidth: number;
  minHeight: number;
  component: ComponentType<{ panelId: string }>;
};

function BlankPanel({ title }: { title: LText; panelId: string }) {
  const l = useL();
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-auto bg-background p-6 text-center text-sm text-muted-foreground">
      <p className="text-foreground">{l(title)}</p>
      <p>{l({ zh: "空白面板（占位）", en: "Blank panel (placeholder)" })}</p>
    </div>
  );
}

function makeBlank(id: string, title: LText, region: Region, icon: LucideIcon): ToolDef {
  return {
    id,
    title,
    icon,
    region,
    minWidth: region === "center" ? 240 : 220,
    minHeight: region === "center" ? 160 : 140,
    component: ({ panelId }) => <BlankPanel panelId={panelId} title={title} />,
  };
}

export const TOOLS: ToolDef[] = [
  makeBlank("blank-a", { zh: "面板 A", en: "Panel A" }, "center", SquareIcon),
  makeBlank("blank-b", { zh: "面板 B", en: "Panel B" }, "right", LayoutTemplateIcon),
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const UNKNOWN_ICON = SquareIcon;
