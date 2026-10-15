import type { Pool, PoolClient } from 'pg';

/** Runs `work` in a transaction on one pooled connection; rolls back and rethrows on failure. */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connectionBroken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      connectionBroken = true;
    });
    throw error;
  } finally {
    // `true` destroys a connection that could not roll back instead of returning it to the pool.
    client.release(connectionBroken);
  }
}
