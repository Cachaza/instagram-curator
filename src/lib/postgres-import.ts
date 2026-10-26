import Sqlite from "better-sqlite3";
import { createHash } from "node:crypto";
import { transaction, type Database } from "./db";

export const restaurantMapTables = ["restaurant_geocodes", "geocoding_service_requests", "restaurant_locations"] as const;

export const libraryTables = ["user", "account", "session", "verification", "app_settings", "publications", "analyses", "analysis_versions", "publication_reviews", "pipeline_events", "codex_usage", ...restaurantMapTables] as const;
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
type Row = Record<string, unknown>;
function checksum(rows: Row[]) {
  const canonical = rows.map((row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((key) => [key,
    row[key] instanceof Date ? row[key].toISOString() : row[key],
  ])))).sort();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function importSqliteLibrary(source: Sqlite.Database) {
  if (source.pragma("quick_check", { simple: true }) !== "ok") throw new Error("SQLite source failed integrity verification; restore a valid backup before migrating.");
  const sourceTables = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>).map((row) => row.name));
  const unknown = [...sourceTables].filter((name) => !libraryTables.includes(name as typeof libraryTables[number]) && name !== "schema_migrations" && !name.startsWith("sqlite_") && !name.startsWith("content_search"));
  if (unknown.length) throw new Error(`Unmapped SQLite tables: ${unknown.join(", ")}. Add an explicit migration before continuing.`);
  const data: Record<string, Row[]> = {};
  for (const table of [...libraryTables,"schema_migrations"]) {
    data[table] = sourceTables.has(table) ? source.prepare(`SELECT * FROM ${identifier(table)}`).all() as Row[] : [];
  }
  return importLibraryRows(data);
}

export async function importLibraryRows(data: Record<string, Row[]>) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid library backup: expected table rows.");
  for (const [table,rows] of Object.entries(data)) {
    if (![...libraryTables,"schema_migrations"].includes(table)) throw new Error(`Unmapped backup table ${table}; restore refused.`);
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error(`Invalid rows for ${table}; restore refused.`);
  }
  return transaction(async (tx: Database) => {
    await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended('curator-library-import',0))");
    await tx.execute(`LOCK TABLE ${libraryTables.map(identifier).join(",")} IN ACCESS EXCLUSIVE MODE`);
    // A repeat must fail visibly instead of overwriting the shared live library.
    for (const table of libraryTables) {
      const count = await tx.one<{count: number}>(`SELECT COUNT(*) count FROM ${identifier(table)}`);
      if (count!.count !== 0) throw new Error(`PostgreSQL migration requires an empty target: allowed 0 rows in ${table}, found ${count!.count}. Use a new empty database; do not overwrite the existing library.`);
    }
    const report: Record<string, { rows: number; sha256: string }> = {};
    for (const table of libraryTables) {
      const columns = await tx.all<{column_name: string; data_type: string}>(
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position", [table]);
      const types = new Map(columns.map((column) => [column.column_name,column.data_type]));
      const sourceRows = data[table] ?? [];
      const rows = sourceRows.map((row) => Object.fromEntries(Object.entries(row).map(([name,value]) => {
        if (!types.has(name)) throw new Error(`Unmapped column ${table}.${name}; update the migration before proceeding.`);
        if (value !== null && types.get(name) === "boolean") value = Boolean(value);
        if (value !== null && types.get(name)?.startsWith("timestamp")) {
          value = new Date(typeof value === "number" ? value : String(value));
          if (Number.isNaN((value as Date).getTime())) throw new Error(`Invalid timestamp in ${table}.${name}`);
        }
        return [name,value];
      })));
      for (const row of rows) {
        const names = Object.keys(row);
        await tx.execute(`INSERT INTO ${identifier(table)} (${names.map(identifier).join(",")}) VALUES (${names.map((_,index) => `$${index + 1}`).join(",")})`,Object.values(row));
      }
      const copied = await tx.all(`SELECT ${columns.map((column) => identifier(column.column_name)).join(",")} FROM ${identifier(table)}`);
      // Compare all source columns. New schema-only defaults are independent of
      // the old data; every existing value must match after type conversion.
      const sourceColumns = rows.length ? Object.keys(rows[0]) : [];
      const projected = copied.map((row) => Object.fromEntries(sourceColumns.map((key) => [key,row[key]])));
      const hash = checksum(rows);
      if (copied.length !== rows.length || checksum(projected) !== hash) throw new Error(`Verification failed for ${table}; the transaction will roll back.`);
      report[table] = { rows: rows.length, sha256: hash };
    }
    for (const table of ["pipeline_events", "analysis_versions"]) {
      await tx.execute(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM ${table}`);
    }
    {
      for (const row of data.schema_migrations ?? []) {
        await tx.execute("INSERT INTO schema_migrations(version,name,applied_at) VALUES ($1,$2,$3) ON CONFLICT(version) DO NOTHING", [row.version,row.name,row.applied_at]);
      }
    }
    const search = await tx.one<{count: number}>("SELECT COUNT(*) count FROM content_search");
    const visible = await tx.one<{count: number}>("SELECT COUNT(*) count FROM content_search_documents");
    if (search!.count !== visible!.count) throw new Error("Search index count differs from library documents; migration rolled back.");
    return { tables: report, indexedDocuments: search!.count };
  });
}
