import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

export function databaseConfig(env: Record<string,string | undefined> = process.env): PoolConfig {
  const url = env.DATABASE_URL;
  if (url) {
    const parameters = [...new URL(url).searchParams.keys()].map((key) => key.toLowerCase());
    if (parameters.includes("options")) throw new Error("Remove options from DATABASE_URL; Curator manages authentication transaction isolation explicitly.");
    if (env.CURATOR_DATABASE_CA_FILE && parameters.some((key) => key.startsWith("ssl") || key === "uselibpqcompat")) {
      throw new Error("Remove SSL parameters from DATABASE_URL when CURATOR_DATABASE_CA_FILE is configured; the pinned CA and hostname verification must control TLS.");
    }
  }
  return {
    // An unconfigured build must not infer a local database from PG* defaults.
    connectionString: url ?? "postgresql://configuration-required@127.0.0.1/curator-unconfigured",
    ...(env.CURATOR_DATABASE_CA_FILE ? {
      ssl: {ca:readFileSync(env.CURATOR_DATABASE_CA_FILE,"utf8"),rejectUnauthorized:true},
    } : {}),
    allowExitOnIdle:true,
  };
}
