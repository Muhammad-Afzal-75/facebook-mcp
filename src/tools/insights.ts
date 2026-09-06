import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerInsightTools(server: McpServer) {
  server.registerTool(
    "get_post_insights",
    {
      description: "Get performance insights (impressions, engagement, reactions) for a specific post",
      inputSchema: {
        postId: z.string().describe("The Facebook post ID"),
      },
    },
    async ({ postId }) => {
      const data = await facebook.getPostInsights(postId);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "get_page_insights",
    {
      description: "Get overall Page-level performance insights (engagement, fan growth, views)",
      inputSchema: {
        metric: z
          .string()
          .optional()
          .describe("Comma-separated Graph API insight metrics. Omit to use current safe defaults."),
        period: z
          .enum(["day", "week", "days_28"])
          .default("day")
          .describe("Aggregation period for the metrics"),
      },
    },
    async ({ metric, period }) => {
      const data = await facebook.getPageInsights(metric, period);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "analyze_content",
    {
      description:
        "Analyze recent posts' performance and summarize what content is working (pure data-shaping — aggregates insights, does not call an external LLM)",
      inputSchema: {
        limit: z.number().min(1).max(50).default(10).describe("Number of recent posts to analyze"),
      },
    },
    async ({ limit }) => {
      const posts = await facebook.getPagePosts(limit);
      const results: any[] = [];

      for (const post of posts.data || []) {
        try {
          const insights = await facebook.getPostInsights(post.id);
          results.push({ post, insights: insights.data });
        } catch (err: any) {
          results.push({ post, insights: null, error: err.message });
        }
      }

      const summary = {
        totalPostsAnalyzed: results.length,
        posts: results,
      };

      return jsonResult(summary);
    }
  );
}
