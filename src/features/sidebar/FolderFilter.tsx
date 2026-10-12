import { memo, useMemo, useState } from "react";
import { Check, ChevronDown, FolderOpen, FolderSearch, Layers } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useFolders } from "@/hooks/useFolders";
import { pickFolder } from "@/lib/tauri/system";
import { basename, cn, samePath, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";

const FolderMenu = ({ onClose }: { onClose: () => void }) => {
  const folders = useFolders();
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const folderFilter = useSettingsStore((s) => s.folderFilter);
  const includeSubfolders = useSettingsStore((s) => s.includeSubfolders);
  const setSettings = useSettingsStore((s) => s.set);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? folders.filter((f) => f.cwd.toLowerCase().includes(q)) : folders;
  }, [folders, query]);

  const browse = async () => {
    const folder = await pickFolder(folderFilter ?? undefined);
    if (folder) setSettings({ folderFilter: folder });
  };

  const onFilterKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.currentTarget
        .closest("[role=menu]")
        ?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled])")
        ?.focus();
      return;
    }
    if (event.key === "Enter" && query.trim() && visible[0]) {
      event.preventDefault();
      setSettings({ folderFilter: visible[0].cwd });
      onClose();
      return;
    }
    if (event.key !== "Escape") event.stopPropagation();
  };

  return (
    <>
      <div className="border-b border-border p-1.5">
        <input
          autoFocus
          aria-label="Filter folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFilterKey}
          placeholder="Filter folders…"
          className="h-7 w-full rounded-md bg-bg px-2 text-xs text-fg outline-none placeholder:text-faint"
        />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1">
        <DropdownMenuItem
          icon={folderFilter ? <Layers /> : <Check className="!text-accent" />}
          onSelect={() => setSettings({ folderFilter: null })}
        >
          <span className={cn(!folderFilter && "text-accent")}>All folders</span>
        </DropdownMenuItem>
        {visible.map((folder) => {
          const selected = !!folderFilter && samePath(folderFilter, folder.cwd);
          return (
            <DropdownMenuItem
              key={folder.cwd}
              icon={selected ? <Check className="!text-accent" /> : <FolderOpen />}
              shortcut={String(folder.count)}
              onSelect={() => setSettings({ folderFilter: folder.cwd })}
            >
              <span className={cn(selected && "text-accent")}>{folder.name}</span>
              <span className="ml-2 text-[11px] text-faint">{shortenHome(folder.cwd, home)}</span>
            </DropdownMenuItem>
          );
        })}
      </div>
      <div className="border-t border-border p-1">
        <DropdownMenuItem icon={<FolderSearch />} onSelect={() => void browse()}>
          Browse for any folder…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={
            includeSubfolders ? <Check className="!text-accent" /> : <span className="size-3.5" />
          }
          onSelect={() => setSettings({ includeSubfolders: !includeSubfolders })}
        >
          Include subfolders
        </DropdownMenuItem>
      </div>
    </>
  );
};

export const FolderFilter = memo(() => {
  const folderFilter = useSettingsStore((s) => s.folderFilter);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1 px-2 pb-2">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-elevated px-2 text-left text-xs text-fg transition-colors hover:border-border-strong data-[state=open]:border-border-strong"
          >
            {folderFilter ? (
              <FolderOpen className="size-3.5 shrink-0 text-folder" />
            ) : (
              <Layers className="size-3.5 shrink-0 text-faint" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {folderFilter ? basename(folderFilter) : "All folders"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-faint" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[340px] p-0">
          <FolderMenu onClose={() => setOpen(false)} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
FolderFilter.displayName = "FolderFilter";
