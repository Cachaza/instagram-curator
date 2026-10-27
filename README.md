# Curator

Your saved Instagram feed, turned into a private and searchable personal
library.

Curator imports reels, posts, and carousels; downloads their media; transcribes
spoken audio locally or through Whisper; and uses your own Codex subscription to classify and
organize everything. It is designed to run at home, stay accessible through
Tailscale, and keep its database and credentials under your control.

> **License:** open source under the
> [GNU Affero General Public License v3.0](./LICENSE). You may use, modify, and
> redistribute Curator, including commercially. If you modify it and make it
> available to users over a network, you must offer those users the
> corresponding source code under the same license.

## What it does

- Imports Instagram reels, posts, and multi-image carousels from a URL.
- Downloads media with `yt-dlp` and `gallery-dl`.
- Extracts audio and representative frames with FFmpeg.
- Transcribes audio with a configured local command or an OpenAI API key.
- Analyzes publications through Codex using your own ChatGPT subscription.
- Creates titles, summaries, categories, entities, and structured facets.
- Filters restaurants by cuisine and budget, recipes by style and nutrition
  goal, and fitness content by goal and muscle group.
- Provides a review queue, processing pipeline, retries, and analysis history.
- Supports an administrator and locally-created household accounts.
- Stores shared application state in PostgreSQL and media on the local filesystem.
- Includes tested backup, restore, legacy migration, Docker, and systemd flows.

## How the pipeline works

```text
Instagram URL
    ↓
durable PostgreSQL queue
    ↓
yt-dlp / gallery-dl
    ↓
FFmpeg audio + frames
    ↓
Whisper transcription
    ↓
Codex structured analysis
    ↓
searchable library + review queue
```

Failures are persisted in PostgreSQL and can be retried from the interface. Existing
URLs are normalized and deduplicated before entering the queue.

## Quick start with Docker

You need Docker, Docker Compose and a private PostgreSQL database. Clone the repository, then run:

```bash
cp .env.example .env
```

Set the public address from which you will open Curator:

```dotenv
CURATOR_BASE_URL=http://your-host:3000
CURATOR_TRUSTED_ORIGINS=http://your-host:3000
DATABASE_URL=postgresql://curator:your-private-password@your-database:5432/curator
```

Start the application:

```bash
docker compose up -d --build
```

Alternatively, run the published multi-architecture image without cloning:

```bash
docker volume create curator-data
docker run -d \
  --name curator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file /private/curator.env \
  -e CURATOR_TRUSTED_ORIGINS=http://your-host:3000 \
  -v curator-data:/app/data \
  ghcr.io/cachaza/instagram-curator:latest
```

Versioned images are published as `ghcr.io/cachaza/instagram-curator:0.2.3`,
`0.2`, `0`, and `latest`.

### Build on the Mac and deploy through a registry

Production images are built locally and pushed to GHCR. GitHub Actions does not
build or publish them. Log in to the registry with Docker's credential store,
then publish a committed revision:

```bash
git fetch origin main
bash scripts/publish-local-image.sh origin/main
```

The script exports a clean Git archive, builds `linux/amd64` for the current
Dokploy server, and pushes `ghcr.io/cachaza/instagram-curator:sha-<full-commit>`.
It excludes uncommitted changes and prints the published image digest. Set
`CURATOR_IMAGE` or `CURATOR_IMAGE_PLATFORM` to target another registry or platform.
Build-time database and auth state are removed before assembling the runtime
image; persistent state belongs in the mounted data volume.
Documentation images are excluded from the Docker context. Public examples must
use synthetic data; personal library screenshots are not distributed with the
application. The local publisher also rejects known private-data paths in the
committed revision before building or pushing.
The pinned Bun 1.3 runtime uses its baseline x64 binary so building under Mac
emulation does not select an AVX2 binary that fails on the older KVM host.

In Dokploy, use the **Docker image** source and the printed
`ghcr.io/cachaza/instagram-curator@sha256:…` reference. Deploying pulls that exact
image without compiling on the server. Keep the existing environment, `/app/data`
volume, command override and Traefik domain. For this web-only installation the
command runs `bun run start:web`; transcription and analysis workers stay off.
Keep the prior digest to roll back the application image. Database rollback, if
needed, is a separate restore from a consistent backup.

Open `CURATOR_BASE_URL`. On a completely empty installation Curator creates its
database automatically, and the first registered account becomes the
administrator. Public registration closes immediately after that first
account.

PostgreSQL stores the private library, accounts, settings and usage records.
The `curator-data` volume contains downloaded media, uploaded Instagram cookies,
backups, the auth signing secret and the isolated Codex login. Both stores are private.

## Native installation

Requirements:

- A private PostgreSQL database (the deployment is verified with PostgreSQL 18)
- Bun 1.3+
- Node.js 22+
- FFmpeg and `ffprobe`
- Python 3
- `yt-dlp`
- `gallery-dl`
- Codex CLI

Set DATABASE_URL in your private .env.local, then install dependencies and migrate:

```bash
bun install
bun run db:migrate
```

For integration tests, configure `CURATOR_TEST_DATABASE_URL` with a loopback
PostgreSQL server and a disposable admin database named `curator_test`. Tests
create and remove isolated databases; they never fall back to DATABASE_URL.

Curator can be installed as a PWA from an HTTPS deployment (localhost also
works for development/testing). In Chromium, use the browser's **Install app**
action; on iPhone/iPad, use Safari's **Share → Add to Home Screen**. The installed
app opens in its own window and retains the existing sign-in flow.

The production build registers a service worker with Spanish/English offline
fallback pages. It caches only those public pages and app icons. Library content,
API responses, media and map tiles are not stored in its offline cache, so using
the library, imports and maps requires a connection. Service-worker registration
is disabled during `bun run dev` to avoid interfering with development. To test
installation and offline fallback locally, use `bun run build` followed by
`bun run start`. When changing offline pages or icons, bump the cache version in
`public/sw.js` so existing installations receive the updated fallback assets.

Restaurant maps are available at `/map`, or **View on map** in the restaurant
category. Choose **Find address**, add a city/address if necessary, and confirm
the matching result before a pin is saved. Existing imports do not need to be
reanalyzed. Address lookup uses Nominatim/OpenStreetMap, caches results in the
shared PostgreSQL database, and enforces its one-query-per-second application
limit. It runs only on request, with no bulk lookup or autocomplete. Empty
results can be refined by changing the query; provider failures can be retried.
Run `bun run db:migrate` after upgrading to add the map tables.

OpenStreetMap is the default basemap. Each signed-in user can optionally choose
Mapbox and enter their own public `pk.` token with read access, restricted to the
app's URL. The token is stored only in that browser, scoped to the user; it is
never saved in the shared database. The Mapbox choice uses the Static Tiles API
and bills that user's Mapbox account; address lookup continues to use
OpenStreetMap so saved coordinates do not depend on Mapbox's temporary-geocoding
storage restrictions. **Forget token** removes the saved browser token.

For a one-time backfill, preview with `node --import tsx
scripts/geocode-restaurants.ts` in the production container, then add `--apply`
to run it. This command runs one batch on one machine, respects Nominatim's
shared one-query-per-second limit, and reuses cached results. Do not schedule it
against the public Nominatim service; see its [usage policy](https://operations.osmfoundation.org/policies/nominatim/).
Only one exact venue/name/location-hint match is saved automatically. Missing,
ambiguous and failed matches are recorded in `pipeline_events` at the `geocoding`
stage. Provider failures halt the run and mark remaining entries as deferred;
a later explicit run reuses completed results. Existing pins are preserved,
including pins confirmed while a lookup is running. Output includes the run ID
and aggregate progress; `--run-id` can label a specific operational run.

**Near me** requests browser location permission when pressed and sorts confirmed
places by straight-line distance. The position is not saved or sent to Curator's
server. Basemap providers receive tile requests for the viewed area. Browser
geolocation requires a secure context (HTTPS, or localhost for development).
Operators can change `CURATOR_GEOCODING_URL` to a Nominatim-compatible provider
and `CURATOR_MAP_TILE_URL` to another OSM-compatible raster tile service without
changing source code. A replacement tile service must permit OpenStreetMap-only
attribution, or its required attribution must be added before use.

For development:

```bash
bun run dev:tailscale
```

For a persistent production build on a Linux user account:

```bash
bun run build
bun run service:install
```

The included user-level systemd unit launches Next.js and the worker, restarts
them after failures, and applies a restrictive umask. Review
[`deploy/instagram-curator.service`](deploy/instagram-curator.service) if your
host address or binary paths differ.

## Initial setup

The administrator is guided through the setup screens:

1. Choose Spanish or English and add an OpenAI API key for Whisper.
2. Configure Instagram with an uploaded Netscape-format cookies file or a
   Firefox profile.
3. Authorize Codex through the device-code flow. The Codex state is isolated
   under Curator's `data` directory.
4. Run diagnostics to verify PostgreSQL, storage, FFmpeg, downloaders, Instagram,
   OpenAI, and Codex.

No Instagram password is required. A cookies file is usually more reliable for
self-hosting and can be replaced from the settings interface.

### Codex model and usage

Open **Settings → Codex model and usage** (`/setup/codex`) to choose an analysis
model and a supported reasoning level from the installed Codex catalog. Access
is confirmed by a successful analysis, rather than by appearing in the catalog.
Until configured, Curator leaves the model to Codex's default and requests medium
reasoning. Changes apply to the next analysis and do not start a worker.

Curator records token snapshots for new analysis attempts, including failed
attempts when Codex reports usage. Cached input and reasoning output are subsets
of input and output, not additional tokens. Duplicate snapshots are not added.
Historical analyses are not assigned invented measurements; missing values stay
unavailable. Usage records survive deletion of their publication.

The same page shows account-wide quota percentages and reset times, which may
include other Codex clients. Optional per-thread credit and USD estimates are
stored only when the installed Codex service returns them. They are estimates,
not an API invoice or a confirmed additional subscription charge. Unsupported
usage endpoints do not prevent analysis, and no inference is run to refresh
usage or list models.

### Local transcription

The worker also accepts `transcription.provider = "local"` in `app_settings`.
For machine-specific worker configuration, set `CURATOR_WORKER_CONFIG_FILE` to
a private JSON object keyed by setting names. For example:

```json
{
  "transcription.provider": "local",
  "transcription.local_command": ["/path/to/python", "/path/to/transcribe-local.py"],
  "media.ffmpeg_bin": "/opt/homebrew/bin/ffmpeg",
  "media.ffprobe_bin": "/opt/homebrew/bin/ffprobe"
}
```

The file can also override `instagram.ytdlp_bin`, `instagram.gallery_dl_bin`,
`instagram.cookies_from_browser`, and `instagram.cookie_file`. Keep this file
private: it may contain local paths or browser cookie references. These values
override the matching shared settings only in the worker; without the file,
the worker uses shared settings as before. The worker reads and validates the
file for each configuration load, and reports a missing or malformed file
instead of silently ignoring it. The web process continues using native ffmpeg.

Configure `transcription.local_command` as an argument array containing the
local Python executable and transcription script. The worker appends the audio
path and a fresh output directory; it does not invoke a shell.

The command must write `transcript.raw.json` with a non-empty `text` field and
exit successfully only after validating that generation completed. David's
existing `transcripciones/transcribe-local.py` provides this contract with
offline Voxtral on Apple Silicon. Its Python environment and model weights must
already be installed on the worker's host.

Each attempt retains its raw response and metadata beside the media. A failed
local transcription is recorded as a pipeline failure and never falls back to
the OpenAI API. Already completed transcriptions are preserved when switching
providers. Local executable and model paths must be reconfigured when moving
the worker to another machine.

### Hosting the web interface separately

Use `bun run start:web` to run database migrations and the production web
interface without starting the background worker. In Dokploy, build the
Dockerfile and override the command with `bun` and arguments `run start:web`.
Mount a persistent named volume at `/app/data`, set `CURATOR_BASE_URL` to the
address you will open, and include alternative addresses in
`CURATOR_TRUSTED_ORIGINS`.

`start:web` sets `CURATOR_WEB_ONLY=1`. Diagnostics and the Codex connection
screen distinguish a connected account from an active processing worker;
web-only installations do not require an OpenAI transcription key. In worker
mode, transcription diagnostics check the selected provider instead.

For a reverse proxy such as Dokploy's Traefik, route the domain to the internal
container port 3000. No host port needs to be published. When an existing
Cloudflare Tunnel terminates HTTPS and forwards to Traefik on port 80, keep the
application origin configured as the public HTTPS domain.

Library cards and publication pages check that stored media paths resolve to
existing files. Missing files show a placeholder and the original Instagram
link; they do not prevent access to captions, transcripts, or analyses.

### Shared Mac/server database and SQLite migration

Stop all writers before importing the current SQLite library into a new empty
PostgreSQL database:

```bash
bun run migrate:postgres -- --sqlite /private/library/curator.sqlite --confirm
```

The importer first creates a consistent SQLite backup and retains private auth
files. It copies accounts, sessions, password hashes, publications, transcripts,
analyses, history, reviews, settings, events and measured usage. It verifies a
checksum of every copied value and rebuilds search. A failure rolls back the
import; a populated PostgreSQL target is refused. No inference is performed.
Keep the original SQLite database and the previous image for rollback. After
PostgreSQL accepts new writes, reverting the image alone would lose those writes;
reconcile them or restore the appropriate database backup first.

Configure the Mac and Dokploy with DATABASE_URL values that reach the same private
database. Dokploy uses its internal Docker network. For a Mac behind an SSH
bastion, set a loopback DATABASE_URL plus CURATOR_DATABASE_SSH_TARGET,
CURATOR_DATABASE_REMOTE_HOST and CURATOR_DATABASE_REMOTE_PORT, then keep
`bun run db:tunnel` running while using the Mac app or worker. The SSH tunnel
binds only to loopback. Restrict database network access and use SCRAM credentials;
use verified PostgreSQL TLS when connecting without an encrypted private tunnel.

Media files and Codex login files remain on each machine's private filesystem.
A shared database does not transfer videos or thumbnails: copy/synchronize those
files separately, retaining their relative `media/...` paths. Preserve the web
server's `auth-secret` when migrating so its signed sessions remain valid.
Apple Silicon transcription models remain on the Mac. Start only one processing
host: the worker holds a shared database lock before recovering interrupted jobs.
The server can remain web-only while the Mac uses the local transcription model.

## Import API

The browser interface is available at `/import`. External tools, shortcuts, or
future share-sheet integrations can use the bearer token generated during
setup:

```bash
curl -X POST http://your-host:3000/api/v1/imports \
  -H 'content-type: application/json' \
  --oauth2-bearer "$CURATOR_SHARE_TOKEN" \
  -d '{"url":"https://www.instagram.com/reel/SHORTCODE/"}'
```

A valid request returns `202 Accepted` with the durable publication identifier.
Submitting the same publication again returns its existing record.

## Backup and restore

Create a consistent backup:

```bash
bun run backup
```

Stop the service before restoring:

```bash
bun run restore -- /path/to/backup --confirm
```

Backups use a consistent PostgreSQL snapshot in private `library.json` plus an
archive of media and runtime credentials. Restore checks the database checksum
and requires a new empty PostgreSQL target. It preserves previous private files
with a timestamped recovery suffix. Legacy SQLite backups use the migration
command above. Stop writers during backup if files are being processed, so the
media archive matches the database snapshot. Backups contain private credentials.

## Migrating from the original prototype

```bash
bun run migrate:legacy -- \
  --database ../instagram-curator/data/curator.sqlite \
  --media ../instagram-curator/data/reels
```

The migration leaves the legacy database untouched, copies transcripts and
analyses into the new model, and uses hard links for media when both projects
are on the same filesystem.

## Data and security

- PostgreSQL is the shared source of truth.
- Secrets are stored in the private database or private runtime files.
- `data/`, cookies, databases, backups, and downloaded media are ignored by Git.
- Codex runs with read-only filesystem access and approvals disabled for
  automated analysis.
- Curator is intended to sit behind Tailscale or another trusted private
  network. Do not expose it directly to the public Internet without adding TLS,
  hardened proxying, and an appropriate security review.
- Imported Instagram media remains subject to Instagram's terms and the rights
  of its original creators.

## Project structure

```text
src/app/             Next.js pages and HTTP endpoints
src/components/      shared interface components
src/lib/             database, auth, setup, content, and Codex integration
src/worker/          download, media, transcription, and analysis pipeline
scripts/             migrations, backups, restore, and service installation
deploy/              systemd unit
docs/                architecture notes; public examples must use synthetic data
data/                private runtime state; never committed
```

The full product direction lives in
[`OPEN_SOURCE_PLAN.md`](OPEN_SOURCE_PLAN.md), with longer-term RAG and pgvector
ideas in [`docs/FUTURE_ARCHITECTURE.md`](docs/FUTURE_ARCHITECTURE.md).

## Development checks

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

Contributions are welcome. By contributing, you agree that your contribution
may be distributed under the GNU Affero General Public License v3.0.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, checks,
privacy rules, and pull-request expectations.

Copyright © 2026 David Cachaza.

---

Built for people who save far more than Instagram makes easy to find again.

## ChatGPT library MCP

Browse the library by newest/oldest saves and filter review/action status on
`/library`. A private stdio MCP also lets ChatGPT search, read full video details,
list categories, and optionally organize saves. See
[ChatGPT MCP and private tunnel setup](docs/chatgpt-mcp.md).
