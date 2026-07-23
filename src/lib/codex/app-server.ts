import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private starting: Promise<void> | null = null;

  private async start(): Promise<void> {
    if (this.process && !this.process.killed) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const codexHome = join(dataDir, "codex");
      mkdirSync(codexHome, { recursive: true, mode: 0o700 });
      const child = spawn(process.env.CODEX_BIN ?? "codex", ["app-server", "--stdio"], {
        cwd: dataDir,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.process = child;
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try { this.receive(JSON.parse(line) as RpcMessage); } catch { /* stderr carries diagnostics */ }
      });
      child.stderr.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) console.error(`[codex] ${text.slice(0, 2_000)}`);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        this.process = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Codex app-server stopped (${code ?? "signal"})`));
        }
        this.pending.clear();
      });
      void this.requestRaw("initialize", {
        clientInfo: { name: "instagram_curator", title: "Instagram Curator", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      }, child).then(() => {
        this.send({ method: "initialized", params: {} }, child);
        resolve();
      }, reject);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  private receive(message: RpcMessage): void {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? "Codex request failed"));
        else pending.resolve(message.result);
      }
    }
    for (const listener of this.listeners) listener(message);
  }

  private send(message: RpcMessage, child = this.process): void {
    if (!child?.stdin.writable) throw new Error("Codex app-server is unavailable");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private requestRaw(method: string, params: unknown, child = this.process, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ method, params: params as Record<string, unknown>, id }, child);
    });
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs?: number): Promise<T> {
    await this.start();
    return this.requestRaw(method, params, this.process, timeoutMs) as Promise<T>;
  }

  onNotification(listener: (message: RpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitFor(method: string, predicate: (params: Record<string, unknown>) => boolean, timeoutMs = 900_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const unsubscribe = this.onNotification((message) => {
        if (message.method === method && message.params && predicate(message.params)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(message.params);
        }
      });
    });
  }

  stop(): void {
    this.process?.kill("SIGTERM");
    this.process = null;
  }
}

const globalCodex = globalThis as typeof globalThis & { curatorCodex?: CodexAppServer };
export const codexAppServer = globalCodex.curatorCodex ?? new CodexAppServer();
if (process.env.NODE_ENV !== "production") globalCodex.curatorCodex = codexAppServer;
