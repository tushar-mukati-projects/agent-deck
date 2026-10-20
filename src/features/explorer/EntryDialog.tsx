import { useRef, useState } from "react";

import { createEntry, renameEntry } from "@/actions/entries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { entryNameError } from "@/lib/entries";
import { basename, dirname } from "@/lib/utils";
import { useUiStore, type EntryRequest } from "@/stores/ui-store";

type EntryFormProps = {
  request: EntryRequest;
  inputRef: React.RefObject<HTMLInputElement | null>;
};

const close = () => useUiStore.getState().setEntryRequest(null);

export const EntryDialog = () => {
  const request = useUiStore((s) => s.entryRequest);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => !open && close()}
      title={request ? dialogTitle(request) : ""}
      description={request ? `In ${basename(folderOf(request))}` : undefined}
      initialFocusRef={inputRef}
      className="w-[min(420px,calc(100vw-48px))]"
    >
      {request && <EntryForm key={targetOf(request)} request={request} inputRef={inputRef} />}
    </Dialog>
  );
};

const EntryForm = ({ request, inputRef }: EntryFormProps) => {
  const [name, setName] = useState(request.kind === "rename" ? basename(request.path) : "");
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const error = entryNameError(trimmed);

  const save = async () => {
    if (error || saving) return;
    setSaving(true);
    const done =
      request.kind === "create"
        ? await createEntry(request, trimmed)
        : await renameEntry(request, trimmed);
    setSaving(false);
    if (done) close();
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
        aria-label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => selectStem(e.currentTarget, request)}
        className="h-9 px-3 text-[13px]"
      />
      {name && error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!!error || saving}>
          {request.kind === "create" ? "Create" : "Rename"}
        </Button>
      </div>
    </form>
  );
};

const dialogTitle = (request: EntryRequest) => {
  const what = request.isDir ? "folder" : "file";
  return request.kind === "create" ? `New ${what}` : `Rename ${what}`;
};

const targetOf = (request: EntryRequest) =>
  request.kind === "create" ? `${request.dir}:${request.isDir}` : request.path;

const folderOf = (request: EntryRequest) =>
  request.kind === "create" ? request.dir : dirname(request.path);

const selectStem = (input: HTMLInputElement, request: EntryRequest) => {
  const dot = request.kind === "rename" && !request.isDir ? input.value.lastIndexOf(".") : -1;
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
};
