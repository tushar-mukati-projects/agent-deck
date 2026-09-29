import { useMemo } from "react";

import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import type { Workspace } from "@/types";

export const useSessionFile = (workspace: Pick<Workspace, "sessionId" | "filePath" | "cwd">) => {
  const indexedPath = useSessionsStore((s) => s.byId[workspace.sessionId]?.filePath ?? null);
  const indexedDistro = useSessionsStore((s) => s.byId[workspace.sessionId]?.distro ?? null);
  const filePath = indexedPath ?? workspace.filePath;
  const distro = indexedPath ? indexedDistro : (parseWslPath(workspace.cwd)?.distro ?? null);
  return useMemo(() => ({ filePath, distro }), [filePath, distro]);
};
