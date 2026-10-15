import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG } from '../src/config/app-config.js';
import { PG_POOL } from '../src/database/database.module.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('GET /health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('reports ok when the database answers', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echoes a safe X-Request-Id and generates one otherwise', async () => {
    const echoed = await request(t.app.getHttpServer()).get('/health').set('X-Request-Id', 'demo-123');
    expect(echoed.headers['x-request-id']).toBe('demo-123');
    const generated = await request(t.app.getHttpServer()).get('/health').set('X-Request-Id', 'bad id');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the request id in error responses', async () => {
    const res = await request(t.app.getHttpServer()).get('/nope').set('X-Request-Id', 'trace-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /nope',
      requestId: 'trace-1',
    });
  });

  it('does not advertise the framework', async () => {
    const res = await request(t.app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports 503 and keeps the cause when the database is unreachable', async () => {
    const dbError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const unreachablePool = {
      query: async () => {
        throw dbError;
      },
      end: async () => undefined,
      on: () => undefined,
    };
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ databaseUrl: inject('databaseUrl'), port: 0, logLevel: 'silent', dbPoolMax: 1 })
      .overrideProvider(PG_POOL)
      .useValue(unreachablePool)
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    try {
      configureApp(app);
      await app.init();
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database is unreachable',
      });
      // The filter logs the exception it renders; the database error must travel with it.
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({ cause: dbError }));
    } finally {
      logged.mockRestore();
      await app.close();
    }
  });
});
