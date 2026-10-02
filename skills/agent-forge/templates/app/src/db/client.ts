/**
 * Single pg pool + Drizzle instance per process.
 * Why a global: Next.js dev re-evaluates modules on every change; reusing the pool avoids
 * exhausting Postgres connections.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '@/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { afPool?: pg.Pool };

/** Bounded Postgres connection pool, reused across development hot reloads. The owning process closes it during shutdown. */
export const pool = globalForDb.afPool ?? new pg.Pool({ connectionString: env().DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.afPool = pool;

/** Schema-aware Drizzle database backed by the shared connection pool. */
export const db = drizzle(pool, { schema });
/** Injectable application database type used by services, tools, retrieval and tests. */
export type Db = typeof db;
