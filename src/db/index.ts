import { Pool, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';
import { mockQuery } from './mockDb';

const envResult = dotenv.config({ override: true });
console.log('🔍 [Dotenv Diagnosis] Parsed values from .env:', envResult.parsed);
console.log('🔍 [Dotenv Diagnosis] Resolved DATABASE_URL in process.env:', process.env.DATABASE_URL);

export let useMockDb = false;

const dbUrl = process.env.DATABASE_URL || '';
const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl === '';

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased to 10s for remote connection resilience
});

pool.on('error', (err) => {
  if (!useMockDb) {
    console.error('Unexpected database pool error:', err);
  }
});

// Connection check at startup
pool.connect()
  .then((client) => {
    console.log('🔌 [Database] PostgreSQL connected successfully.');
    client.release();
  })
  .catch((err) => {
    useMockDb = true;
    console.warn('⚠️  [Database] PostgreSQL offline or unconfigured at ' + (process.env.DATABASE_URL || 'localhost:5432') + '.');
    console.warn('ℹ️  [Database] Falling back to in-memory mock database mode.');
  });

// Typed query helper
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (useMockDb) {
    return mockQuery(text, params as any[]);
  }

  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    console.warn(`Slow query (${duration}ms):`, text.substring(0, 80));
  }

  return result;
}

// Transaction helper
export async function withTransaction<T>(
  fn: (query: (text: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>
): Promise<T> {
  if (useMockDb) {
    return fn((text, params) => mockQuery(text, params as any[]));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;

