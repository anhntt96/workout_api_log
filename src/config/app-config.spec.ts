import { loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })).toEqual({
      databaseUrl: 'postgres://u:p@localhost:5432/db',
      port: 3000,
      logLevel: 'info',
      dbPoolMax: 10,
    });
  });

  it('parses numeric settings from strings', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      PORT: '8080',
      DB_POOL_MAX: '25',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({ port: 8080, dbPoolMax: 25, logLevel: 'debug' });
  });

  it('fails fast and names every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud' })).toThrow(/DATABASE_URL.*PORT.*LOG_LEVEL/s);
  });
});
