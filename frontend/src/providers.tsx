import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from './api/client';
import { SessionProvider } from './session/session';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx cannot succeed on retry; network errors and 5xx get two more attempts.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
