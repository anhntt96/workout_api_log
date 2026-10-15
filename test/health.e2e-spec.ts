import request from 'supertest';
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
});
