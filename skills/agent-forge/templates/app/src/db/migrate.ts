/** Applies SQL migrations in ./drizzle. Run: pnpm db:migrate */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('migrations applied');
