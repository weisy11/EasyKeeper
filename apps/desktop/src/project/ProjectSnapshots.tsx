import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";
import { isTauri } from "@/lib/platform";
import { settingsStore, useStore, type Locale } from "@/lib/store";
import { sessionStore } from "./sessionStore";

type ProjectSnapshot = { id: string; createdAt: string };

async function flushOpenPages() {
  const pending: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent("ek:flush-pages", { detail: { pending } }));
  await Promise.all(pending);
}

function formatWhen(iso: string, locale: Locale) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

export function ProjectSnapshots() {
  const tr = useT();
  const settings = useStore(settingsStore);
  const session = useStore(sessionStore);
  const [items, setItems] = useState<ProjectSnapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const projectPath = session?.projectPath ?? "";

  async function refresh() {
    if (!isTauri || !projectPath) {
      setItems([]);
      return;
    }
    const next = await invoke<ProjectSnapshot[]>("list_project_snapshots", { projectPath });
    setItems(next);
  }

  async function save() {
    if (!projectPath) return;
    if (!isTauri) {
      toast.error(tr("snapshot.desktopOnly"));
      return;
    }
    setSaving(true);
    try {
      await flushOpenPages();
      await invoke("create_project_snapshot", { projectPath });
      toast.success(tr("snapshot.saved"));
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(tr("snapshot.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!isTauri || !projectPath) return;
    await invoke("delete_project_snapshot", { projectPath, id });
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="ml-1 flex items-center gap-1 border-l border-border pl-2">
      <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()}>
        {tr("snapshot.save")}
      </Button>
      <DropdownMenu onOpenChange={(open) => { if (open) void refresh().catch((error) => console.error(error)); }}>
        <DropdownMenuTrigger title={tr("snapshot.list")} className="inline-flex h-7 items-center whitespace-nowrap rounded-md px-2 text-[0.8rem] hover:bg-muted">
          {tr("snapshot.open")}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="end">
          <p className="px-2 py-1 text-xs text-muted-foreground">{tr("snapshot.list")}</p>
          {items.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{tr("snapshot.empty")}</p>
          ) : (
            <ul className="max-h-64 overflow-auto">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">{formatWhen(item.createdAt, settings.locale)}</span>
                  <button type="button" className="shrink-0 text-destructive" onClick={() => void remove(item.id).catch((error) => console.error(error))}>
                    {tr("snapshot.delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
