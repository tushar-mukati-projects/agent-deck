import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/panel";

type ErrorAlertProps = {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};

export const ErrorAlert = ({ message, onRetry, retrying, className }: ErrorAlertProps) => (
  <Alert
    tone="danger"
    className={className}
    action={
      onRetry && (
        <Button size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
          Retry
        </Button>
      )
    }
  >
    <span className="whitespace-pre-wrap">{message}</span>
  </Alert>
);
