import { FolderOpen, FolderPlus, Sparkles } from "lucide-react";

import { startNewSession, startSessionInPickedFolder } from "@/actions/sessions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useAgents } from "@/hooks/useAgents";
import { useFolders } from "@/hooks/useFolders";
import { shortcutLabel } from "@/lib/shortcuts";
import { basename, samePath, shortenHome } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace } from "@/stores/workspace-store";

const RECENT_FOLDER_LIMIT = 7;

type NewSessionMenuProps = {
  children: React.ReactNode;
};

const NewSessionItems = () => {
  const folders = useFolders();
  const active = useActiveWorkspace();
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const defaultAgent = useSettingsStore((s) => s.defaultAgent);
  const agents = useAgents();
  const recent = folders
    .filter((f) => !active || !samePath(f.cwd, active.cwd))
    .slice(0, RECENT_FOLDER_LIMIT);

  return (
    <>
      {active && (
        <>
          <DropdownMenuLabel>In {basename(active.cwd)}</DropdownMenuLabel>
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              icon={<Sparkles className={agent.id === defaultAgent ? "!text-accent" : undefined} />}
              shortcut={agent.id === defaultAgent ? shortcutLabel("newSession") : undefined}
              onSelect={() => startNewSession(active.cwd, agent.id)}
            >
              New {agent.name} session
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        icon={<FolderPlus />}
        onSelect={() => void startSessionInPickedFolder(active?.cwd)}
      >
        Choose folder…{" "}
        <span className="ml-1 text-[11px] text-faint">({agentName(defaultAgent)})</span>
      </DropdownMenuItem>
      {recent.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Recent folders · {agentName(defaultAgent)}</DropdownMenuLabel>
          {recent.map((folder) => (
            <DropdownMenuItem
              key={folder.cwd}
              icon={<FolderOpen />}
              onSelect={() => startNewSession(folder.cwd)}
            >
              <span className="text-fg">{folder.name}</span>
              <span className="ml-2 text-[11px] text-faint">{shortenHome(folder.cwd, home)}</span>
            </DropdownMenuItem>
          ))}
        </>
      )}
    </>
  );
};

export const NewSessionMenu = ({ children }: NewSessionMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent className="w-[340px]">
      <NewSessionItems />
    </DropdownMenuContent>
  </DropdownMenu>
);
