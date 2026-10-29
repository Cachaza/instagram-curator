#!/usr/bin/env python3
"""Stream audio to the Mac; acknowledge results only after durable server storage."""
import argparse
import base64
import http.client
import io
import json
import os
import ssl
import sys
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

BUFFER_SIZE = io.DEFAULT_BUFFER_SIZE
PENDING = ".remote-job.json"


def safe_target(output_dir, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("bridge returned an invalid artifact path")
    path = PurePosixPath(relative)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or relative == PENDING:
        raise ValueError("bridge returned an invalid artifact path")
    root = Path(output_dir).resolve()
    target = root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError("bridge returned an invalid artifact path")
    return target


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_bytes(target, contents):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".transcript-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        sync_directory(target.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def atomic_text(target, contents):
    atomic_bytes(target, contents.encode("utf-8"))


def artifact_bytes(contents):
    if isinstance(contents, str):
        return contents.encode("utf-8")
    if isinstance(contents, dict) and set(contents) == {"base64"} and isinstance(contents["base64"], str):
        return base64.b64decode(contents["base64"], validate=True)
    raise ValueError("bridge returned an invalid artifact")


def bridge_connection(parsed, context, config):
    """Route private TCP through a relay while verifying the URL's TLS identity."""
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, context=context)
    host = config.get("connect_host")
    port = config.get("connect_port", parsed.port or 443)
    if host is not None:
        if not isinstance(host, str) or not host or any(character in host for character in "/@?#"):
            raise ValueError("connect_host must be a network hostname or IP address")
        # These are the TCP protocol's port bounds, not an application capacity.
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("connect_port must be a TCP port from 1 through 65535")
        create_connection = connection._create_connection
        def route(_address, *args, **kwargs):
            return create_connection((host, port), *args, **kwargs)
        connection._create_connection = route
    elif "connect_port" in config:
        raise ValueError("connect_port requires connect_host")
    # HTTPSConnection still supplies parsed.hostname for SNI and certificate
    # hostname verification before sending Authorization or any audio bytes.
    return connection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recover", action="store_true", help="recover/acknowledge a pending result in OUTPUT_DIRECTORY")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    if len(args.paths) != (1 if args.recover else 2):
        parser.error("expected AUDIO_PATH OUTPUT_DIRECTORY, or --recover OUTPUT_DIRECTORY")
    output_dir = Path(args.paths[-1]).resolve()
    pending_path = output_dir / PENDING
    connection = None
    try:
        config_file = os.environ.get("CURATOR_TRANSCRIPTION_BRIDGE_CONFIG_FILE")
        cfg = json.loads(Path(config_file).read_text()) if config_file else {}
        parsed = urlsplit(cfg.get("url", os.environ.get("CURATOR_TRANSCRIPTION_BRIDGE_URL", "")))
        token = cfg.get("token", os.environ.get("CURATOR_TRANSCRIPTION_BRIDGE_TOKEN", ""))
        ca_file = cfg.get("ca_file", os.environ.get("CURATOR_TRANSCRIPTION_BRIDGE_CA_FILE"))
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment or not token:
            raise ValueError("HTTPS bridge URL and token must be configured")
        context = ssl.create_default_context(cafile=ca_file)
        def connect():
            return bridge_connection(parsed, context, cfg)
        connection = connect()  # Validate transport before creating pending state.
        output_dir.mkdir(parents=True, exist_ok=True)
        recover_existing = pending_path.exists()
        if recover_existing:
            pending = json.loads(pending_path.read_text())
        elif args.recover:
            raise ValueError("no pending remote result in this output directory")
        else:
            pending = {"job_id": str(uuid.uuid4()), "stored": False}
            atomic_text(pending_path, json.dumps(pending))
            sync_directory(output_dir.parent)
        job_id = str(uuid.UUID(pending["job_id"]))
        if not pending.get("stored"):
            if args.recover or recover_existing:
                connection.request("GET", "/jobs/" + job_id, headers={"Authorization": "Bearer " + token})
            else:
                audio_path = Path(args.paths[0])
                connection.putrequest("POST", "/transcribe")
                connection.putheader("Authorization", "Bearer " + token)
                connection.putheader("X-Curator-Job-ID", job_id)
                connection.putheader("Content-Type", "application/octet-stream")
                connection.putheader("Content-Length", str(audio_path.stat().st_size))
                connection.endheaders()
                with audio_path.open("rb") as source:
                    while block := source.read(BUFFER_SIZE):
                        connection.send(block)
            response = connection.getresponse()
            data = json.loads(response.read().decode("utf-8"))
            if response.status != 200:
                raise RuntimeError(str(data.get("error", f"bridge returned HTTP {response.status}")))
            if not isinstance(data, dict) or data.get("job_id") != job_id or not isinstance(data.get("files"), dict):
                raise ValueError("bridge returned an invalid response")
            # Validate the complete manifest before writing any returned file.
            targets = [(safe_target(output_dir, name), artifact_bytes(value)) for name, value in data["files"].items()]
            for target, contents in targets:
                atomic_bytes(target, contents)
                parent = target.parent
                while parent != output_dir.parent:
                    sync_directory(parent)
                    parent = parent.parent
            pending.update(stored=True, ok=bool(data.get("ok")), error=data.get("error"))
            atomic_text(pending_path, json.dumps(pending))
            sync_directory(output_dir.parent)
            connection.close()
        connection = connect()
        connection.request("POST", "/jobs/" + job_id + "/ack", body=b"", headers={"Authorization": "Bearer " + token})
        response = connection.getresponse()
        response.read()
        if response.status != 200:
            raise RuntimeError("result acknowledgement failed")
        pending_path.unlink()
        sync_directory(output_dir)
        if not pending["ok"]:
            print(pending.get("error") or "transcription failed", file=sys.stderr)
            return 1
        return 0
    except Exception as exc:
        # Only static bridge error messages are exposed, never response contents.
        if isinstance(exc, RuntimeError):
            print(str(exc), file=sys.stderr)
        else:
            print(f"remote transcription failed: {type(exc).__name__}", file=sys.stderr)
        print(f"Pending results can be recovered with: transcribe-remote.py --recover {output_dir}", file=sys.stderr)
        return 1
    finally:
        if connection:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
