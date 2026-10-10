import { useMemo } from "react";

import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import type { Workspace } from "@/types";

type SessionRef = Pick<Workspace, "sessionId" | "filePath" | "cwd">;

const resolveFile = (
  workspace: SessionRef,
  indexedPath: string | null,
  indexedDistro: string | null,
) => ({
  filePath: indexedPath ?? workspace.filePath,
  distro: indexedPath ? indexedDistro : (parseWslPath(workspace.cwd)?.distro ?? null),
});

export const sessionFileNow = (workspace: SessionRef) => {
  const indexed = useSessionsStore.getState().byId[workspace.sessionId];
  return resolveFile(workspace, indexed?.filePath ?? null, indexed?.distro ?? null);
};

export const useSessionFile = (workspace: SessionRef) => {
  const indexedPath = useSessionsStore((s) => s.byId[workspace.sessionId]?.filePath ?? null);
  const indexedDistro = useSessionsStore((s) => s.byId[workspace.sessionId]?.distro ?? null);
  const { filePath, distro } = resolveFile(workspace, indexedPath, indexedDistro);
  return useMemo(() => ({ filePath, distro }), [filePath, distro]);
};
