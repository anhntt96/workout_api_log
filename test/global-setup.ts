import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/database/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Starts one Postgres 18 container for the whole e2e run and applies the migrations once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const databaseUrl = container.getConnectionUri();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
