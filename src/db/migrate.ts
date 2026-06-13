import { query } from './index';
import fs from 'fs';
import path from 'path';

async function runMigrations() {
  console.log('🔧 Running database migrations...\n');

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  → Running ${file}...`);
    try {
      await query(sql);
      console.log(`    ✅ ${file} applied`);
    } catch (err: unknown) {
      const error = err as Error;
      // Skip "already exists" errors for idempotent migrations
      if (error.message?.includes('already exists')) {
        console.log(`    ⏭️  ${file} already applied, skipping`);
      } else {
        console.error(`    ❌ ${file} failed:`, error.message);
        throw error;
      }
    }
  }

  console.log('\n✅ All migrations complete.');
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
