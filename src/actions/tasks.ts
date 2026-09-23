import { useWorkspaceStore } from "@/stores/workspace-store";
import type { TaskPackage, Workspace } from "@/types";

export const taskCommand = (pkg: TaskPackage, script: string) =>
  pkg.runner === "npm" ? `npm run ${script}` : `${pkg.runner} ${script}`;

export const runTask = (workspace: Workspace, pkg: TaskPackage, script: string) =>
  useWorkspaceStore.getState().openShell(workspace.id, {
    cwd: pkg.dir,
    label: `${script}`,
    command: taskCommand(pkg, script),
  });
