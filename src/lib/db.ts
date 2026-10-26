import { Pool, types, defaults, type PoolClient, type QueryResultRow } from "pg";
import { databaseConfig } from "./database-config";
import { applicationSchema, searchSchema } from "./postgres-schema";

// JavaScript's exact integer range is an external runtime constraint. Never
// silently round PostgreSQL bigint counters or identifiers.
types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Integer precision limit: allowed absolute value ${Number.MAX_SAFE_INTEGER}; requested ${value}. Export this value as text or use bigint before increasing stored counters.`);
  return number;
});

// Preserve UTC epoch dates across Mac and server, including timestamp columns
// from older Better Auth schemas. Current auth timestamps include a time zone.
defaults.parseInputDatesAsUTC = true;
types.setTypeParser(1114, (value) => new Date(value.replace(" ","T") + "Z"));

// Only migration/import tools open SQLite. Runtime data always comes from this
// shared pool; a missing URL must never silently create an empty local library.
export const pool = new Pool(databaseConfig());
// Better Auth wraps signup in one transaction. Serializable isolation makes
// the initial user-count predicate and insertion indivisible across hosts:
// competing bootstrap transactions cannot both create an administrator.
export const authPool = new Pool({...databaseConfig(),options:"-c default_transaction_isolation=serializable"});

export type Database = {
  all<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<void>;
};

function database(client: Pool | PoolClient): Database {
  const query = (sql: string, params: unknown[] = []) => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure the shared PostgreSQL database before starting Curator.");
    return client.query(sql, params);
  };
  return {
    async all<T extends QueryResultRow>(sql: string, params?: unknown[]) { return (await query(sql, params)).rows as T[]; },
    async one<T extends QueryResultRow>(sql: string, params?: unknown[]) { return (await query(sql, params)).rows[0] as T | undefined; },
    async execute(sql: string, params?: unknown[]) { await query(sql, params); },
  };
}

export const db = database(pool);

export async function transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL transactions.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(database(client));
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateAppDatabase(): Promise<void> {
  await transaction(async (tx) => {
    // A named advisory lock serializes migration checks across Mac/web/worker.
    await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended('curator-schema-migrations',0))");
    await tx.execute(applicationSchema);
    // Compile Better Auth's installed-version schema while holding the same
    // migration lock, then execute it in this transaction as well.
    const { getMigrations } = await import("better-auth/db/migration");
    const { auth } = await import("./auth");
    const authMigration = await getMigrations(auth.options);
    if (authMigration.toBeCreated.length || authMigration.toBeAdded.length) {
      await tx.execute(await authMigration.compileMigrations());
    }
    if (!await tx.one("SELECT version FROM schema_migrations WHERE version=5")) {
      await tx.execute(searchSchema);
      await tx.execute("INSERT INTO schema_migrations(version,name) VALUES (5,'postgresql-shared-library')");
    }
    await tx.execute("INSERT INTO schema_migrations(version,name) VALUES (6,'restaurant-map-locations') ON CONFLICT(version) DO NOTHING");
  });
}
