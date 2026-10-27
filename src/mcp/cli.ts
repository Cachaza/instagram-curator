import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCuratorMcpServer } from "./server";

// The tunnel runtime key authenticates the launcher, never library tools.
delete process.env.CONTROL_PLANE_API_KEY;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the shared Curator library.");
const server = createCuratorMcpServer();
await server.connect(new StdioServerTransport());
