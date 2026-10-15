import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { assignRequestId } from './common/logging/request-id.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { CoreModule } from './core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ExercisesModule } from './exercises/exercises.module.js';
import { HealthController } from './health/health.controller.js';
import { PersonalRecordsModule } from './personal-records/personal-records.module.js';
import { WorkoutsModule } from './workouts/workouts.module.js';

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: { level: config.logLevel, genReqId: assignRequestId },
      }),
    }),
    DatabaseModule,
    ExercisesModule,
    WorkoutsModule,
    PersonalRecordsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
