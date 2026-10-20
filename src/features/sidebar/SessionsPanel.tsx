import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { refreshAll, startNewSession, startSessionInPickedFolder } from "@/actions/sessions";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader, SearchInput, Segmented } from "@/components/ui/panel";
import { FolderFilter } from "@/features/sidebar/FolderFilter";
import { SessionList } from "@/features/sidebar/SessionList";
import { WslStatus } from "@/features/sidebar/WslStatus";
import { agentsIn, effectiveAgent } from "@/lib/session-list";
import { basename, cn } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";

const RefreshButton = () => {
  const refreshing = useSessionsStore((s) => s.refreshing);
  return (
    <IconButton label="Refresh" onClick={() => void refreshAll()}>
      <RefreshCw className={cn(refreshing && "animate-spin")} />
    </IconButton>
  );
};

export const SessionsPanel = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  const folderFilter = useSettingsStore((s) => s.folderFilter);
  const agentFilter = useSettingsStore((s) => s.agentFilter);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const agentsPresent = useMemo(() => agentsIn(sessions), [sessions]);
  const agent = effectiveAgent(agentFilter, sessions);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Sessions">
        <RefreshButton />
        <IconButton
          label={
            folderFilter ? `New session in ${basename(folderFilter)}` : "New session in folder…"
          }
          onClick={() =>
            folderFilter ? startNewSession(folderFilter) : void startSessionInPickedFolder()
          }
        >
          <Plus />
        </IconButton>
      </PanelHeader>

      <FolderFilter />

      <div className="px-2 pb-2">
        <SearchInput
          id="sessions-search"
          inputRef={searchRef}
          value={query}
          onChange={setQuery}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown") return;
            e.preventDefault();
            listRef.current?.querySelector<HTMLElement>("[data-session-row]")?.focus();
          }}
          placeholder="Search sessions…"
          aria-label="Search sessions"
        />
        {agentsPresent.length > 1 && (
          <div className="mt-1.5">
            <Segmented<string>
              size="sm"
              value={agent}
              onChange={(value) => useSettingsStore.getState().set({ agentFilter: value })}
              options={[
                { value: "all", label: "All agents" },
                ...agentsPresent.map((id) => ({ value: id, label: agentName(id) })),
              ]}
            />
          </div>
        )}
      </div>

      <WslStatus />

      <SessionList query={deferredQuery} listRef={listRef} searchRef={searchRef} />
    </div>
  );
};
