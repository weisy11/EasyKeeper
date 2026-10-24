import { ChevronRight, Trash2 } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

export function ListTrash({
  title,
  open,
  onToggle,
  onReceive,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  onReceive: (id: string) => void;
  children: ReactNode;
}) {
  function receive(event: DragEvent) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    if (id) onReceive(id);
  }

  return (
    <div className={open ? "flex max-h-[33%] min-h-0 shrink-0 flex-col" : "shrink-0"} data-list-trash="">
      <div className="border-t border-border" />
      <button
        type="button"
        className="flex h-7 w-full shrink-0 items-center gap-1 px-2 text-left text-sm"
        onClick={onToggle}
        onDragOver={(event) => {
          event.preventDefault();
          if (!open) onToggle();
        }}
        onDrop={receive}
      >
        <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <Trash2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? (
        <div className="min-h-0 flex-1 overflow-auto" onDragOver={(event) => event.preventDefault()} onDrop={receive}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
