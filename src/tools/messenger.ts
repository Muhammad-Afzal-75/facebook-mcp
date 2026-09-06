import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerMessengerTools(server: McpServer) {
  server.registerTool(
    "get_conversations",
    {
      description: "Get recent Messenger conversations on my Facebook Page",
      inputSchema: {
        limit: z.number().min(1).max(50).default(25).describe("Number of conversations to fetch"),
      },
    },
    async ({ limit }) => {
      const data = await facebook.getConversations(limit);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "get_messages",
    {
      description: "Get messages within a specific Messenger conversation",
      inputSchema: {
        conversationId: z.string().describe("The conversation ID (from get_conversations)"),
        limit: z.number().min(1).max(50).default(25).describe("Number of messages to fetch"),
      },
    },
    async ({ conversationId, limit }) => {
      const data = await facebook.getMessages(conversationId, limit);
      return jsonResult(data);
    }
  );

  server.registerTool(
    "draft_message_reply",
    {
      description:
        "Create a DRAFT Messenger reply preview (does not send it). Use this first to review before calling send_message.",
      inputSchema: {
        recipientId: z.string().describe("The recipient's Page-scoped ID (PSID), from get_messages"),
        message: z.string().min(1).describe("The reply text"),
      },
    },
    async ({ recipientId, message }) => {
      const draft = await facebook.draftMessageReply(recipientId, message);
      return jsonResult(draft);
    }
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Send a LIVE Messenger reply. Only works if the person messaged the Page within the last 24 hours " +
        "(Facebook enforces this — Meta's Standard Messaging Window policy). Irreversible — double check before calling.",
      inputSchema: {
        recipientId: z.string().describe("The recipient's Page-scoped ID (PSID), from get_messages"),
        message: z.string().min(1).describe("The reply text"),
      },
    },
    async ({ recipientId, message }) => {
      const result = await facebook.sendMessage(recipientId, message);
      return jsonResult(result);
    }
  );
}
