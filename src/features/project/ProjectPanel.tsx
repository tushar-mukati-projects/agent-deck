import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  FileText,
  Film,
  FolderKanban,
  Image as ImageIcon,
  Images,
  Layers,
  Music,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { startAgentSession } from "@/actions/sessions";
import { runTask, taskCommand } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Chevron, PanelHeader } from "@/components/ui/panel";
import { encodeMediaTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { basename, cn, errorMessage, relativePath, timeAgo } from "@/lib/utils";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { MediaIndex, ProjectAgent, TaskPackage, Workspace } from "@/types";

interface ProjectData {
  tasks: TaskPackage[] | null;
  agents: ProjectAgent[] | null;
  media: MediaIndex | null;
  errors: string[];
}

const EMPTY: ProjectData = { tasks: null, agents: null, media: null, errors: [] };
const RECENT_RENDERS = 6;

const useProject = (root: string | null) => {
  const [data, setData] = useState<ProjectData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!root) return;
    const request = ++requestRef.current;
    setLoading(true);
    const [tasks, agents, media] = await Promise.allSettled([
      api.projectTasks(root),
      api.projectAgents(root),
      api.projectMedia(root),
    ]);
    if (request !== requestRef.current) return;
    const value = <T,>(result: PromiseSettledResult<T>, empty: T) =>
      result.status === "fulfilled" ? result.value : empty;
    setData({
      tasks: value(tasks, []),
      agents: value(agents, []),
      media: value(media, { items: [], sequences: [], truncated: false }),
      errors: [tasks, agents, media].flatMap((r) =>
        r.status === "rejected" ? [errorMessage(r.reason)] : [],
      ),
    });
    setLoading(false);
  }, [root]);

  useEffect(() => {
    setData(EMPTY);
    void load();
  }, [load]);

  return { ...data, loading, reload: load };
};

const Section = ({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number | null;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center gap-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-muted hover:text-fg [&>svg:nth-child(2)]:size-3.5"
      >
        <Chevron open={open} />
        {icon}
        <span className="truncate">{title}</span>
        {count !== null && <span className="font-normal text-faint">{count}</span>}
      </button>
      {open && <div className="flex flex-col px-1.5">{children}</div>}
    </section>
  );
};

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-1 text-[11.5px] text-faint">{children}</p>
);

const Loading = () => (
  <div className="flex justify-center py-3">
    <Spinner className="size-3.5" />
  </div>
);

const TasksSection = ({
  workspace,
  tasks,
}: {
  workspace: Workspace;
  tasks: TaskPackage[] | null;
}) => {
  const multiple = (tasks?.length ?? 0) > 1;
  return (
    <Section
      title="Tasks"
      count={tasks?.reduce((n, p) => n + p.scripts.length, 0) ?? null}
      icon={<Play />}
    >
      {!tasks && <Loading />}
      {tasks?.length === 0 && <Hint>No package.json scripts found in this folder.</Hint>}
      {tasks?.map((pkg) => (
        <div key={pkg.dir} className="mb-1">
          {multiple && (
            <p className="truncate px-2 pt-1 pb-0.5 text-[10.5px] text-faint" title={pkg.dir}>
              {pkg.name}{" "}
              <span className="text-faint/70">· {relativePath(pkg.dir, workspace.cwd) || "."}</span>
            </p>
          )}
          {pkg.scripts.map((script) => (
            <button
              key={script.name}
              type="button"
              onClick={() => runTask(workspace, pkg, script.name)}
              title={`${taskCommand(pkg, script.name)}\n${script.command}`}
              className="group flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-hover"
            >
              <Play className="size-3 shrink-0 text-faint group-hover:text-success" />
              <span className="shrink-0 truncate text-fg/90">{script.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-faint">
                {script.command}
              </span>
            </button>
          ))}
        </div>
      ))}
    </Section>
  );
};

const AgentsSection = ({
  workspace,
  agents,
}: {
  workspace: Workspace;
  agents: ProjectAgent[] | null;
}) => (
  <Section title="Agents" count={agents?.length ?? null} icon={<Bot />}>
    {!agents && <Loading />}
    {agents?.length === 0 && <Hint>No agents in .claude/agents.</Hint>}
    {agents?.map((agent) => (
      <div
        key={agent.path}
        className="group flex items-start gap-2 rounded-md px-2 py-1 hover:bg-hover"
      >
        <Bot className="mt-0.5 size-3.5 shrink-0 text-[var(--icon-purple)]" />
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().openFile(workspace.id, agent.path)}
          title="Open agent definition"
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-[12px] text-fg/90">{agent.name}</p>
          {agent.description && (
            <p className="line-clamp-2 text-[10.5px] leading-snug text-faint">
              {agent.description}
            </p>
          )}
        </button>
        <IconButton
          label={`New session with ${agent.name}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => startAgentSession(workspace.cwd, agent.name)}
        >
          <Sparkles />
        </IconButton>
      </div>
    ))}
  </Section>
);

const MediaSection = ({ workspace, media }: { workspace: Workspace; media: MediaIndex | null }) => {
  const { openFile } = useWorkspaceStore.getState();
  const count = (kind: string) => media?.items.filter((i) => i.kind === kind).length ?? 0;
  const renders = media?.items.filter((i) => i.kind === "video").slice(0, RECENT_RENDERS) ?? [];
  const stats = [
    { icon: Film, label: "videos", value: count("video") },
    { icon: ImageIcon, label: "images", value: count("image") },
    { icon: Music, label: "audio", value: count("audio") },
    { icon: Layers, label: "frame folders", value: media?.sequences.length ?? 0 },
  ].filter((s) => s.value > 0);

  return (
    <Section title="Media" count={media ? media.items.length : null} icon={<Images />}>
      {!media && <Loading />}
      {media && stats.length === 0 && <Hint>No videos, images or audio in this folder.</Hint>}
      {stats.length > 0 && (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1 text-[11px] text-muted">
            {stats.map(({ icon: Icon, label, value }) => (
              <span key={label} className="flex items-center gap-1">
                <Icon className="size-3 text-faint" />
                <span className="text-fg/90 tabular-nums">{value}</span> {label}
              </span>
            ))}
          </div>
          <Button
            size="sm"
            className="mx-2 my-1.5"
            onClick={() => openFile(workspace.id, encodeMediaTab(workspace.cwd))}
          >
            <Images /> Open media gallery
          </Button>
        </>
      )}
      {renders.length > 0 && (
        <>
          <p className="px-2 pt-1.5 pb-0.5 text-[10.5px] text-faint">Latest videos</p>
          {renders.map((item) => (
            <button
              key={item.path}
              type="button"
              title={item.path}
              onClick={() => openFile(workspace.id, item.path)}
              className="flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-hover"
            >
              <Film className="size-3.5 shrink-0 text-[var(--icon-purple)]" />
              <span className="min-w-0 flex-1 truncate text-fg/90">{basename(item.path)}</span>
              <span className="shrink-0 text-[10.5px] text-faint tabular-nums">
                {timeAgo(item.modifiedMs)}
              </span>
            </button>
          ))}
        </>
      )}
    </Section>
  );
};

export const ProjectPanel = () => {
  const workspace = useActiveWorkspace();
  const project = useProject(workspace?.cwd ?? null);

  if (!workspace) {
    return (
      <EmptyState
        className="h-full"
        icon={<FolderKanban />}
        title="No folder open"
        description="Open a session to see its scripts, agents and media."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Project">
        <IconButton label="Rescan" onClick={() => void project.reload()}>
          <RefreshCw className={cn(project.loading && "animate-spin")} />
        </IconButton>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <AgentsSection workspace={workspace} agents={project.agents} />
        <MediaSection workspace={workspace} media={project.media} />
        <TasksSection workspace={workspace} tasks={project.tasks} />
        {project.errors.map((error) => (
          <p key={error} className="px-3.5 py-1 text-[11px] text-danger">
            <FileText className="mr-1 inline size-3" />
            {error}
          </p>
        ))}
      </div>
    </div>
  );
};
