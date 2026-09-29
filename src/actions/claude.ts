import { toast } from "sonner";

import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { canMention } from "@/actions/files";
import { agentName } from "@/lib/agents/registry";
import type { Workspace } from "@/types";

export const sendToClaude = (workspace: Workspace, text: string) => {
  if (!canMention(workspace) || !workspace.agentTerminalId) {
    toast(`Resume the session first to use this in ${agentName(workspace.agent)}`);
    return;
  }
  pasteIntoTerminal(workspace.agentTerminalId, text);
};
