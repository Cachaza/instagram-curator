# Instagram Curator OSS — product and architecture plan

## Product vision

Instagram Curator is a self-hosted application that turns Instagram publications
saved or shared by a household into a searchable, reviewed knowledge library.
It downloads the media locally, transcribes video, asks Codex to produce a typed
analysis, and keeps the original publication, processing state, AI output, and
human review in one local SQLite database.

The application must be useful without requiring users to understand Bun,
environment files, MCP, Instaloader, yt-dlp, ffmpeg, Whisper, or Codex CLI.

## Initial release

- One self-hosted household per installation.
- Email/password accounts with `admin` and `user` roles.
- The first account is the administrator.
- Shared household library; every import records which user created it.
- SQLite as the only database.
- Setup wizard in Spanish and English.
- OpenAI transcription key configured from the UI and stored in SQLite.
- Codex authenticated from the UI using ChatGPT device-code login.
- Import by pasting an Instagram URL.
- Authenticated `POST /api/v1/imports` endpoint for shortcuts and integrations.
- Persistent, observable media and AI processing queue.
- Review queue and approved library.

PWA share-target support, invitations, multiple households, granular permissions,
and PostgreSQL are explicitly deferred.

## User roles

### Administrator

- Completes the installation setup.
- Configures Instagram access, OpenAI transcription, Codex, storage, and language.
- Creates or rotates share tokens.
- Can inspect failures and retry jobs.
- Can manage household members in a later release.

### Member

- Signs in.
- Adds publications.
- Sees pipeline state.
- Reviews and browses the shared household library.
- Cannot read or change installation secrets.

The first registered user is assigned `admin`. The administrator can create
later `user` accounts with temporary passwords. Open registration remains
available only during early local development; the production onboarding flow
will close it and use admin-created invitations.

## Setup wizard

1. Choose interface language and analysis-output language.
2. Configure Instagram:
   - detect and import a local browser session;
   - upload a supported cookie file for remote/Docker installations;
   - import an official Meta export;
   - paste individual URLs.
3. Configure transcription:
   - OpenAI API with `whisper-1` by default;
   - local Whisper as a later optional provider.
4. Connect Codex:
   - Curator starts `codex app-server`;
   - requests `account/login/start` with `chatgptDeviceCode`;
   - shows `verificationUrl` and `userCode`;
   - waits for `account/login/completed`;
   - Codex stores and refreshes its own credentials.
5. Run system checks for SQLite, media storage, ffmpeg, yt-dlp, Instagram,
   transcription, and Codex.
6. Optionally start the first import.

## Secret storage

Installation secrets such as the OpenAI API key and share tokens are stored in
SQLite. They are not encrypted. This is a deliberate self-hosting trade-off:
anyone who can read the database can read the secrets.

Requirements:

- Database and data directories use restrictive filesystem permissions.
- Secret values are never returned by settings APIs.
- The UI only receives `configured: true/false` and optional safe suffixes.
- Secrets never appear in logs, error messages, HTML, or analytics.
- Backups are documented as containing secrets.
- Environment-variable overrides may be supported for container users, but are
  not required for normal setup.

## Import API

### Request

```http
POST /api/v1/imports
Authorization: Bearer <share-token>
Content-Type: application/json

{"url":"https://www.instagram.com/reel/SHORTCODE/"}
```

An authenticated browser session may be used instead of a bearer token.

### Response

```http
202 Accepted
```

```json
{
  "publication_id": "reel_...",
  "status": "pending",
  "created": true,
  "status_url": "/api/v1/publications/reel_..."
}
```

Only `instagram.com/reel/...` and `instagram.com/p/...` URLs are accepted. URLs
are normalized before storage. The normalized URL is unique, making imports
idempotent. The endpoint persists work and returns immediately; it does not keep
the HTTP request open during processing.

## Processing state machine

```text
pending
  -> downloading
  -> extracting_media
  -> transcribing
  -> ready_for_analysis
  -> analyzing
  -> ready_for_review
  -> analyzed
```

Any stage can transition to `failed`. Failures store the stage, attempt count,
and sanitized error. Retrying continues from the last safe persisted boundary.

The initial implementation uses one media worker and one Codex analysis at a
time. Concurrency can become configurable without changing the state model.

## Codex integration

Curator owns a local `codex app-server` child process and communicates over its
stdio JSON-RPC protocol. This provides:

- ChatGPT and device-code authentication;
- account and rate-limit status;
- threads and turns;
- streaming progress;
- cancellation;
- MCP-backed access to the local curator tools.

Users do not configure MCP or invoke `codex exec` manually. Curator never reads
or copies Codex tokens; Codex manages its own authenticated state.

## Internationalization

Interface locale and analysis-output locale are independent settings.

- Initial UI locales: `es`, `en`.
- Stable internal identifiers remain English (`recipe`, `pending`, entity keys).
- The UI translates identifiers at render time.
- Natural-language analysis fields use the configured output locale.
- Each analysis stores its output locale and prompt version.
- Dates, numbers, durations, and plurals use the platform `Intl` APIs.

Translations are grouped by feature. Literal user-facing strings should not be
spread through server or client business logic.

## Data model

SQLite is the source of truth for:

- Better Auth users, sessions, accounts, and verification records;
- installation settings and secrets;
- publications;
- pipeline events and failures;
- media paths;
- transcripts;
- typed AI analyses and their versions;
- human reviews;
- share tokens.

SQLite WAL mode is enabled. PostgreSQL is deferred until there is a demonstrated
need for multiple application instances, remote concurrent writers, multiple
households, or horizontal workers.

## Repository boundaries

This repository never contains:

- Instagram sessions or browser cookies;
- OpenAI keys or Codex credentials;
- SQLite databases, WAL, or SHM files;
- downloaded video, audio, images, or transcripts;
- personal Meta exports.

The existing personal project remains untouched and acts as a behavioral
reference while proven modules are ported deliberately.

## Delivery phases

### Phase 1 — foundation

- Next.js application and shared visual shell.
- Better Auth on SQLite.
- First-user administrator bootstrap.
- Setup settings and secret persistence.
- `/import` page and idempotent import API.
- English/Spanish translation foundation.

### Phase 2 — local pipeline

- Port Instagram URL import and media pipeline.
- Persistent worker supervision.
- ffmpeg, yt-dlp, cookie-session setup, retries, and diagnostics.
- OpenAI transcription using the configured SQLite secret.

### Phase 3 — embedded Codex

- `codex app-server` lifecycle.
- Device-code UI.
- MCP configuration managed internally.
- Typed analysis jobs, progress, cancellation, and rate-limit status.

### Phase 4 — review and distribution

- Review queue and library.
- Native installer and update strategy.
- Docker deployment with file-based cookie import.
- Backup, restore, export, and migration from the personal prototype.

### Later

- PWA share target.
- Admin-managed invitations and member management.
- Multiple households.
- Fine-grained visibility and permissions.
- PostgreSQL or distributed workers if real usage requires them.
