# Instagram Curator OSS

- Runtime: Next.js + TypeScript. Bun is the package manager; production Next.js
  uses its supported Node.js runtime.
- SQLite is the source of truth.
- Never commit SQLite files, Instagram sessions, cookies, Meta exports,
  downloaded media, transcripts, OpenAI keys, Codex credentials, or runtime
  secret files.
- Import endpoints must accept only normalized Instagram publication URLs and
  remain idempotent.
- Every background failure must be persisted with its stage; never silently skip
  failed downloads, extraction, transcription, or analysis.
- Keep stable internal identifiers in English. User-facing copy must support
  Spanish and English.
- Do not invent external facts such as restaurant ratings, locations, or prices.
