#!/usr/bin/env node
// Unofficial ByDefault (bydefault.so) MCP server.
// Reverse-engineered from the web app's jstack RPC API (captured 2026-08-31).
// Auth: better-auth session cookie + x-organization header.
// Treat as a stopgap until ByDefault ships an official MCP.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BYDEFAULT_BASE_URL ?? "https://www.bydefault.so";

function loadCookie() {
  if (process.env.BYDEFAULT_COOKIE) return process.env.BYDEFAULT_COOKIE.trim();
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), ".cookie");
    return readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

let ORG = process.env.BYDEFAULT_ORG ?? null;

// jstack/superjson wire format:
//   GET  → each query param is `key={"json":<value>}` (undefined params omitted)
//   POST → JSON body whose values are STRINGS containing `{"json":<value>}`
//   resp → `{"json":<payload>}` — unwrap
async function rpc(method, path, params = {}) {
  const cookie = loadCookie();
  if (!cookie) {
    throw new Error(
      "No session cookie. Set BYDEFAULT_COOKIE or write the Cookie header value to bydefault-mcp/.cookie " +
        "(DevTools → Network → any /api/ request → Request Headers → Cookie)."
    );
  }
  const headers = {
    cookie,
    accept: "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  };
  if (ORG && path !== "/api/auth/get-session") headers["x-organization"] = ORG;

  let url = BASE + path;
  const opts = { method, headers };
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (method === "GET") {
    const qs = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify({ json: v }))}`)
      .join("&");
    if (qs) url += "?" + qs;
  } else {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, JSON.stringify({ json: v })])));
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && "json" in data ? data.json : data;
  } catch {
    return text;
  }
}

async function resolveOrg() {
  if (ORG) return ORG;
  const session = await rpc("GET", "/api/auth/get-session");
  ORG = session?.user?.activeOrgSlug ?? null;
  return ORG;
}

const server = new McpServer({ name: "bydefault", version: "0.1.0" });

const out = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const errOut = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try {
      await resolveOrg();
      return out(await handler(args ?? {}));
    } catch (e) {
      return errOut(e);
    }
  });
}

tool("whoami", "Current ByDefault user + session info (also verifies the cookie works)", {}, () =>
  rpc("GET", "/api/auth/get-session")
);

tool("list_organizations", "List organizations (brands) on this account", {}, () =>
  rpc("GET", "/api/organization/list")
);

tool(
  "prompt_overview",
  "Tracked-prompt visibility overview: topics, prompts, per-assistant visibility scores. Dates are YYYY-MM-DD; omit for the default window.",
  { from: z.string().optional(), to: z.string().optional() },
  ({ from, to }) => rpc("GET", "/api/promptTracking/overview", { from, to })
);

tool(
  "prompt_runs",
  "Run history for one tracked prompt: per-assistant status/rank, winning domain, competitors, citations",
  { promptId: z.string() },
  ({ promptId }) => rpc("GET", "/api/promptTracking/promptRuns", { promptId })
);

tool("list_competitors", "Tracked competitors (name, domain, topics)", {}, () =>
  rpc("GET", "/api/visibility/listCompetitors")
);

tool(
  "content_ideas",
  "Content ideas surfaced by ByDefault's scans",
  {
    offset: z.number().default(0),
    limit: z.number().default(24),
    sort: z.string().default("default"),
    topic: z.string().optional(),
  },
  ({ offset, limit, sort, topic }) =>
    rpc("GET", "/api/visibility/ideas", { offset, limit, sort, mentions: [], topic })
);

tool(
  "content_gaps",
  "Keyword/content gaps vs competitors (keyword, volume, difficulty, intent, who ranks)",
  { offset: z.number().default(0), limit: z.number().default(24), sort: z.string().default("default") },
  ({ offset, limit, sort }) => rpc("GET", "/api/visibility/gaps", { offset, limit, sort, mentions: [] })
);

tool(
  "traffic_overview",
  "AI-crawler traffic overview by agent (openai, claude, ...). range e.g. '30d'",
  { range: z.string().default("30d") },
  ({ range }) => rpc("GET", "/api/visibility/trafficOverview", { range })
);

tool(
  "crawled_pages",
  "Pages crawled by AI agents",
  {
    range: z.string().default("30d"),
    limit: z.number().default(36),
    offset: z.number().default(0),
    query: z.string().default(""),
  },
  ({ range, limit, offset, query }) =>
    rpc("GET", "/api/visibility/crawledPages", { range, limit, offset, query, crawlerFilter: [], sort: "crawls" })
);

tool(
  "crawl_log",
  "Raw AI-crawler request log",
  { range: z.string().default("30d"), limit: z.number().default(36) },
  ({ range, limit }) => rpc("GET", "/api/visibility/crawlLog", { range, limit })
);

tool(
  "article_citations",
  "Citations of your articles in AI answers. range e.g. '30d'",
  { range: z.string().default("30d") },
  ({ range }) => rpc("GET", "/api/visibility/articleCitations", { range })
);

tool("list_articles", "Articles in ByDefault's content workspace", {}, () => rpc("GET", "/api/article/list"));

tool("activity_live", "Live activity: currently running prompt scans / gap scans", {}, () =>
  rpc("GET", "/api/activity/live")
);

tool(
  "raw_rpc",
  "Escape hatch: call any ByDefault RPC endpoint directly. path like '/api/visibility/listCompetitors'; params are plain JSON values (superjson wrapping is handled). Use for endpoints not yet wrapped as tools — verify new write endpoints against a fresh HAR capture before calling them.",
  { method: z.enum(["GET", "POST"]), path: z.string().startsWith("/api/"), params: z.record(z.any()).optional() },
  ({ method, path, params }) => rpc(method, path, params ?? {})
);

const transport = new StdioServerTransport();
await server.connect(transport);
