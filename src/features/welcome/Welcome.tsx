import { useMemo } from "react";
import { FolderPlus, MessageSquare, Play, Search } from "lucide-react";

import { openSessionByClick, resumeSession, startSessionInPickedFolder } from "@/actions/sessions";
import { AppLogo } from "@/components/AppLogo";
import { AgentBadge } from "@/components/ui/agent-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Alert } from "@/components/ui/panel";
import { TimeAgo } from "@/components/ui/time-ago";
import { CLAUDE, CODEX } from "@/lib/agents/registry";
import { appName } from "@/lib/hide-mode";
import { sessionTitle } from "@/lib/sessions";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { basename } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import type { SessionInfo } from "@/types";

const TIPS: { action: ShortcutAction; label: string }[] = [
  { action: "palette", label: "Search sessions & actions" },
  { action: "quickOpen", label: "Open a file" },
  { action: "toggleShell", label: "Toggle shell panel" },
  { action: "searchChats", label: "Search inside conversations" },
  { action: "nextAttention", label: "Jump to session waiting for you" },
  { action: "showAgentConfig", label: "Memory, MCP servers & skills" },
  { action: "shortcuts", label: "All keyboard shortcuts" },
];

const RECENT_COUNT = 6;

const MissingAgent = () => {
  const environment = useSessionsStore((s) => s.environment);
  const defaultAgent = useSettingsStore((s) => s.defaultAgent);
  if (!environment) return null;
  const missing =
    defaultAgent === CLAUDE && !environment.claudeFound
      ? "claude"
      : defaultAgent === CODEX && !environment.codexFound
        ? "codex"
        : null;
  if (!missing) return null;
  return (
    <Alert tone="warning" className="mt-6">
      The <code className="font-mono">{missing}</code> command wasn't found on your Windows PATH.
      Install it and restart Deck, or start sessions in WSL folders where it is installed.
    </Alert>
  );
};

const RecentCard = ({ session }: { session: SessionInfo }) => (
  <div className="group relative rounded-lg border border-border bg-panel transition-colors hover:border-border-strong hover:bg-elevated">
    <button
      type="button"
      onClick={() => openSessionByClick(session)}
      className="flex w-full flex-col gap-1.5 p-3 pr-10 text-left"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {sessionTitle(session)}
        </span>
        {session.agent !== CLAUDE && <AgentBadge agent={session.agent} />}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="truncate">{basename(session.cwd)}</span>
        <span>·</span>
        <TimeAgo ms={session.modifiedMs} className="shrink-0" />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <MessageSquare className="size-3" />
          {session.promptCount}
        </span>
      </div>
    </button>
    <button
      type="button"
      aria-label={`Resume ${session.title ?? "session"}`}
      title="Resume"
      onClick={() => void resumeSession(session)}
      className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-md text-faint opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-hover hover:text-fg"
    >
      <Play className="size-3.5" />
    </button>
  </div>
);

export const Welcome = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  const loaded = useSessionsStore((s) => s.loaded);
  const archived = useSettingsStore((s) => s.archivedSessions);
  const openPalette = useUiStore((s) => s.openPalette);
  const hideMode = useSettingsStore((s) => s.hideMode);
  const recent = useMemo(() => {
    const hidden = new Set(archived);
    return sessions.filter((s) => !hidden.has(s.id)).slice(0, RECENT_COUNT);
  }, [sessions, archived]);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg">
      <div className="w-full max-w-[720px] px-10 py-12">
        <div className="flex items-center gap-3">
          <AppLogo className="size-10" />
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{appName(hideMode)}</h1>
            <p className="text-[12.5px] text-faint">
              {!loaded
                ? "Loading your sessions…"
                : `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} across your folders. Pick one up or start fresh.`}
            </p>
          </div>
        </div>

        <MissingAgent />

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
            <h2 className="mb-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
              Recent
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recent.map((session) => (
                <RecentCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-9 grid grid-cols-2 gap-x-8 gap-y-2">
          {TIPS.map((tip) => (
            <div
              key={tip.action}
              className="flex items-center justify-between text-[12px] text-faint"
            >
              {tip.label}
              <Kbd keys={shortcutLabel(tip.action)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
