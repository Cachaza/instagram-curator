# Server media with optional Mac transcription

The default single-host installation is unchanged. For a separate Apple Silicon
transcription machine, run the website and processing worker on the server with
the same PostgreSQL database and the same `/app/data` volume. The worker owns
downloads, previews, audio, transcripts, analysis files, and Codex credentials.
The Mac receives audio into a private temporary directory and removes the audio
when the model finishes or the service shuts down. Raw model responses, including
failed attempts, are returned to the server and retained beside its media. A
temporary text outbox on the Mac keeps undelivered results until the server
acknowledges that they have been durably stored; it contains no audio or images.

## Mac bridge

Create a private JSON configuration, readable only by the bridge user:

```json
{
  "bind_host": "PRIVATE_MAC_ADDRESS",
  "port": "AVAILABLE_PRIVATE_PORT",
  "tls_cert_file": "/private/path/bridge-cert.pem",
  "tls_key_file": "/private/path/bridge-key.pem",
  "token": "GENERATED_PRIVATE_CREDENTIAL",
  "command": ["/path/to/model/python", "/path/to/transcribe-local.py"]
}
```

Use an available port, a cryptographically generated credential, and a TLS
certificate whose subject alternative name matches the configured Mac address.
Keep the key and configuration private. Allow access only over the private
network; do not publish this endpoint to the internet. The model command receives
the temporary audio path and output directory and must write
`transcript.raw.json` with a nonempty `text` field, as the existing local
transcription command does. Preserve the command's required executable PATH.
Run the model in the foreground; helpers must remain in its inherited process
group. The bridge supervises that group and cancels remaining helpers before
collecting output. Model commands must not daemonize into separate sessions.

Run `python3 scripts/transcription-bridge.py --config /private/path/bridge.json`
under the machine's service manager. Authenticated `GET /health` checks the
connection. The bridge accepts one active transcription, matching Curator's
single processing worker; another request receives an explicit capacity error.
The Mac must be awake and reachable for transcription. There is no automatic
paid API fallback. Keep track of the certificate's actual expiry and renew the
certificate and server trust configuration before it expires.

Set `CURATOR_WORKER_DISABLED=1` on the Mac. This prevents running the complete
worker there, while allowing the transcription bridge and text-only MCP tools.

## Server worker

Keep a private client JSON file on the server:

```json
{
  "url": "https://PRIVATE_MAC_ADDRESS:AVAILABLE_PRIVATE_PORT",
  "token": "THE_MATCHING_PRIVATE_CREDENTIAL",
  "ca_file": "/app/data/secrets/transcription-bridge-ca.pem"
}
```

Point `CURATOR_TRANSCRIPTION_BRIDGE_CONFIG_FILE` at that file. TLS certificate
and hostname verification remain enabled. Alternatively, configure
`CURATOR_TRANSCRIPTION_BRIDGE_URL`, `CURATOR_TRANSCRIPTION_BRIDGE_TOKEN`, and
`CURATOR_TRANSCRIPTION_BRIDGE_CA_FILE` through private environment variables.

In the server's `CURATOR_WORKER_CONFIG_FILE`, set:

```json
{
  "transcription.provider": "local",
  "transcription.local_command": ["python3", "/app/scripts/transcribe-remote.py"]
}
```

Use server paths for downloaders, FFmpeg, and Instagram cookies. Start
`bun run worker --watch` on the server with the shared data volume and database
environment. Do not copy the Mac's executable paths into this configuration.
The worker retains its existing database ownership lock and stage failure
handling. A failed remote request fails the transcription stage visibly and
preserves any returned artifacts on the server. If delivery or acknowledgement
is interrupted, the error identifies the server output directory. Run
`python3 scripts/transcribe-remote.py --recover /path/to/output-directory` with
the same client configuration to retrieve/acknowledge the pending result.
The bridge reclaims abandoned audio on startup while preserving recoverable
result text.

## Moving an existing library

Stop the old worker first. Inventory both media directories and compare file
hashes. Copy missing files using private transport; refuse conflicting files
rather than overwriting them. Verify every server copy before removing local
files, including media-containing backup archives. Preserve relative paths so
database references continue to resolve. A file absent on both hosts still
requires recovery or downloading again.

After migration, verify a transcription from the server and check that its
temporary Mac audio has been removed. The bridge should be the only media
processing service on the Mac.
