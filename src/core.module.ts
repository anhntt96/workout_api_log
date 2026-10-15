import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './common/clock.js';
import { APP_CONFIG, loadConfig } from './config/app-config.js';

/** App-wide providers: validated configuration and the clock. */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [APP_CONFIG, CLOCK],
})
export class CoreModule {}
