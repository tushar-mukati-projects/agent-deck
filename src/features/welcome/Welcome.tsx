import { FolderPlus, MessageSquare, Play, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { startSessionInPickedFolder } from "@/features/titlebar/NewSessionMenu";
import { resumeSession } from "@/hooks/useResumeSession";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { basename, timeAgo } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const TIPS: { action: ShortcutAction; label: string }[] = [
  { action: "palette", label: "Search sessions & actions" },
  { action: "quickOpen", label: "Open a file" },
  { action: "toggleShell", label: "Toggle shell panel" },
  { action: "nextWorkspace", label: "Next session tab" },
];

export const Welcome = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  const environment = useSessionsStore((s) => s.environment);
  const openSession = useWorkspaceStore((s) => s.openSession);
  const openPalette = useUiStore((s) => s.openPalette);
  const recent = sessions.slice(0, 6);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg">
      <div className="w-full max-w-[720px] px-10 py-12">
        <div className="flex items-center gap-3">
          <img src="/app-icon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Claude Deck</h1>
            <p className="text-[12.5px] text-faint">
              {sessions.length} sessions across your folders. Pick one up or start fresh.
            </p>
          </div>
        </div>

        {environment && !environment.claudeFound && (
          <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            The <code className="font-mono">claude</code> command wasn't found on your PATH. Install Claude Code, then restart Deck.
          </div>
        )}

        <div className="mt-7 flex gap-2">
          <Button variant="primary" size="lg" onClick={() => void startSessionInPickedFolder()}>
            <FolderPlus /> New session in folder…
          </Button>
          <Button size="lg" onClick={() => openPalette("all")}>
            <Search /> Find a session
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="mt-9">
            <h2 className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Recent</h2>
            <div className="grid grid-cols-2 gap-2">
              {recent.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => openSession(session)}
                  onDoubleClick={() => void resumeSession(session)}
                  className="group flex flex-col gap-1.5 rounded-lg border border-border bg-panel p-3 text-left transition-colors hover:border-border-strong hover:bg-elevated"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{session.title}</span>
                    <Play className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-faint">
                    <span className="truncate">{basename(session.cwd)}</span>
                    <span>·</span>
                    <span className="shrink-0">{timeAgo(session.modifiedMs)}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <MessageSquare className="size-3" />
                      {session.promptCount}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-9 grid grid-cols-2 gap-x-8 gap-y-2">
          {TIPS.map((tip) => (
            <div key={tip.action} className="flex items-center justify-between text-[12px] text-faint">
              {tip.label}
              <Kbd keys={shortcutLabel(tip.action)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
