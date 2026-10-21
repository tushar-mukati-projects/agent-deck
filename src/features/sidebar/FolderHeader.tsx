import { Plus } from "lucide-react";

import { startNewSession } from "@/actions/sessions";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/tag";
import { basename } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import type { SessionGroup } from "@/lib/session-list";

type FolderHeaderProps = {
  group: SessionGroup;
  hint: string | null;
  tone: DotTone | null;
};

export const FolderHeader = ({ group, hint, tone }: FolderHeaderProps) => {
  const name = basename(group.cwd);
  return (
    <div
      title={group.cwd}
      className="group sticky top-0 z-10 flex h-7 items-center gap-1.5 bg-panel pr-1 pl-2"
    >
      <span className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-faint uppercase">
        {name}
      </span>
      {parseWslPath(group.cwd) && <Tag tone="badge">WSL</Tag>}
      {hint && <span className="min-w-0 shrink-[2] truncate text-[11px] text-faint">{hint}</span>}
      {tone && <StatusDot tone={tone} />}
      <span className="ml-auto pr-1 text-[10.5px] text-faint tabular-nums group-focus-within:hidden group-hover:hidden">
        {group.sessions.length}
      </span>
      <IconButton
        label={`New session in ${name}`}
        className="ml-auto hidden group-focus-within:inline-flex group-hover:inline-flex"
        onClick={() => startNewSession(group.cwd)}
      >
        <Plus />
      </IconButton>
    </div>
  );
};
