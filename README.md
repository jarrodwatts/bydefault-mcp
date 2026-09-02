# bydefault-mcp

Unofficial MCP server for [ByDefault](https://www.bydefault.so) (AI visibility / GEO platform),
reverse-engineered from the web app's jstack RPC API. Stopgap until their official MCP ships —
expect to delete this then.

## Auth setup (one-time, ~30 seconds)

Chrome sanitizes cookies out of HAR exports, so grab the cookie directly:

1. Log into bydefault.so in Chrome.
2. DevTools → **Network** → click any `/api/` request → **Headers** → **Request Headers** → right-click the `Cookie` value → copy.
3. Paste it into `bydefault-mcp/.cookie` (single line, gitignored):

   ```sh
   pbpaste > bydefault-mcp/.cookie
   ```

Alternatively set the `BYDEFAULT_COOKIE` env var. `BYDEFAULT_ORG` overrides the org slug
(defaults to the account's active org, e.g. `monad-c97bbc`).

The session is a 7-day **sliding** expiry — it renews on every use, so regular use keeps it
alive indefinitely. If tools start returning 401, re-copy the cookie.

## Wiring

Registered project-wide in `/Users/jarrod/geo/.mcp.json`. Restart Claude Code (or `/mcp` → reconnect)
after adding the cookie.

## Tools

Read/monitoring (all confirmed against a live capture, 2026-08-31):

- `whoami`, `list_organizations`
- `prompt_overview` — topics + tracked prompts + per-assistant visibility
- `prompt_runs` — run history for one prompt: rank, winner, competitors, citations
- `list_competitors`
- `content_ideas`, `content_gaps`
- `traffic_overview`, `crawled_pages`, `crawl_log` — AI-crawler traffic
- `article_citations`, `list_articles`
- `activity_live`
- `raw_rpc` — escape hatch for any `/api/<router>/<procedure>` endpoint

## Adding write actions (add prompt, add competitor, …)

Those weren't in the original capture. To add one: perform the action once in the app with
DevTools Network recording, export the HAR, and drop it here — the request shape goes into
`server.js` as a new tool. `.capture/endpoints.json` holds the current catalog.

## Wire format notes

- `GET /api/<router>/<procedure>` with each query param superjson-wrapped: `key={"json":<value>}`
- `POST` bodies are JSON objects whose values are *strings* containing `{"json":<value>}`
- Responses unwrap from `{"json": <payload>}`
- Every request needs the session cookie + `x-organization: <org-slug>` header
