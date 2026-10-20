import { useRef, useState } from "react";

import { renameSession } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CLAUDE } from "@/lib/agents/registry";
import { agentName } from "@/stores/agents";
import { useUiStore } from "@/stores/ui-store";
import type { SessionInfo } from "@/types";

const RenameForm = ({
  target,
  inputRef,
}: {
  target: SessionInfo;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) => {
  const [title, setTitle] = useState(target.title ?? "");
  const [saving, setSaving] = useState(false);
  const close = () => useUiStore.getState().setRenameTarget(null);

  const save = async () => {
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true);
    if (await renameSession(target, next)) close();
    setSaving(false);
  };

  return (
    <form
      className="px-5 pt-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        ref={inputRef}
        aria-label="Session name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        maxLength={200}
        className="h-9 px-3 text-[13px]"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!title.trim() || saving}>
          Rename
        </Button>
      </div>
    </form>
  );
};

export const RenameDialog = () => {
  const target = useUiStore((s) => s.renameTarget);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && useUiStore.getState().setRenameTarget(null)}
      title="Rename session"
      description={
        !target || target.agent === CLAUDE
          ? "Saved into the session itself, so the name also shows in claude --resume."
          : `Saved in Deck. ${agentName(target.agent)} keeps its own session list.`
      }
      initialFocusRef={inputRef}
      className="w-[min(460px,calc(100vw-48px))]"
    >
      {target && <RenameForm key={target.id} target={target} inputRef={inputRef} />}
    </Dialog>
  );
};
