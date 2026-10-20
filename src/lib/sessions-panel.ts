import { basename } from "@/lib/utils";
import type { DotTone } from "@/components/ui/feedback";
import type { SessionInfo } from "@/types";

const TONE_PRIORITY: DotTone[] = ["attention", "busy", "running", "external"];

export const groupTone = (sessions: SessionInfo[], tones: Map<string, DotTone>) => {
  const present = new Set(sessions.map((s) => tones.get(s.id)));
  return TONE_PRIORITY.find((tone) => present.has(tone)) ?? null;
};

export const emptyMessage = (query: string, folderFilter: string | null) => {
  if (query)
    return {
      title: "No matching sessions",
      description: folderFilter
        ? "Try a different search, or clear the folder filter."
        : "Try a different search.",
    };
  if (folderFilter)
    return {
      title: "No sessions in this folder yet",
      description: `Start a session in ${basename(folderFilter)} and it will show up here.`,
    };
  return {
    title: "No sessions yet",
    description: "Start a session with any agent and it will show up here.",
  };
};
