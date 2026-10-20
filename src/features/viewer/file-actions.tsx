import { Code2, Copy, ExternalLink, FolderOpen } from "lucide-react";

import { showError } from "@/components/ui/feedback";
import { api } from "@/lib/tauri/commands";
import { copyText, openExternal, revealInExplorer } from "@/lib/tauri/system";
import { relativePath } from "@/lib/utils";

export type FileAction = {
  label: string;
  icon: React.ReactNode;
  run: () => void;
};

export const openActions = (path: string, isDir: boolean): FileAction[] => [
  {
    label: "Open in VS Code",
    icon: <Code2 />,
    run: () => void api.openInEditor(path).catch(showError),
  },
  ...(isDir
    ? []
    : [
        {
          label: "Open with default app",
          icon: <ExternalLink />,
          run: () => void openExternal(path),
        },
      ]),
  {
    label: "Reveal in File Explorer",
    icon: <FolderOpen />,
    run: () => void revealInExplorer(path),
  },
];

export const copyActions = (path: string, cwd: string): FileAction[] => [
  { label: "Copy path", icon: <Copy />, run: () => void copyText(path, "Path copied") },
  {
    label: "Copy relative path",
    icon: <Copy />,
    run: () => void copyText(relativePath(path, cwd), "Relative path copied"),
  },
];

export const fileActions = (path: string, cwd: string, isDir: boolean) => [
  ...openActions(path, isDir),
  ...copyActions(path, cwd),
];
