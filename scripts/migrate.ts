import { migrateAppDatabase, pool } from "../src/lib/db";
try {
  await migrateAppDatabase();
  console.log("PostgreSQL application and authentication schemas migrated.");
} finally {
  await pool.end();
}
