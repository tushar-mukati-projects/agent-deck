import { FolderOpen, FolderPlus, Sparkles } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useFolders } from "@/hooks/useFolders";
import { shortcutLabel } from "@/lib/shortcuts";
import { pickFolder } from "@/lib/tauri/system";
import { basename, samePath, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

export const startSessionInPickedFolder = async (defaultPath?: string) => {
  const folder = await pickFolder(defaultPath);
  if (folder) useWorkspaceStore.getState().newSession(folder);
};

export const NewSessionMenu = ({ children }: { children: React.ReactNode }) => {
  const folders = useFolders();
  const active = useActiveWorkspace();
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const newSession = useWorkspaceStore((s) => s.newSession);
  const recent = folders.filter((f) => !active || !samePath(f.cwd, active.cwd)).slice(0, 7);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-[320px]">
        {active && (
          <DropdownMenuItem
            icon={<Sparkles className="!text-accent" />}
            shortcut={shortcutLabel("newSession")}
            onSelect={() => newSession(active.cwd)}
          >
            New session in <span className="font-medium">{basename(active.cwd)}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem icon={<FolderPlus />} onSelect={() => void startSessionInPickedFolder(active?.cwd)}>
          Choose folder…
        </DropdownMenuItem>
        {recent.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Recent folders</DropdownMenuLabel>
            {recent.map((folder) => (
              <DropdownMenuItem key={folder.cwd} icon={<FolderOpen />} onSelect={() => newSession(folder.cwd)}>
                <span className="text-fg">{folder.name}</span>
                <span className="ml-2 text-[11px] text-faint">{shortenHome(folder.cwd, home)}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
