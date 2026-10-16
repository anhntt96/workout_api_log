import { ApiError } from '../api/client';
import { Alert } from './ui/Alert';

/** Shows an API error as the API reported it: message, each field error, and the request id for the logs. */
export function ApiErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!(error instanceof ApiError)) {
    return (
      <Alert tone="error" title="Something went wrong" className={className}>
        {error instanceof Error ? error.message : String(error)}
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
    </Alert>
  );
}
