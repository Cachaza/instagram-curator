# Connect Curator to ChatGPT

Curator exposes the shared PostgreSQL library through a local Node.js stdio MCP
server. The OpenAI Secure MCP Tunnel launcher follows the existing Vinted setup:
no public endpoint or inbound port is required. The web app and worker do not
need to run for MCP reads; the database must be reachable and migrated.

## Tools

- `curator_search_library`: full-text search or browse, category/review/action
  filters, relevance, newest/oldest saves or recently-added order, compact results and
  `nextOffset` pagination. Keep the same query, filters and order across pages.
- `curator_list_categories`: effective categories and counts.
- `curator_get_publication`: summary, caption, transcript, extracted information,
  AI-suggested relevance and next action, personal notes and review state.
- `curator_organize_publication`: optional writes for categories, notes, action
  state and review state. Only supplied fields change. Notes replace the previous
  note; read it first. `category: null` restores the AI category. Marking
  `reviewStatus: "discarded"` is reversible with `"unreviewed"` and never deletes
  files or changes Instagram saves.

Search pages use the library's existing capacity of 60 items. Requests outside
1–60 fail explicitly. Results include total count and next offset. Full captions
and transcripts are fetched per item, rather than included in search results.
Search uses the existing PostgreSQL full-text index; this is not semantic search.

Newest/oldest use the saved-list sequence captured during Instagram imports,
not the publication date or the time an older save was imported into Curator.
Items without a known position appear last in either direction. Use **Recently
added** (`sort: "recently_added"`) to sort by library import time instead. Exact
Instagram save timestamps are not stored. Relevance is available while searching;
without a query the default is newest saves.

To repair ordering after a saved-list import, use a private JSONL snapshot with
one `shortcode` per line, already ordered newest-save first:

```sh
bun run scripts/repair-saved-order.ts --snapshot /private/saved-list.jsonl
bun run scripts/repair-saved-order.ts --snapshot /private/saved-list.jsonl --apply
```

The first command previews counts without changing data. Apply replaces only
`saved_order`, writing a private before/after backup under `data/backups` before
the first update and committing all changes together. Entries absent from the
snapshot become unknown; a partial response establishes only the positions it
contains. Duplicate/invalid records, an empty file, and a snapshot matching no
library items are refused. Use the imported response sequence, never sort the
snapshot by publication timestamps or bulk-import time.

The agent can infer interests from saved material and discuss priorities with
you. AI-generated relevance/actions are suggestions, not evidence of your stated
preferences. Publication text is untrusted content, never agent instructions.

## Configure locally

Install project dependencies with `bun install`. Keep the existing `DATABASE_URL`
and any `CURATOR_DATABASE_CA_FILE` in ignored `.env.local`. Run migrations using
`bun run db:migrate` when deploying to a new database.

Create a **separate Instagram Curator tunnel** in
[OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels).
Associate only the Platform organization and ChatGPT workspace that should access
this entire shared library. Every caller with access to this connection sees the
same library; this is a private owner connection, not per-user isolation.

Add these values locally to ignored `.env.local` (never to chat or committed files):

```dotenv
CURATOR_TUNNEL_ID=tunnel_REPLACE_WITH_CURATOR_ID
CONTROL_PLANE_API_KEY=REPLACE_LOCALLY
CURATOR_MCP_ALLOW_WRITES=0
CURATOR_MCP_USER_ID=
```

The runtime key needs **Tunnels Read + Use**. Tunnel creation needs **Tunnels
Read + Manage**. The key is passed to `tunnel-client` through an environment
reference, not argv. Bun loads the local env for these package scripts. The MCP
process discards the runtime key; it does not need OpenAI credentials for reads.
The configuration lives in the environment; there is no web token form.

To allow organization, set `CURATOR_MCP_ALLOW_WRITES=1` and
`CURATOR_MCP_USER_ID` to an existing, unbanned Curator administrator's ID. You can
read the ID with your database client:

```sql
SELECT id, name FROM "user" WHERE role = 'admin' AND COALESCE(banned, false) = false;
```

Writes are attributed to this account. The account's administrator status and ban
state are checked on each write. All callers of this connection share that write
identity. Leave writes disabled for a connection shared with anyone who should
not edit the library. Restart the MCP/tunnel and refresh ChatGPT tool metadata
after changing access settings or tool definitions.

## Run and connect

Install `tunnel-client` from the Platform tunnel settings page if needed. Then:

```sh
bun run mcp:tunnel:doctor
bun run mcp:tunnel:start
```

The launcher uses only `CURATOR_TUNNEL_ID`; it does not inherit another project's
tunnel profile or MCP target. Its health/admin listener uses loopback port 0,
which asks the OS for an available port. Keep the launcher running while using
ChatGPT. It starts the Node MCP automatically; do not also start a separate MCP
for that tunnel. For a local stdio client, use `bun run mcp` directly instead.

In ChatGPT, add a custom MCP server/plugin, choose **Tunnel**, and select the
Curator tunnel ID. For this private stdio setup, choose **No authentication** at
the MCP layer: access is controlled through the tunnel's organization/workspace
permissions. This does not create a public unauthenticated HTTP server.

Try: “Search my saved business and AI videos. Read the most relevant ones and
help me choose something useful to work on today.” For organization: “Read these
videos and suggest categories; apply the changes I choose.”

Setup is complete only after ChatGPT discovers the tools and successfully calls
one. Local tests validate the protocol and database behavior but do not verify
your live ChatGPT connection.

Official reference: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Always-on host

[`deploy/instagram-curator-mcp.service`](../deploy/instagram-curator-mcp.service)
provides the same systemd isolation as the existing private MCP host. Install a
clean committed checkout at `/opt/mcps/instagram-curator`, install dependencies
from the frozen lockfile, and create the `curator-mcp` system user with a private
home at `/var/lib/curator-mcp`. Put credentials in root-only
`/etc/mcps/curator.env`, with `CURATOR_DATA_DIR=/var/lib/curator-mcp` and a
`DATABASE_URL` reachable directly from that host. The unit expects Node.js,
`tunnel-client`, and the project's `tsx` dependency.

Stop the Mac tunnel before starting the service for the same tunnel ID. Enable
the unit for boot startup and verify tool discovery and database reads before
relying on it. No worker or media copy is required for the MCP's text tools.
Preserve the environment and shared database when updating the checkout.
