import { join } from "node:path";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTunnelArgs(mode: "doctor" | "run", env: Record<string, string | undefined>, root = join(import.meta.dir, ".."), nodePath = "node") {
  const id = env.CURATOR_TUNNEL_ID?.trim();
  if (!id || !/^tunnel_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("Set CURATOR_TUNNEL_ID to the new Instagram Curator tunnel_… ID from OpenAI Platform. Other projects' tunnel IDs are not used.");
  }
  if (!env.CONTROL_PLANE_API_KEY?.trim()) {
    throw new Error("Set CONTROL_PLANE_API_KEY locally to an OpenAI runtime API key with Tunnels Read + Use. Do not paste the key into chat.");
  }
  const command = `${shellQuote(nodePath)} --import ${shellQuote(import.meta.resolve("tsx"))} ${shellQuote(join(root, "src/mcp/cli.ts"))}`;
  const args = [mode,
    "--control-plane.base-url=https://api.openai.com",
    `--control-plane.tunnel-id=${id}`,
    "--control-plane.api-key=env:CONTROL_PLANE_API_KEY",
    `--mcp.command=command=${command}`,
    // Port 0 asks the OS for a free port, as documented by installed tunnel-client.
    "--health.listen-addr=127.0.0.1:0",
  ];
  if (mode === "doctor") args.push("--explain");
  return args;
}

export function buildTunnelEnv(env: Record<string, string | undefined>): Record<string, string> {
  const hostKeys = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "LANG",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "CONTROL_PLANE_API_KEY", "DATABASE_URL",
  ]);
  return Object.fromEntries(Object.entries(env).filter(([key, value]) =>
    value !== undefined && (hostKeys.has(key) || key.startsWith("LC_") || key.startsWith("CURATOR_")),
  )) as Record<string, string>;
}

if (import.meta.main) {
  try {
    const mode = process.argv[2];
    if (mode !== "doctor" && mode !== "run") throw new Error("Usage: bun run scripts/mcp-tunnel.ts doctor|run");
    if (!Bun.which("tunnel-client")) throw new Error("tunnel-client is not installed. Install it using the download link in OpenAI Platform tunnel settings.");
    const nodePath = Bun.which("node");
    if (!nodePath) throw new Error("Node.js is required to run the Curator MCP server.");
    const args = buildTunnelArgs(mode, process.env, undefined, nodePath);
    // Keep run/doctor independent from another project's profile or server targets.
    const env = buildTunnelEnv(process.env);
    const child = Bun.spawn(["tunnel-client", ...args], { cwd: join(import.meta.dir, ".."), env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exitCode = await child.exited;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
