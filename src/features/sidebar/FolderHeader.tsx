import { Plus } from "lucide-react";

import { startNewSession } from "@/actions/sessions";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Chevron } from "@/components/ui/panel";
import { Tag } from "@/components/ui/tag";
import { folderIcon } from "@/lib/file-icons";
import { basename, cn } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import type { SessionGroup } from "@/lib/session-list";

type FolderHeaderProps = {
  group: SessionGroup;
  collapsed: boolean;
  hint: string | null;
  tone: DotTone | null;
  onToggle: () => void;
};

export const FolderHeader = ({ group, collapsed, hint, tone, onToggle }: FolderHeaderProps) => {
  const name = basename(group.cwd);
  const { icon: Icon, color } = folderIcon(name, !collapsed);
  return (
    <div className="group sticky top-0 z-10 flex h-8 items-center gap-1 bg-panel pr-1 pl-1">
      <button
        type="button"
        onClick={onToggle}
        title={group.cwd}
        data-session-row
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12.5px] font-medium text-fg/90 hover:text-fg"
      >
        <Chevron open={!collapsed} className="text-faint" />
        <Icon className={cn("size-3.5 shrink-0", color)} />
        <span className="min-w-0 truncate">{name}</span>
        {parseWslPath(group.cwd) && (
          <Tag tone="badge">WSL</Tag>
        )}
        {hint && (
          <span className="min-w-0 shrink-[2] truncate text-[11px] font-normal text-faint">
            {hint}
          </span>
        )}
      </button>
      {collapsed && tone && <StatusDot tone={tone} className="mr-1" />}
      <span className="pr-1 text-[10.5px] text-faint tabular-nums group-focus-within:hidden group-hover:hidden">
        {group.sessions.length}
      </span>
      <IconButton
        label={`New session in ${name}`}
        className="hidden group-focus-within:inline-flex group-hover:inline-flex"
        onClick={() => startNewSession(group.cwd)}
      >
        <Plus />
      </IconButton>
    </div>
  );
};
