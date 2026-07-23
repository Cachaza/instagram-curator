# Future architecture: Codex, semantic search, and RAG

## Embedded Codex is more than starting a service

Starting `codex app-server` is the first step, not the complete integration.
Curator must also implement its JSON-RPC lifecycle:

1. Spawn one supervised `codex app-server` process.
2. Send `initialize` and `initialized`.
3. Read `account/read`.
4. When signed out, call `account/login/start` with
   `{"type":"chatgptDeviceCode"}`.
5. Display the returned verification URL and user code.
6. Wait for `account/login/completed`.
7. Start or resume a dedicated analysis thread.
8. Stream turns, tool calls, errors, rate limits, and cancellation into Curator.
9. Give Codex access only to the curator MCP tools and required media.
10. Persist every analysis result and interrupted state.

The web application can be reached over Tailscale while app-server remains bound
to local stdio. It should never expose Codex app-server directly to the network.

## SQLite-first semantic search

PostgreSQL should not be introduced only to obtain pgvector. The first useful
semantic-search version can keep SQLite as the source of truth:

- Store transcript and analysis text in SQLite.
- Chunk approved analyses and transcripts deterministically.
- Generate embeddings through a configurable provider.
- Store vectors in a local vector sidecar or a SQLite vector extension.
- Keep vector rows disposable and rebuildable from SQLite.
- Combine semantic similarity with category, household, review, and facet filters.

This preserves the easy self-hosted installation while validating whether chat
and semantic retrieval are genuinely useful.

## When PostgreSQL and pgvector become justified

Move to PostgreSQL when at least one is true:

- multiple Curator application instances need concurrent remote writes;
- multiple households or a hosted service are required;
- background workers run on several machines;
- the vector index becomes too large or operationally important for a local
  sidecar;
- backups, access controls, or analytics require a server database.

At that point PostgreSQL plus pgvector is a good unified store. It is not needed
for the current 473-publication household library.

## RAG chat page

The future `/chat` flow should be:

```text
question
  -> intent and filter extraction
  -> hybrid retrieval
       - semantic chunks
       - SQLite full-text search
       - category/facet filters
  -> rerank
  -> answer with publication citations
```

Answers must link to the supporting Curator publications and distinguish
transcript evidence, caption evidence, AI analysis, and human corrections.
Unreviewed or uncertain content must be labelled rather than presented as fact.
