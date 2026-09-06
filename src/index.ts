import "dotenv/config";
import express from "express";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

import { registerPostTools } from "./tools/posts.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerPublishTools } from "./tools/publish.js";
import { registerStrategyTools } from "./tools/strategy.js";
import { registerGrowthTools } from "./tools/growth.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerReelUploadTools } from "./tools/reels-upload.js";
import { registerMessengerTools } from "./tools/messenger.js";

function buildServer() {
  const server = new McpServer({
    name: "facebook-ai-manager",
    version: "1.0.0",
  });

  registerPostTools(server);
  registerInsightTools(server);
  registerPublishTools(server);
  registerStrategyTools(server);
  registerGrowthTools(server);
  registerCommentTools(server);
  registerReelUploadTools(server);
  registerMessengerTools(server);

  return server;
}

// Stateless factory: a fresh McpServer instance per request, all wired
// to the same Facebook Graph API client.
const handler = createMcpHandler(() => buildServer());

const app = express();

// NOTE: do NOT apply express.json() globally — toNodeHandler reads the
// raw request body itself. Parsing it here would consume the stream
// and the MCP handler would see an empty body.

// --- Auth gate ---------------------------------------------------------
// The Facebook Page token lives server-side only. Anyone who can reach
// /mcp can call every tool (including publish_post), so this endpoint
// must never be left open on the public internet. Set MCP_AUTH_TOKEN in
// .env, then Claude's remote connector is configured with the same
// value as a Bearer token. Requests without a matching token are
// rejected before they ever reach the MCP handler or Graph API client.
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_AUTH_TOKEN) {
    console.warn(
      "WARNING: MCP_AUTH_TOKEN is not set — /mcp is running with NO authentication. " +
        "Set MCP_AUTH_TOKEN in .env before deploying this publicly."
    );
    return next();
  }
  const header = req.headers.authorization || "";
  const headerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  // Fallback for clients (like claude.ai's web custom-connector UI) that
  // can only send a plain URL with no custom header field. Less safe than
  // a header (URLs can end up in logs/history), but far safer than no
  // auth at all. Prefer the header when a client can send one.
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const token = headerToken || queryToken;
  if (token !== MCP_AUTH_TOKEN) {
    res.status(401).json({ error: "Unauthorized: missing or invalid token" });
    return;
  }
  next();
}

// Claude connects here: https://your-domain.com/mcp
app.all("/mcp", requireAuth, toNodeHandler(handler));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "facebook-ai-manager" });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Facebook AI MCP Server running on http://localhost:${PORT}/mcp`);
  if (!MCP_AUTH_TOKEN) {
    console.warn("MCP_AUTH_TOKEN not set — endpoint is unauthenticated.");
  }
});
