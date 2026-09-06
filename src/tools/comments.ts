import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerCommentTools(server: McpServer) {
  server.registerTool(
    "get_comments",
    {
      description: "Get comments on a specific post or reel from my Facebook Page",
      inputSchema: {
        postId: z.string().describe("The Facebook post/reel ID"),
        limit: z.number().min(1).max(100).default(25).describe("Number of comments to fetch"),
      },
    },
    async ({ postId, limit }) => {
      const data = await facebook.getComments(postId, limit);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "draft_comment_reply",
    {
      description:
        "Create a DRAFT reply preview for a comment (does not post it). Use this first to review before calling reply_to_comment.",
      inputSchema: {
        commentId: z.string().describe("The comment ID to reply to"),
        message: z.string().min(1).describe("The reply text"),
      },
    },
    async ({ commentId, message }) => {
      const draft = await facebook.draftCommentReply(commentId, message);
      return jsonResult(draft);
    }
  );

  server.registerTool(
    "reply_to_comment",
    {
      description:
        "Post a LIVE reply to a comment on the Page. This is irreversible via API — double check the message before calling.",
      inputSchema: {
        commentId: z.string().describe("The comment ID to reply to"),
        message: z.string().min(1).describe("The reply text"),
      },
    },
    async ({ commentId, message }) => {
      const result = await facebook.replyToComment(commentId, message);
      return jsonResult(result);
    }
  );
}
