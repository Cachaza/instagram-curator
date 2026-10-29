import importlib.util
import json
import os
import pathlib
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("transcription_bridge", ROOT / "scripts/transcription-bridge.py")
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)
client_spec = importlib.util.spec_from_file_location("transcribe_remote", ROOT / "scripts/transcribe-remote.py")
client = importlib.util.module_from_spec(client_spec)
sys.modules[client_spec.name] = client
client_spec.loader.exec_module(client)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bridge-test-")
        self.root = pathlib.Path(self.temp.name)
        self.bridge_temp = self.root / "bridge-temp"
        self.bridge_temp.mkdir()
        self.spool = self.root / "spool"
        self.original_tempdir = tempfile.tempdir
        tempfile.tempdir = str(self.bridge_temp)
        self.cert = self.root / "cert.pem"
        self.key = self.root / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(self.key), "-out", str(self.cert), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        command = [sys.executable, "-c", "import pathlib,sys; out=pathlib.Path(sys.argv[2]); (out/'transcript.raw.json').write_text('{\"text\":\"synthetic\"}'); (out/'result.txt').write_text('ok')"]
        self.server = bridge.ThreadedTLSServer(("127.0.0.1", 0), bridge.BridgeHandler)
        bridge.initialize_server(self.server, command, "test-token", self.spool)
        self.server.tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.server.tls_context.load_cert_chain(self.cert, self.key)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"https://localhost:{self.server.server_address[1]}"
        self.client_context = ssl.create_default_context(cafile=str(self.cert))

    def tearDown(self):
        self.server.stop_jobs()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()
        tempfile.tempdir = self.original_tempdir

    def run_client(self, output, trusted=True, recover=False):
        audio = self.root / "input.wav"
        audio.write_bytes(b"synthetic audio")
        config = self.root / "client.json"
        config.write_text(json.dumps({"url": self.url, "token": "test-token", **({"ca_file": str(self.cert)} if trusted else {})}))
        env = os.environ.copy()
        env["CURATOR_TRANSCRIPTION_BRIDGE_CONFIG_FILE"] = str(config)
        args = [sys.executable, str(ROOT / "scripts/transcribe-remote.py")]
        args += ["--recover", str(output)] if recover else [str(audio), str(output)]
        return subprocess.run(args, env=env, capture_output=True, text=True)

    def request(self, path, body=b"", token="test-token"):
        req = urllib.request.Request(self.url + path, body, headers={"Authorization": f"Bearer {token}"}, method="POST" if body or path.endswith("/ack") or path == "/transcribe" else "GET")
        try:
            with urllib.request.urlopen(req, context=self.client_context) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def test_auth_and_health(self):
        status, _ = self.request("/health", token="wrong")
        self.assertEqual(status, 401)
        req = urllib.request.Request(self.url + "/health", headers={"Authorization": "Bearer test-token"})
        with urllib.request.urlopen(req, context=self.client_context) as response:
            self.assertEqual(json.loads(response.read()), {"ok": True})

    def test_success_and_temp_cleanup(self):
        status, result = self.request("/transcribe", b"synthetic audio")
        self.assertEqual(status, 200)
        self.assertTrue(result["ok"])
        self.assertEqual(json.loads(result["files"]["transcript.raw.json"])["text"], "synthetic")
        job = self.spool / result["job_id"]
        self.assertTrue((job / "result.json").is_file())
        self.assertFalse((job / "audio.wav").exists())
        self.assertFalse((job / "output").exists())
        self.request(f"/jobs/{result['job_id']}/ack")
        self.assertFalse(job.exists())
        self.assertEqual(list(self.bridge_temp.iterdir()), [])

    def test_failure_preserves_artifacts_and_cleans(self):
        self.server.command = [sys.executable, "-c", "import pathlib,sys; pathlib.Path(sys.argv[2], 'partial.txt').write_text('partial'); sys.exit(7)"]
        status, result = self.request("/transcribe", b"audio")
        self.assertEqual(status, 200)
        self.assertFalse(result["ok"])
        self.assertEqual(result["files"]["partial.txt"], "partial")
        job = self.spool / result["job_id"]
        self.assertFalse((job / "audio.wav").exists())
        self.assertFalse((job / "output").exists())
        self.assertTrue((job / "result.json").exists())

    def test_cli_writes_returned_transcript(self):
        output = self.root / "cli-output"
        run = self.run_client(output)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads((output / "transcript.raw.json").read_text()), {"text": "synthetic"})
        self.assertFalse((output / client.PENDING).exists())
        self.assertEqual(list(self.spool.iterdir()), [])

    def test_cli_failure_preserves_raw_artifacts_and_exits_nonzero(self):
        self.server.command = [sys.executable, "-c", "import pathlib,sys; pathlib.Path(sys.argv[2], 'transcript.raw.json').write_text('{\\\"text\\\":\\\"partial\\\"}'); sys.exit(7)"]
        output = self.root / "cli-failed-output"
        run = self.run_client(output)
        self.assertNotEqual(run.returncode, 0)
        self.assertEqual(json.loads((output / "transcript.raw.json").read_text()), {"text": "partial"})

    def test_cli_rejects_untrusted_tls(self):
        output = self.root / "untrusted-output"
        run = self.run_client(output, trusted=False)
        self.assertNotEqual(run.returncode, 0)
        self.assertTrue((output / client.PENDING).is_file())

    def test_cli_preserves_truncated_utf8_artifact_bytes(self):
        self.server.command = [sys.executable, "-c", "import pathlib,sys; p=pathlib.Path(sys.argv[2]); (p/'valid.txt').write_text('kept'); (p/'truncated.txt').write_bytes(bytes([226,130])); sys.exit(7)"]
        output = self.root / "binary-output"
        result = self.run_client(output)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((output / "valid.txt").read_text(), "kept")
        self.assertEqual((output / "truncated.txt").read_bytes(), bytes([226, 130]))
        self.assertEqual(list(self.spool.iterdir()), [])

    def test_cli_capacity_rejection_has_no_output_or_temp_side_effects(self):
        self.server.job_lock.acquire()
        try:
            before = set(self.bridge_temp.iterdir())
            output = self.root / "capacity-output"
            run = self.run_client(output)
            self.assertNotEqual(run.returncode, 0)
            self.assertIn("capacity", run.stderr)
            self.assertTrue((output / client.PENDING).is_file())
            self.assertEqual(set(self.bridge_temp.iterdir()), before)
        finally:
            self.server.job_lock.release()

    def test_client_rejects_traversal(self):
        with self.assertRaises(ValueError):
            client.safe_target(self.root / "output", "../outside.txt")
        with self.assertRaises(ValueError):
            client.safe_target(self.root / "output", "/etc/passwd")

    def test_broken_response_can_be_recovered_and_acknowledged(self):
        ready = threading.Event()
        original = bridge.BridgeHandler._json
        def fail_delivery(handler, status, value):
            if handler.path == "/transcribe" and status == 200:
                ready.set()
                raise BrokenPipeError("synthetic disconnect")
            return original(handler, status, value)
        bridge.BridgeHandler._json = fail_delivery
        job_id = str(uuid.uuid4())
        try:
            req = urllib.request.Request(self.url + "/transcribe", b"synthetic audio", headers={"Authorization": "Bearer test-token", "X-Curator-Job-ID": job_id}, method="POST")
            with self.assertRaises((OSError, urllib.error.URLError)):
                urllib.request.urlopen(req, context=self.client_context)
            self.assertTrue(ready.is_set())
        finally:
            bridge.BridgeHandler._json = original
        status, result = self.request("/jobs/" + job_id)
        self.assertEqual(status, 200)
        self.assertTrue(result["ok"])
        self.assertEqual(result["files"]["result.txt"], "ok")
        directory = self.spool / job_id
        self.assertFalse((directory / "audio.wav").exists())
        self.assertFalse((directory / "output").exists())
        status, _ = self.request("/jobs/" + job_id + "/ack")
        self.assertEqual(status, 200)
        self.assertFalse(directory.exists())

    def test_stalled_tls_handshake_does_not_block_healthy_client(self):
        stalled = socket.create_connection(("127.0.0.1", self.server.server_address[1]))
        try:
            status, health = self.request("/health")
            self.assertEqual(status, 200)
            self.assertEqual(health, {"ok": True})
        finally:
            stalled.close()

    def test_startup_converts_orphaned_job_to_interrupted_result(self):
        job_id = str(uuid.uuid4())
        directory = self.spool / job_id
        directory.mkdir()
        (directory / "audio.wav").write_bytes(b"private audio")
        output = directory / "output"
        output.mkdir()
        (output / "partial.txt").write_text("partial")
        (output / "truncated.txt").write_bytes(bytes([226, 130]))
        replacement = bridge.ThreadedTLSServer(("127.0.0.1", 0), bridge.BridgeHandler)
        try:
            bridge.initialize_server(replacement, [], "token", self.spool)
            result = json.loads((directory / "result.json").read_text())
            self.assertFalse(result["ok"])
            self.assertEqual(result["files"]["partial.txt"], "partial")
            self.assertEqual(client.artifact_bytes(result["files"]["truncated.txt"]), bytes([226, 130]))
            self.assertIn("interrupted", result["error"])
            self.assertFalse((directory / "audio.wav").exists())
            self.assertFalse(output.exists())
        finally:
            replacement.server_close()

    def test_service_sigterm_kills_running_command_and_retains_result_text(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as ready_socket:
            ready_socket.bind(("127.0.0.1", 0))
            ready_socket.settimeout(None)
            ready_port = ready_socket.getsockname()[1]
            spool = self.root / "signal-spool"
            command = [sys.executable, "-c", "import pathlib,socket,sys,os,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); out=pathlib.Path(sys.argv[2]); (out/'partial.txt').write_text('kept'); s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.sendto(str(os.getpid()).encode(),('127.0.0.1',int(os.environ['READY_PORT']))); signal.pause()"]
            config = self.root / "service.json"
            with socket.socket() as port_socket:
                port_socket.bind(("127.0.0.1", 0))
                port = port_socket.getsockname()[1]
            config.write_text(json.dumps({"bind_host": "127.0.0.1", "port": port, "token": "test-token", "command": command, "spool_dir": str(spool), "tls_cert_file": str(self.cert), "tls_key_file": str(self.key)}))
            env = os.environ.copy()
            env["READY_PORT"] = str(ready_port)
            wrapper = "import importlib.util,socket; p=%r; s=importlib.util.spec_from_file_location('service',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); original=m.ThreadedTLSServer.serve_forever; m.ThreadedTLSServer.serve_forever=lambda self,*a,**k:(socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'ready',('127.0.0.1',int(__import__('os').environ['READY_PORT']))),original(self,*a,**k)); m.main()" % str(ROOT / "scripts/transcription-bridge.py")
            service = subprocess.Popen([sys.executable, "-c", wrapper, "--config", str(config)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            request_error = []
            def submit():
                try:
                    req = urllib.request.Request(f"https://localhost:{port}/transcribe", b"audio", headers={"Authorization": "Bearer test-token"}, method="POST")
                    urllib.request.urlopen(req, context=ssl.create_default_context(cafile=str(self.cert))).read()
                except Exception as exc:
                    request_error.append(exc)
            worker = threading.Thread(target=submit)
            try:
                self.assertEqual(ready_socket.recvfrom(bridge.TRANSFER_BUFFER_SIZE)[0], b"ready")
                worker.start()
                child_pid = int(ready_socket.recvfrom(bridge.TRANSFER_BUFFER_SIZE)[0])
                service.send_signal(__import__("signal").SIGTERM)
                service.wait()
                worker.join()
                self.assertEqual(service.returncode, 0)
                self.assertEqual(len(list(spool.iterdir())), 1)
                directory = next(spool.iterdir())
                result = json.loads((directory / "result.json").read_text())
                self.assertFalse(result["ok"])
                self.assertEqual(result["files"]["partial.txt"], "kept")
                self.assertFalse((directory / "audio.wav").exists())
                self.assertFalse((directory / "output").exists())
                with self.assertRaises(ProcessLookupError):
                    os.kill(child_pid, 0)
            finally:
                if service.poll() is None:
                    service.kill()
                    service.wait()
                if worker.is_alive():
                    worker.join()

    def test_forced_service_exit_stops_model_before_restart_collects_artifacts(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as ready_socket:
            ready_socket.bind(("127.0.0.1", 0))
            spool = self.root / "crash-spool"
            command = [sys.executable, "-c", "import pathlib,socket,sys,os,signal; p=pathlib.Path(sys.argv[2]); (p/'partial.txt').write_text('kept'); s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.sendto(str(os.getpid()).encode(),('127.0.0.1',int(os.environ['READY_PORT']))); signal.pause()"]
            config = self.root / "crash-service.json"
            config.write_text(json.dumps({"bind_host": "127.0.0.1", "port": 0, "token": "test-token", "command": command, "spool_dir": str(spool), "tls_cert_file": str(self.cert), "tls_key_file": str(self.key)}))
            env = {**os.environ, "READY_PORT": str(ready_socket.getsockname()[1])}
            service = subprocess.Popen([sys.executable, str(ROOT / "scripts/transcription-bridge.py"), "--config", str(config)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            worker = None
            replacement = None
            try:
                port = json.loads(service.stdout.readline())["port"]
                def submit():
                    req = urllib.request.Request(f"https://localhost:{port}/transcribe", b"audio", headers={"Authorization": "Bearer test-token"}, method="POST")
                    try:
                        with urllib.request.urlopen(req, context=self.client_context) as response:
                            response.read()
                    except OSError:
                        pass
                worker = threading.Thread(target=submit)
                worker.start()
                child_pid = int(ready_socket.recvfrom(bridge.TRANSFER_BUFFER_SIZE)[0])
                service.kill()
                service.wait()
                worker.join()
                replacement = bridge.ThreadedTLSServer(("127.0.0.1", 0), bridge.BridgeHandler)
                bridge.initialize_server(replacement, [], "token", spool)
                directory = next(spool.iterdir())
                result = json.loads((directory / "result.json").read_text())
                self.assertFalse(result["ok"])
                self.assertEqual(result["files"]["partial.txt"], "kept")
                self.assertFalse((directory / "audio.wav").exists())
                self.assertFalse((directory / "output").exists())
                state = subprocess.run(["ps", "-p", str(child_pid), "-o", "stat="], capture_output=True, text=True).stdout.strip()
                self.assertTrue(not state or state.startswith("Z"), state)
            finally:
                if service.poll() is None:
                    service.kill()
                    service.wait()
                if worker and worker.is_alive():
                    worker.join()
                if replacement:
                    replacement.server_close()
                service.stdout.close()
                service.stderr.close()


if __name__ == "__main__":
    unittest.main()
