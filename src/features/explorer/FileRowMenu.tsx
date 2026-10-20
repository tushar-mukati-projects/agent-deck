import { AtSign, Code2, Sparkles, SquareTerminal } from "lucide-react";

import { canMention, mentionInAgent } from "@/actions/files";
import { startNewSession } from "@/actions/sessions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { fileActions } from "@/features/viewer/file-actions";
import { agentName } from "@/stores/agents";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DirEntry, Workspace } from "@/types";

type FileRowMenuProps = {
  entry: DirEntry;
  workspace: Workspace;
  children: React.ReactNode;
};

export const FileRowMenu = ({ entry, workspace, children }: FileRowMenuProps) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      {!entry.isDir && (
        <ContextMenuItem
          icon={<Code2 />}
          onSelect={() => useWorkspaceStore.getState().openFile(workspace.id, entry.path)}
        >
          Open
        </ContextMenuItem>
      )}
      <ContextMenuItem
        icon={<AtSign />}
        disabled={!canMention(workspace)}
        onSelect={() => mentionInAgent(workspace, entry.path)}
      >
        Mention in {agentName(workspace.agent)}
      </ContextMenuItem>
      {entry.isDir && (
        <>
          <ContextMenuItem
            icon={<SquareTerminal />}
            onSelect={() => useWorkspaceStore.getState().openShell(workspace.id, entry.path)}
          >
            Open shell here
          </ContextMenuItem>
          <ContextMenuItem icon={<Sparkles />} onSelect={() => startNewSession(entry.path)}>
            New session here
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      {fileActions(entry.path, workspace.cwd, entry.isDir).map(({ label, icon, run }) => (
        <ContextMenuItem key={label} icon={icon} onSelect={run}>
          {label}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  </ContextMenu>
);
