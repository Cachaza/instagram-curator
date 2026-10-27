import { join } from "node:path";

// Bun loads ignored local env files; the MCP itself runs on Node.js, as do
// the tunnel-launched server and protocol integration tests.
const node = Bun.which("node");
if (!node) throw new Error("Node.js is required to run the Curator MCP server.");
const child = Bun.spawn([node, "--import", import.meta.resolve("tsx"), join(import.meta.dir, "../src/mcp/cli.ts")], {
  env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exitCode = await child.exited;
