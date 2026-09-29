import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import { agentName, CLAUDE } from "@/lib/agents/registry";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

export const RenameDialog = () => {
  const target = useUiStore((s) => s.renameTarget);
  const setRenameTarget = useUiStore((s) => s.setRenameTarget);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(target?.title ?? "");
  }, [target]);

  const save = async () => {
    const next = title.trim();
    if (!target || !next || saving) return;
    setSaving(true);
    try {
      if (target.agent === CLAUDE) await api.renameSession(target.filePath, target.distro, next);
      else useSettingsStore.getState().setSessionTitle(target.id, next);
      useSessionsStore.getState().patchSession(target.id, { title: next, customTitle: next });
      setRenameTarget(null);
      void (target.distro
        ? useSessionsStore.getState().refreshWsl()
        : useSessionsStore.getState().refresh());
    } catch (error) {
      toast.error(`Couldn't rename: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && setRenameTarget(null)}
      title="Rename session"
      description={
        target?.agent === CLAUDE || !target
          ? "Saved into the session itself, so the name also shows in claude --resume."
          : `Saved in Deck. ${agentName(target.agent)} keeps its own session list.`
      }
      className="w-[min(460px,calc(100vw-48px))]"
    >
      <form
        className="px-5 pt-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          maxLength={200}
          className="h-9 w-full rounded-md border border-border-strong bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent/60"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameTarget(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim() || saving}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
