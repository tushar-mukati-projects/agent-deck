import { Plus } from "lucide-react";

import { startNewSession } from "@/actions/sessions";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/tag";
import { basename } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import type { SessionGroup } from "@/lib/session-list";

export const SECTION_TEXT = "text-[11px] font-semibold tracking-wide text-faint uppercase";
export const STICKY_SECTION = "sticky top-0 z-10 bg-panel";

type FolderHeaderProps = {
  group: SessionGroup;
  path: string;
  tone: DotTone | null;
};

export const FolderHeader = ({ group, path, tone }: FolderHeaderProps) => {
  const name = basename(group.cwd);
  return (
    <div className={`group flex h-7 items-center gap-1.5 pr-1 pl-2 ${STICKY_SECTION}`}>
      <span title={group.cwd} className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={`max-w-[60%] shrink-0 truncate ${SECTION_TEXT}`}>{name}</span>
        {parseWslPath(group.cwd) && <Tag tone="badge">WSL</Tag>}
        <span className="min-w-0 truncate text-[10.5px] text-faint">{path}</span>
      </span>
      {tone && <StatusDot tone={tone} />}
      <span className="pr-1 text-[10.5px] text-faint tabular-nums group-focus-within:invisible group-hover:invisible">
        {group.sessions.length}
      </span>
      <IconButton
        label={`New session in ${name}`}
        className="absolute right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => startNewSession(group.cwd)}
      >
        <Plus />
      </IconButton>
    </div>
  );
};
