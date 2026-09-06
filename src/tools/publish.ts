import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerPublishTools(server: McpServer) {
  server.registerTool(
    "create_post",
    {
      description:
        "Create a DRAFT post preview (does not publish to Facebook). Use this first to review content before calling publish_post.",
      inputSchema: {
        message: z.string().min(1).describe("The post text/caption"),
        link: z.string().url().optional().describe("Optional link to attach to the post"),
      },
    },
    async ({ message, link }) => {
      const draft = await facebook.createDraftPost(message, link);
      return jsonResult(draft);
    }
  );

  server.registerTool(
    "publish_post",
    {
      description:
        "Publish a post LIVE to the Facebook Page. This is irreversible via API — double check the message before calling.",
      inputSchema: {
        message: z.string().min(1).describe("The post text/caption"),
        link: z.string().url().optional().describe("Optional link to attach to the post"),
      },
    },
    async ({ message, link }) => {
      const result = await facebook.publishPost(message, link);
      return jsonResult(result);
    }
  );
}
