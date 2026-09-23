import { toast } from "sonner";

import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { canMention } from "@/actions/files";
import type { Workspace } from "@/types";

export const sendToClaude = (workspace: Workspace, text: string) => {
  if (!canMention(workspace) || !workspace.claudeTerminalId) {
    toast("Resume the session first to use this in Claude");
    return;
  }
  pasteIntoTerminal(workspace.claudeTerminalId, text);
};
