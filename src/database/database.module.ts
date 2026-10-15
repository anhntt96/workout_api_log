import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

// DATE columns hold calendar days (ADR 0002). Keep them as 'YYYY-MM-DD' strings: the default
// parser builds a JS Date at local midnight, which shifts the day in some time zones.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/** Injection token for the shared `pg` Pool. */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const pool = new Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
        // An idle client can lose its connection; log it instead of crashing the process.
        pool.on('error', (error) => new Logger('Database').error(error));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
