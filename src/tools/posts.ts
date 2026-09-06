import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerPostTools(server: McpServer) {
  server.registerTool(
    "get_page_info",
    {
      description: "Get basic information about my Facebook Page",
      inputSchema: {},
    },
    async () => {
      const data = await facebook.getPageInfo();
      return jsonResult(data);
    }
  );

  server.registerTool(
    "get_recent_posts",
    {
      description: "Get recent posts from my Facebook Page",
      inputSchema: {
        limit: z.number().min(1).max(50).default(10).describe("Number of posts to fetch"),
      },
    },
    async ({ limit }) => {
      const data = await facebook.getPagePosts(limit);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "get_reels",
    {
      description: "Get recent Reels from my Facebook Page",
      inputSchema: {
        limit: z.number().min(1).max(50).default(10).describe("Number of reels to fetch"),
      },
    },
    async ({ limit }) => {
      const data = await facebook.getReels(limit);
      return jsonResult(data);
    }
  );
}
