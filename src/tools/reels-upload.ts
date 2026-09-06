import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

export function registerReelUploadTools(server: McpServer) {
  server.registerTool(
    "schedule_reel",
    {
      description:
        "Upload a video (from a public URL) as a Facebook Reel and schedule it to publish automatically at a " +
        "future time — Facebook publishes it on its own servers, no further action needed once scheduled. " +
        "Rate limit: max 30 reels published via API per rolling 24 hours.",
      inputSchema: {
        videoUrl: z
          .string()
          .url()
          .describe("Public, directly-downloadable URL to the video file (.mp4, 9:16 recommended)"),
        caption: z.string().min(1).describe("The reel's caption/description, including hashtags"),
        scheduledPublishTimeUnix: z
          .number()
          .int()
          .describe(
            "Unix timestamp (seconds) for when Facebook should auto-publish this reel. Must be at least " +
              "10 minutes and at most 75 days in the future."
          ),
      },
    },
    async ({ videoUrl, caption, scheduledPublishTimeUnix }) => {
      const start = await facebook.startReelUpload();
      const videoId: string = start.video_id;
      const uploadUrl: string = start.upload_url;

      await facebook.transferReelVideoFromUrl(uploadUrl, videoUrl);

      const finish = await facebook.finishReelUpload(videoId, caption, {
        scheduledPublishTime: scheduledPublishTimeUnix,
      });

      return jsonResult({
        status: "scheduled",
        videoId,
        scheduledFor: new Date(scheduledPublishTimeUnix * 1000).toISOString(),
        finishResponse: finish,
      });
    }
  );

  server.registerTool(
    "publish_reel_now",
    {
      description:
        "Upload a video (from a public URL) and publish it as a Facebook Reel IMMEDIATELY (no scheduling). " +
        "This is irreversible via API — double check before calling.",
      inputSchema: {
        videoUrl: z.string().url().describe("Public, directly-downloadable URL to the video file"),
        caption: z.string().min(1).describe("The reel's caption/description, including hashtags"),
      },
    },
    async ({ videoUrl, caption }) => {
      const start = await facebook.startReelUpload();
      const videoId: string = start.video_id;
      const uploadUrl: string = start.upload_url;

      await facebook.transferReelVideoFromUrl(uploadUrl, videoUrl);
      const finish = await facebook.finishReelUpload(videoId, caption);

      return jsonResult({ status: "published", videoId, finishResponse: finish });
    }
  );
}
