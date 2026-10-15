import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

/** Largest accepted JSON body. A full bulk request (50 entries × 50 sets) is just over 100 kB. */
export const JSON_BODY_LIMIT = '1mb';

/** HTTP setup shared by main.ts and the end-to-end tests. */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.disable('x-powered-by');
}
