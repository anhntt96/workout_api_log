import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { PG_POOL } from './database/database.module.js';
import { migrate } from './database/migrate.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true,
  bodyParser: false,
});
configureApp(app);
app.enableShutdownHooks();

// The runner takes an advisory lock, so several instances can start at the same time safely.
const applied = await migrate(app.get<Pool>(PG_POOL));
new Logger('Migrations').log(applied.length > 0 ? `Applied ${applied.join(', ')}` : 'Schema is up to date');

await app.listen(app.get<AppConfig>(APP_CONFIG).port);
