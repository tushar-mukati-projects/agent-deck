import {
  AtSign,
  BookOpen,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { canMention, mentionInClaude } from "@/actions/files";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Segmented } from "@/components/ui/panel";
import { api } from "@/lib/tauri/commands";
import { copyText, openExternal, revealInExplorer } from "@/lib/tauri/system";
import { cn, errorMessage, formatBytes, relativePath } from "@/lib/utils";
import type { MarkdownMode } from "@/stores/viewer-store";
import type { Workspace } from "@/types";

interface FileToolbarProps {
  workspace: Workspace;
  path: string;
  size: number | null;
  markdownMode: MarkdownMode | null;
  onMarkdownMode: (mode: MarkdownMode) => void;
  canEdit: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  dirty: boolean;
  onSave: () => void;
  onReload: () => void;
}

const Breadcrumbs = ({ path, root }: { path: string; root: string }) => {
  const segments = relativePath(path, root).split(/[\\/]/);
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          <span className={cn("truncate", index === segments.length - 1 && "text-muted")}>
            {segment}
          </span>
          {index < segments.length - 1 && <span className="text-border-strong">/</span>}
        </span>
      ))}
    </>
  );
};

export const FileToolbar = ({
  workspace,
  path,
  size,
  markdownMode,
  onMarkdownMode,
  canEdit,
  editing,
  onToggleEdit,
  dirty,
  onSave,
  onReload,
}: FileToolbarProps) => (
  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
    <div className="flex min-w-0 flex-1 items-center gap-1 text-[11.5px] text-faint" title={path}>
      <Breadcrumbs path={path} root={workspace.cwd} />
      {size !== null && (
        <span className="ml-2 shrink-0 text-[10.5px] text-faint">{formatBytes(size)}</span>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      {markdownMode && (
        <div className="mr-1">
          <Segmented<MarkdownMode>
            size="sm"
            value={markdownMode}
            onChange={onMarkdownMode}
            options={[
              { value: "preview", label: "Preview", icon: <BookOpen /> },
              { value: "source", label: "Source", icon: <Code2 /> },
            ]}
          />
        </div>
      )}
      {dirty && (
        <Button size="sm" variant="primary" className="mr-1 h-6" onClick={onSave}>
          <Save /> Save
        </Button>
      )}
      {canEdit && (
        <IconButton
          label={editing ? "Stop editing" : "Edit file"}
          active={editing}
          onClick={onToggleEdit}
        >
          <Pencil />
        </IconButton>
      )}
      <IconButton
        label={canMention(workspace) ? "Mention in Claude" : "Resume the session to mention files"}
        className={cn(!canMention(workspace) && "opacity-40")}
        onClick={() => mentionInClaude(workspace, path)}
      >
        <AtSign />
      </IconButton>
      <IconButton label="Reload" onClick={onReload}>
        <RotateCw />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon={<Code2 />}
            onSelect={() => void api.openInEditor(path).catch((e) => toast.error(errorMessage(e)))}
          >
            Open in VS Code
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ExternalLink />}
            onSelect={() => void openExternal(path).catch((e) => toast.error(errorMessage(e)))}
          >
            Open with default app
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(path)}>
            Reveal in File Explorer
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Copy />}
            onSelect={() => void copyText(path).then(() => toast.success("Path copied"))}
          >
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Copy />}
            onSelect={() =>
              void copyText(relativePath(path, workspace.cwd)).then(() =>
                toast.success("Relative path copied"),
              )
            }
          >
            Copy relative path
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
);
