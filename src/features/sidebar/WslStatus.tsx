import { useState } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/panel";
import { errorMessage } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";

const useStartDistro = () => {
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (name: string) => {
    setStarting(name);
    try {
      await useSessionsStore.getState().startDistro(name);
      return true;
    } catch (error) {
      toast.error(`Couldn't start WSL ${name}: ${errorMessage(error)}`);
      return false;
    } finally {
      setStarting(null);
    }
  };
  return { starting, start };
};

export const StartDistroButton = ({
  distro,
  onStarted,
}: {
  distro: string;
  onStarted?: () => void;
}) => {
  const { starting, start } = useStartDistro();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={!!starting}
      onClick={() => void start(distro).then((ok) => ok && onStarted?.())}
    >
      {starting ? <Spinner className="size-3" /> : <Power />} Start
    </Button>
  );
};

export const WslStatus = () => {
  const includeWsl = useSettingsStore((s) => s.includeWsl);
  const distros = useSessionsStore((s) => s.distros);
  const loading = useSessionsStore((s) => s.wslLoading);
  const errors = useSessionsStore((s) => s.wslErrors);
  if (!includeWsl) return null;
  const stopped = distros.filter((d) => !d.running);
  const errorList = Object.entries(errors);
  if (!loading && stopped.length === 0 && errorList.length === 0) return null;

  return (
    <div className="mx-2 mb-2 flex flex-col gap-1">
      {loading && (
        <div className="flex h-7 items-center gap-2 rounded-md border border-border bg-elevated px-2 text-[11px] text-muted">
          <Spinner className="size-3" /> Indexing WSL sessions…
        </div>
      )}
      {!loading &&
        stopped.map((distro) => (
          <div
            key={distro.name}
            className="flex h-7 items-center gap-2 rounded-md border border-border bg-elevated pr-1 pl-2 text-[11px] text-faint"
          >
            <span className="size-1.5 rounded-full bg-faint" />
            <span className="flex-1 truncate">WSL {distro.name} is stopped</span>
            <StartDistroButton distro={distro.name} />
          </div>
        ))}
      {errorList.map(([name, message]) => (
        <Alert key={name} tone="danger" className="px-2 py-1 text-[11px]">
          <span title={message} className="line-clamp-2 break-words">
            {message}
          </span>
        </Alert>
      ))}
    </div>
  );
};
