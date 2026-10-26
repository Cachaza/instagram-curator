import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";

/** Runs a fixture in a fresh synthetic database. Never falls back to DATABASE_URL. */
export async function withPostgresDatabase<T>(work: (databaseUrl: string) => Promise<T>): Promise<T> {
  const adminUrl = process.env.CURATOR_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("CURATOR_TEST_DATABASE_URL must point to the synthetic test PostgreSQL server.");

  const parsed = new URL(adminUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("CURATOR_TEST_DATABASE_URL must use a loopback host; refusing to create a database elsewhere.");
  }
  if (parsed.pathname.slice(1) !== "curator_test") {
    throw new Error("CURATOR_TEST_DATABASE_URL must connect to the curator_test admin database.");
  }

  const databaseName = `curator_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    parsed.pathname = `/${databaseName}`;
    return await work(parsed.toString());
  } finally {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [databaseName]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
    await admin.end();
  }
}

export function runPostgresScript(script: string, databaseUrl: string, extraEnv: Record<string, string | undefined> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "curator-pg-fixture-"));
  const env: NodeJS.ProcessEnv = { ...process.env, CURATOR_DATA_DIR: directory, ...extraEnv, DATABASE_URL: databaseUrl };
  try {
    return spawnSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(), env, encoding: "utf8",
    });
  } finally { rmSync(directory, {recursive:true,force:true}); }
}
