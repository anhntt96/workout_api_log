import { RotateCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';

/**
 * Shows an API error as the API reported it: message, each field error, and the request id for the logs.
 * With `onRetry`, it also offers Try again.
 */
export function ApiErrorAlert({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const retry = onRetry && (
    <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
      <RotateCw aria-hidden="true" className="size-3.5" />
      Try again
    </Button>
  );
  if (!(error instanceof ApiError)) {
    return (
      <Alert tone="error" title="Something went wrong" className={className}>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {retry}
      </Alert>
    );
  }
  return (
    <Alert tone="error" title={error.message} className={className}>
      {error.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {error.errors.map((fieldError) => (
            <li key={`${fieldError.field}:${fieldError.message}`}>
              <code className="font-mono text-xs">{fieldError.field}</code>: {fieldError.message}
            </li>
          ))}
        </ul>
      )}
      {error.requestId && <p className="mt-1 font-mono text-xs opacity-70">Request ID {error.requestId}</p>}
      {retry}
    </Alert>
  );
}
