import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui-store";

export const ConfirmDialog = () => {
  const confirm = useUiStore((s) => s.confirm);
  const resolveConfirm = useUiStore((s) => s.resolveConfirm);

  return (
    <Dialog
      open={!!confirm}
      onOpenChange={(open) => !open && resolveConfirm(false)}
      title={confirm?.title ?? ""}
      description={confirm?.description}
      className="w-[min(440px,calc(100vw-48px))]"
    >
      <div className="flex justify-end gap-2 px-5 pt-5 pb-4">
        <Button variant="ghost" onClick={() => resolveConfirm(false)}>
          Cancel
        </Button>
        <Button autoFocus variant={confirm?.destructive ? "danger" : "primary"} onClick={() => resolveConfirm(true)}>
          {confirm?.confirmLabel ?? "Confirm"}
        </Button>
      </div>
    </Dialog>
  );
};
