import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness and database reachability; used by the Docker health check. */
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch (error) {
      throw new ServiceUnavailableException('Database is unreachable', { cause: error });
    }
    return { status: 'ok' };
  }
}
