import { spawn } from "node:child_process";

export async function runCommand(command: string[], options: { inheritStdin?: boolean } = {}): Promise<void> {
  if (command.length === 0) throw new Error("Empty command");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      stdio: [options.inheritStdin ? "inherit" : "ignore", "inherit", "pipe"],
      env: process.env,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command[0]} exited with ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}

export async function runCommandCapture(command: string[]): Promise<string> {
  if (command.length === 0) throw new Error("Empty command");
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command[0]} exited with ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}
