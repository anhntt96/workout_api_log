import { Pool } from 'pg';
import { inject } from 'vitest';
import '../src/database/database.module.js'; // registers the DATE type parser
import { migrate } from '../src/database/migrate.js';
import { withTransaction } from '../src/database/transaction.js';

describe('database', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject('databaseUrl') });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has nothing left to migrate after the global setup', async () => {
    await expect(migrate(pool)).resolves.toEqual([]);
  });

  it('seeds the exercise catalog, each exercise mapped to muscle groups', async () => {
    const { rows } = await pool.query<{ name: string; groups: number }>(
      `SELECT e.name::text AS name, count(em.muscle_group_id)::int AS groups
       FROM exercises e LEFT JOIN exercise_muscle_groups em ON em.exercise_id = e.id
       GROUP BY e.name`,
    );
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.groups > 0)).toBe(true);
  });

  it('returns DATE columns as YYYY-MM-DD strings, independent of the server time zone', async () => {
    const { rows } = await pool.query<{ day: string }>("SELECT DATE '2026-10-14' AS day");
    expect(rows[0].day).toBe('2026-10-14');
  });

  it('rolls back every statement when the work fails', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query("INSERT INTO muscle_groups (name) VALUES ('forearms')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rowCount } = await pool.query("SELECT 1 FROM muscle_groups WHERE name = 'forearms'");
    expect(rowCount).toBe(0);
  });

  it('rejects negative weights at the storage boundary', async () => {
    await expect(
      pool.query(
        `INSERT INTO workout_entries (id, user_id, exercise_id, performed_on, best_weight_kg, best_volume_kg, best_e1rm_kg)
         SELECT gen_random_uuid(), gen_random_uuid(), id, DATE '2026-10-14', -1, 0, 0 FROM exercises LIMIT 1`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
