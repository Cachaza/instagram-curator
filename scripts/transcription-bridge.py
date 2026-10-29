#!/usr/bin/env python3
"""Private HTTPS transcription service; media is temporary, results await acknowledgement."""
import argparse
import base64
import hmac
import http.server
import io
import json
import os
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from transcription_processes import cancel_members, group_members

TRANSFER_BUFFER_SIZE = io.DEFAULT_BUFFER_SIZE


def regular_artifacts(root):
    files = {}
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if not (Path(base) / name).is_symlink()]
        for name in names:
            path = Path(base) / name
            if path.is_symlink() or not path.is_file():
                continue
            raw = path.read_bytes()
            try:
                contents = raw.decode("utf-8")
            except UnicodeDecodeError:
                contents = {"base64": base64.b64encode(raw).decode("ascii")}
            files[path.relative_to(root).as_posix()] = contents
    return files


def save_json(directory, name, result):
    fd, temporary = tempfile.mkstemp(prefix=".result-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / name)
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        Path(temporary).unlink(missing_ok=True)


def save_result(directory, result):
    save_json(directory, "result.json", result)


def stop_owned_group(directory):
    owner = directory / "owner.json"
    if not owner.is_file():
        return
    group = int(json.loads(owner.read_text())["group"])
    members = group_members(group)
    if not members:
        return
    if not any(str(directory) in command for _, command in members):
        raise RuntimeError("Previous transcription process identity changed; refusing to remove its output or stop unrelated processes")
    cancel_members(group)


def initialize_server(server, command, token, spool):
    server.command, server.token = command, token
    server.job_lock = threading.Lock()
    server.state_lock = threading.Lock()
    server.processes, server.sockets = set(), set()
    server.stopping = threading.Event()
    server.spool = Path(spool)
    server.spool.mkdir(mode=0o700, parents=True, exist_ok=True)
    if server.spool.is_symlink():
        raise ValueError("bridge spool must be a private real directory")
    # Media from a killed previous service must not remain on this machine.
    # Retain only result text until the server confirms durable storage.
    directories = list(server.spool.iterdir())
    for directory in directories:
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("unexpected entry in bridge spool")
        uuid.UUID(directory.name)
        try:
            stop_owned_group(directory)
        finally:
            (directory / "audio.wav").unlink(missing_ok=True)
    for directory in directories:
        if not (directory / "result.json").is_file():
            output = directory / "output"
            files = regular_artifacts(output) if output.is_dir() else {}
            save_result(directory, {"ok": False, "files": files, "job_id": directory.name,
                                    "error": "transcription interrupted by service shutdown"})
        for entry in directory.iterdir():
            if entry.name != "result.json":
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()


class ThreadedTLSServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def get_request(self):
        request, address = self.socket.accept()
        with self.state_lock:
            self.sockets.add(request)
        return request, address

    def process_request_thread(self, request, address):
        wrapped = None
        try:
            # Handshakes run in connection threads, never in the accept loop.
            wrapped = self.tls_context.wrap_socket(request, server_side=True,
                                                   do_handshake_on_connect=False)
            with self.state_lock:
                self.sockets.discard(request)
                self.sockets.add(wrapped)
            wrapped.do_handshake()
            super().process_request_thread(wrapped, address)
        except (OSError, ssl.SSLError):
            pass
        finally:
            with self.state_lock:
                self.sockets.discard(request)
                self.sockets.discard(wrapped)
            (wrapped or request).close()

    def stop_jobs(self):
        self.stopping.set()
        with self.state_lock:
            for process in self.processes:
                try:
                    # Service shutdown cancels inference immediately. A model
                    # that ignores SIGTERM must not retain audio or block stop.
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            for request in self.sockets:
                try:
                    request.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        # Handlers finish child wait, save recoverable results, and remove audio.
        with self.job_lock:
            pass


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    server_version = "CuratorTranscriptionBridge"

    def log_message(self, *_):
        pass

    def _authorized(self):
        return hmac.compare_digest(self.headers.get("Authorization", "").encode(),
                                   ("Bearer " + self.server.token).encode())

    def _json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _job(self, value):
        try:
            parsed = str(uuid.UUID(value))
            if parsed != value:
                raise ValueError()
            return self.server.spool / parsed
        except (ValueError, AttributeError):
            return None

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"ok": False, "error": "unauthorized"})
        if self.path == "/health":
            return self._json(200, {"ok": True})
        if self.path.startswith("/jobs/"):
            directory = self._job(self.path.removeprefix("/jobs/"))
            if directory and (directory / "result.json").is_file():
                return self._json(200, json.loads((directory / "result.json").read_text()))
            return self._json(404, {"ok": False, "error": "result not available"})
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"ok": False, "error": "unauthorized"})
        if self.path.startswith("/jobs/") and self.path.endswith("/ack"):
            directory = self._job(self.path[len("/jobs/"):-len("/ack")])
            if not directory:
                return self._json(400, {"ok": False, "error": "invalid job identifier"})
            if (directory / "result.json").is_file():
                shutil.rmtree(directory)
            return self._json(200, {"ok": True})
        if self.path != "/transcribe":
            return self._json(404, {"ok": False, "error": "not found"})
        try:
            requested = int(self.headers.get("Content-Length", ""))
            if requested < 0:
                raise ValueError()
        except ValueError:
            return self._json(400, {"ok": False, "error": "valid Content-Length required"})
        directory = self._job(self.headers.get("X-Curator-Job-ID", str(uuid.uuid4())))
        if not directory:
            return self._json(400, {"ok": False, "error": "invalid job identifier"})
        if self.server.stopping.is_set() or not self.server.job_lock.acquire(blocking=False):
            return self._json(503, {"ok": False, "error": "transcription capacity: allowed 1 active job, requested 2; retry after the active job completes"})
        process = None
        owner_fd = None
        stopped = True
        try:
            if directory.exists():
                return self._json(409, {"ok": False, "error": "job already exists; recover its result using GET /jobs/ID"})
            directory.mkdir(mode=0o700)
            descriptor = os.open(self.server.spool, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            output = directory / "output"
            output.mkdir()
            audio = directory / "audio.wav"
            response = None
            try:
                free = shutil.disk_usage(directory).free
                if requested > free:
                    return self._json(507, {"ok": False, "error": f"temporary disk capacity: allowed {free} bytes, requested {requested}; free disk space and retry"})
                remaining = requested
                with audio.open("wb") as stream:
                    while remaining:
                        chunk = self.rfile.read(min(TRANSFER_BUFFER_SIZE, remaining))
                        if not chunk:
                            raise ConnectionError("request body ended before Content-Length")
                        stream.write(chunk)
                        remaining -= len(chunk)
                with self.server.state_lock:
                    if self.server.stopping.is_set():
                        raise RuntimeError("service shutting down")
                    child_fd, owner_fd = os.pipe()
                    try:
                        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("transcription-child.py")), str(child_fd), str(directory),
                                                   *self.server.command, str(audio), str(output)],
                                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                               stderr=subprocess.DEVNULL, start_new_session=True,
                                               pass_fds=(child_fd,))
                    finally:
                        os.close(child_fd)
                    self.server.processes.add(process)
                save_json(directory, "owner.json", {"group": process.pid})
                os.write(owner_fd, b"start")
                stopped = False
                status = process.wait()
                stop_owned_group(directory)
                stopped = True
                response = {"ok": status == 0, "files": regular_artifacts(output), "job_id": directory.name}
                if status:
                    response["error"] = f"transcription command exited with status {status}"
            except Exception:
                # Do not inspect or remove output while an unverified writer
                # might still be running. Keep it for safe startup recovery.
                if not stopped:
                    stop_owned_group(directory)
                    stopped = True
                response = {"ok": False, "files": regular_artifacts(output), "job_id": directory.name,
                            "error": "transcription command or upload could not be completed"}
            finally:
                if owner_fd is not None:
                    os.close(owner_fd)
                if process:
                    if process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait()
                    with self.server.state_lock:
                        self.server.processes.discard(process)
                audio.unlink(missing_ok=True)
                if response:
                    save_result(directory, response)
                    # Never discard originals unless the result is durable.
                    shutil.rmtree(output)
            # Result text survives disconnects until a durable server-side ACK.
            if response:
                self._json(200, response)
        except (ConnectionError, OSError):
            return
        finally:
            self.server.job_lock.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    cfg = json.loads(Path(parser.parse_args().config).read_text())
    if not isinstance(cfg.get("command"), list) or not cfg["command"] or any(not isinstance(x, str) or not x for x in cfg["command"]):
        parser.error("command must be a nonempty argv array")
    if not isinstance(cfg.get("token"), str) or not cfg["token"]:
        parser.error("token must be a nonempty string")
    server = ThreadedTLSServer((cfg["bind_host"], int(cfg["port"])), BridgeHandler)
    spool = cfg.get("spool_dir", str(Path(tempfile.gettempdir()) / "curator-transcription-jobs"))
    initialize_server(server, cfg["command"], cfg["token"], spool)
    server.tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.tls_context.load_cert_chain(cfg["tls_cert_file"], cfg["tls_key_file"])
    def stop(*_):
        server.stopping.set()
        def shutdown():
            server.stop_jobs()
            server.shutdown()
        threading.Thread(target=shutdown).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(json.dumps({"ready": True, "host": server.server_address[0], "port": server.server_address[1]}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.stop_jobs()
        server.server_close()


if __name__ == "__main__":
    main()
