import { Trash2 } from "lucide-react";

import { removeConfig } from "@/actions/agent-config";
import { IconButton } from "@/components/ui/icon-button";
import type { RemovalRequest } from "@/lib/agent-config/removals";
import { dangerHoverClass } from "@/lib/styles";
import type { ConfigAgent, Workspace } from "@/types";

type RemoveButtonProps = {
  workspace: Workspace;
  agent: ConfigAgent;
  request: RemovalRequest;
};

export const RemoveButton = ({ workspace, agent, request }: RemoveButtonProps) => (
  <IconButton
    label={`Remove ${request.name}`}
    className={dangerHoverClass}
    onClick={() => void removeConfig(workspace, agent, request)}
  >
    <Trash2 />
  </IconButton>
);
