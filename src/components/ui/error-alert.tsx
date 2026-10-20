import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type ErrorAlertProps = {
  message: string;
  onRetry?: () => void;
  retryIcon?: React.ReactNode;
  retrying?: boolean;
  className?: string;
};

export const ErrorAlert = ({
  message,
  onRetry,
  retryIcon,
  retrying,
  className,
}: ErrorAlertProps) => (
  <Alert
    tone="danger"
    className={className}
    action={
      onRetry && (
        <Button size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
          {retryIcon} Retry
        </Button>
      )
    }
  >
    <span className="whitespace-pre-wrap">{message}</span>
  </Alert>
);
