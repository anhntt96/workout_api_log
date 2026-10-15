import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CLOCK, type Clock } from '../../src/common/clock.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { PG_POOL } from '../../src/database/database.module.js';

/** "Now" in every e2e test, so the latest accepted workout day is 2026-10-16. */
export const TEST_NOW = new Date('2026-10-15T12:00:00Z');

export const USER_A = '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e';
export const USER_B = '5c2d7e9f-1a3b-4c5d-8e7f-9a0b1c2d3e4f';

export interface TestApp {
  app: NestExpressApplication;
  pool: Pool;
}

/** The real AppModule against the Testcontainers database, with silent logs and a fixed clock. */
export async function createTestApp(): Promise<TestApp> {
  const config: AppConfig = { databaseUrl: inject('databaseUrl'), port: 0, logLevel: 'silent', dbPoolMax: 20 };
  const clock: Clock = { now: () => TEST_NOW };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, pool: app.get<Pool>(PG_POOL) };
}

/** Removes all logged workouts; the seeded exercise catalog stays. */
export async function resetWorkouts(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE workout_entries CASCADE');
}
