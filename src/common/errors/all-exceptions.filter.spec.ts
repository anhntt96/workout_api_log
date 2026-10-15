import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { RequestValidationError } from './request-validation.error.js';

@Controller('probe')
class ProbeController {
  @Get('validation')
  validation(): never {
    throw new RequestValidationError([{ field: 'entries[0].date', message: 'date is required' }]);
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('Nothing here');
  }

  @Get('crash')
  crash(): never {
    throw new Error('connection refused: password=secret');
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Get('items/:id')
  item(@Param('id') id: string): string {
    return id;
  }

  @Get('raw-client-error')
  rawClientError(): never {
    throw Object.assign(new Error('internal detail'), { status: 422 });
  }
}

describe('AllExceptionsFilter', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useBodyParser('json', { limit: '1kb' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders validation errors with field paths', async () => {
    const res = await request(app.getHttpServer()).get('/probe/validation');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      errors: [{ field: 'entries[0].date', message: 'date is required' }],
    });
  });

  it('keeps the status and message of HTTP exceptions', async () => {
    const res = await request(app.getHttpServer()).get('/probe/missing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Nothing here' });
  });

  it('renders unknown routes as NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /nope' });
  });

  it('hides the details of unexpected errors', async () => {
    const res = await request(app.getHttpServer()).get('/probe/crash');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  it('turns malformed JSON into a 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"entries": [');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('turns an oversized body into a 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .send({ padding: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('turns a malformed percent-encoded path segment into a 400', async () => {
    const res = await request(app.getHttpServer()).get('/probe/items/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('renders a raw 4xx error without expose as that client error, hiding its message', async () => {
    const res = await request(app.getHttpServer()).get('/probe/raw-client-error');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ statusCode: 422, code: 'HTTP_ERROR', message: 'Unprocessable Entity' });
  });
});
