# Contributing to Curator

Thanks for helping make Curator better. Contributions are welcome whether they
fix a bug, improve documentation, add tests, or extend the import and analysis
pipeline.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- For a large feature or a data-model change, open an issue first so the design
  can be discussed before substantial work begins.
- Never include Instagram sessions, cookies, API keys, databases, downloaded
  media, transcripts, or other personal data in an issue, test fixture, commit,
  or screenshot.
- By contributing, you agree that your contribution may be distributed under
  the [GNU Affero General Public License v3.0](LICENSE).

## Development setup

Requirements:

- Bun 1.3+
- Node.js 22+
- FFmpeg and `ffprobe`
- Python 3 with `yt-dlp` and `gallery-dl`
- Codex CLI for analysis work

Install dependencies and initialize the local databases:

```bash
bun install
bun run db:migrate
bun run auth:migrate
bun run dev:tailscale
```

Open `http://localhost:3000`. Runtime state is written to `data/`, which is
intentionally ignored by Git.

Docker can be used instead:

```bash
cp .env.example .env
docker compose up --build
```

## Making a change

1. Fork the repository and create a focused branch from `main`.
2. Keep changes small enough to review and avoid unrelated formatting churn.
3. Preserve SQLite as the source of truth.
4. Persist download, transcription, and analysis failures instead of silently
   skipping them.
5. Do not invent external facts such as restaurant ratings or prices.
6. Add or update tests for behavior that can regress.
7. Update the README or setup guidance when user-facing behavior changes.

For schema changes, make migrations repeatable and safe against an existing
installation. Never require users to delete their database to upgrade.

## Validation

Run the complete local check before opening a pull request:

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

Changes to the container or native dependencies should also pass:

```bash
docker build -t curator:local .
```

For pipeline changes, describe the reel, post, carousel, no-audio, or failure
case you exercised. Use sanitized fixtures or public test content and never
commit the resulting media.

## Pull requests

A useful pull request includes:

- A concise explanation of the problem and solution.
- Any user-visible or migration impact.
- Screenshots for interface changes.
- The checks and manual scenarios that were run.
- Links to related issues.

Mark breaking changes clearly. Maintainers may ask for a smaller follow-up PR
when a change combines unrelated concerns.

## Reporting bugs

Include the Curator version, installation method, operating system or container
platform, affected URL type, pipeline stage, and relevant sanitized logs.
Remove usernames, tokens, cookie values, local paths, and publication contents
that are not necessary to reproduce the problem.

Security vulnerabilities should not be filed as public issues. Use GitHub's
private security advisory reporting for the repository.
