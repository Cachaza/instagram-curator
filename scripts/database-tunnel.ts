import { spawn } from "node:child_process";

const target = process.env.CURATOR_DATABASE_SSH_TARGET;
const remoteHost = process.env.CURATOR_DATABASE_REMOTE_HOST;
const remotePort = process.env.CURATOR_DATABASE_REMOTE_PORT;
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (!target || !remoteHost || !remotePort || !url || !["127.0.0.1","localhost"].includes(url.hostname) || !url.port) {
  throw new Error("Configure a loopback DATABASE_URL with an explicit local port and CURATOR_DATABASE_SSH_TARGET, CURATOR_DATABASE_REMOTE_HOST and CURATOR_DATABASE_REMOTE_PORT. This tunnel is only needed by the Mac; Dokploy uses its internal database network.");
}
if (![remotePort,url.port].every((port) => /^\d+$/.test(port))) throw new Error("Database tunnel ports must be TCP port numbers.");
const child = spawn("ssh",["-N","-o","ExitOnForwardFailure=yes","-L",`127.0.0.1:${url.port}:${remoteHost}:${remotePort}`,target],{stdio:"inherit"});
for (const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,() => child.kill(signal));
child.on("error",(error) => { console.error(error.message); process.exitCode=1; });
child.on("exit",(code) => { process.exitCode=code ?? 1; });
