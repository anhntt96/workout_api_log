import { z } from 'zod';

/** Injection token for the validated `AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export interface AppConfig {
  databaseUrl: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  dbPoolMax: number;
}

/** Reads configuration from environment variables and fails fast, naming every invalid one. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  const { DATABASE_URL, PORT, LOG_LEVEL, DB_POOL_MAX } = result.data;
  return { databaseUrl: DATABASE_URL, port: PORT, logLevel: LOG_LEVEL, dbPoolMax: DB_POOL_MAX };
}
