import { resolve } from "node:path";

export const dataDir = resolve(
  /* turbopackIgnore: true */ process.env.CURATOR_DATA_DIR ?? "./data",
);
export const databasePath = resolve(dataDir, "curator.sqlite");
