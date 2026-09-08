import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function extractPostType(post: any): string {
  const att = post.attachments?.data?.[0];
  const mediaType = att?.media_type || att?.type;
  if (!mediaType) return "text";
  const m = String(mediaType).toLowerCase();
  if (m.includes("video")) return "video/reel";
  if (m.includes("photo") || m.includes("album")) return "photo";
  if (m.includes("link") || m.includes("share")) return "link";
  return m;
}

function extractHashtags(message: string | undefined): string[] {
  return (message?.match(/#\w+/g) || []).map((t) => t.toLowerCase());
}

function extractFeatures(post: any) {
  const message: string = post.message || "";
  const date = new Date(post.created_time);
  return {
    type: extractPostType(post),
    wordCount: message.trim() ? message.trim().split(/\s+/).length : 0,
    hashtags: extractHashtags(message),
    hasQuestion: message.includes("?"),
    hasEmoji: EMOJI_REGEX.test(message),
    weekday: DAY_NAMES[date.getDay()],
    hour: date.getHours(),
  };
}

function sumMetricValue(insightsData: any, metricName: string): number {
  const metric = insightsData?.data?.find((m: any) => m.name === metricName);
  const val = metric?.values?.[0]?.value;
  if (typeof val === "number") return val;
  if (val && typeof val === "object") {
    return Object.values(val).reduce((s: number, v) => s + (typeof v === "number" ? v : 0), 0);
  }
  return 0;
}

function extractViews(insightsData: any): number {
  // blue_reels_play_count is the actual Reels "Plays" count shown in the
  // Professional Dashboard — prefer it over post_video_views, which only
  // counts 3s+ views and significantly undercounts Reels.
  const reelsPlays = sumMetricValue(insightsData, "blue_reels_play_count");
  if (reelsPlays > 0) return reelsPlays;
  const videoViews = sumMetricValue(insightsData, "post_video_views");
  if (videoViews > 0) return videoViews;
  return (
    sumMetricValue(insightsData, "post_impressions_organic") +
    sumMetricValue(insightsData, "post_impressions_paid") +
    sumMetricValue(insightsData, "post_impressions_viral")
  );
}

function extractEngagement(insightsData: any): number {
  const engagedUsers = sumMetricValue(insightsData, "post_engaged_users");
  if (engagedUsers > 0) return engagedUsers;
  return sumMetricValue(insightsData, "post_reactions_by_type_total") + sumMetricValue(insightsData, "post_clicks");
}

function avg(nums: number[]): number {
  return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : 0;
}

function mostCommon(items: string[]): string | null {
  if (!items.length) return null;
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function registerGrowthTools(server: McpServer) {
  server.registerTool(
    "get_growth_recommendations",
    {
      description:
        "Analyze recent posts against real Page performance (reach/views/engagement) and produce concrete, " +
        "actionable recommendations for growing followers and views — content type, caption style, hashtags, and timing. " +
        "Read-only: does not post or change anything on the Page.",
      inputSchema: {
        postsToAnalyze: z
          .number()
          .min(5)
          .max(50)
          .default(25)
          .describe("How many recent posts to pull and analyze"),
      },
    },
    async ({ postsToAnalyze }) => {
      const pageInfo = await facebook.getPageInfo().catch(() => null);

      const postsResp = await facebook.getPagePosts(postsToAnalyze);
      const posts = postsResp.data || [];

      const analyzed: any[] = [];
      for (const post of posts) {
        let views = 0;
        let engagement = 0;
        try {
          const insights = await facebook.getPostInsights(post.id);
          views = extractViews(insights);
          engagement = extractEngagement(insights);
        } catch {
          // Leave as 0 — insights can be unavailable for very old or restricted posts.
        }
        analyzed.push({
          id: post.id,
          message: post.message || "",
          permalink_url: post.permalink_url,
          created_time: post.created_time,
          views,
          engagement,
          features: extractFeatures(post),
        });
      }

      // Rank by views (what the user asked to optimize for); fall back to
      // engagement for posts where views data wasn't available.
      const ranked = [...analyzed].sort((a, b) => (b.views || b.engagement) - (a.views || a.engagement));

      const splitSize = Math.max(3, Math.floor(ranked.length / 4));
      const topPerformers = ranked.slice(0, splitSize);
      const weakPerformers = ranked.slice(-splitSize).reverse();

      // --- Compare features between top and weak groups ---
      const topTypes = topPerformers.map((p) => p.features.type);
      const weakTypes = weakPerformers.map((p) => p.features.type);
      const topWordAvg = avg(topPerformers.map((p) => p.features.wordCount));
      const weakWordAvg = avg(weakPerformers.map((p) => p.features.wordCount));
      const topHashtagAvg = avg(topPerformers.map((p) => p.features.hashtags.length));
      const weakHashtagAvg = avg(weakPerformers.map((p) => p.features.hashtags.length));
      const topHours = topPerformers.map((p) => p.features.hour);
      const topWeekdays = topPerformers.map((p) => p.features.weekday);
      const topQuestionRate = topPerformers.filter((p) => p.features.hasQuestion).length / (topPerformers.length || 1);
      const topEmojiRate = topPerformers.filter((p) => p.features.hasEmoji).length / (topPerformers.length || 1);
      const bestHashtags = [
        ...new Set(topPerformers.flatMap((p) => p.features.hashtags)),
      ].slice(0, 10);

      const recommendations: string[] = [];

      const bestType = mostCommon(topTypes);
      const worstType = mostCommon(weakTypes);
      if (bestType && worstType && bestType !== worstType) {
        recommendations.push(
          `"${bestType}" type posts sabse zyada views/reach le rahe hain — is type ko zyada frequently post karo. "${worstType}" type weak perform kar raha hai, isko kam karo ya format change karo.`
        );
      } else if (bestType) {
        recommendations.push(`"${bestType}" tumhara best-performing content type hai — isi pattern pe zyada content banao.`);
      }

      if (Math.abs(topWordAvg - weakWordAvg) > 3) {
        recommendations.push(
          topWordAvg < weakWordAvg
            ? `Chhoti captions (~${topWordAvg} words) zyada perform kar rahi hain lambi captions (~${weakWordAvg} words) ke muqable — caption crisp rakho.`
            : `Detailed captions (~${topWordAvg} words) behtar chal rahi hain chhoti captions (~${weakWordAvg} words) ke muqable — thoda context/story add karo.`
        );
      }

      if (topHashtagAvg > weakHashtagAvg + 0.5) {
        recommendations.push(
          `Top posts average ${topHashtagAvg} hashtags use karte hain vs weak posts ke ${weakHashtagAvg} — hashtags consistently use karo.`
        );
      }
      if (bestHashtags.length) {
        recommendations.push(`Best-performing hashtags jo tumne pehle use kiye: ${bestHashtags.join(", ")}`);
      }

      if (topPerformers.length >= 3) {
        const peakHour = mostCommon(topHours.map(String));
        const peakDay = mostCommon(topWeekdays);
        if (peakDay && peakHour) {
          recommendations.push(
            `Top posts zyada tar ${peakDay} ko, ~${peakHour}:00 (Page timezone) ke aas paas post hue hain — is time slot ko try karo.`
          );
        }
      }

      if (topQuestionRate > 0.4) {
        recommendations.push("Jo posts sawaal poochte hain ('aap kya sochte hain?' type) unka engagement zyada hai — captions me questions add karo.");
      }
      if (topEmojiRate > 0.5) {
        recommendations.push("Top posts me emojis use hote hain — captions me 1-2 relevant emoji add karna help kar sakta hai.");
      }

      if (!recommendations.length) {
        recommendations.push(
          "Abhi enough data pattern nahi bana (posts kam hain ya insights thin hain) — 10-15 aur posts ke baad dobara analyze karo, pattern zyada clear hoga."
        );
      }

      const result = {
        pageSnapshot: pageInfo
          ? {
              name: pageInfo.name,
              fanCount: pageInfo.fan_count,
              followersCount: pageInfo.followers_count,
            }
          : null,
        postsAnalyzed: analyzed.length,
        topPerformers: topPerformers.map((p) => ({
          message: p.message.slice(0, 120),
          permalink_url: p.permalink_url,
          views: p.views,
          engagement: p.engagement,
          type: p.features.type,
          hashtags: p.features.hashtags,
          postedOn: `${p.features.weekday} ${p.features.hour}:00`,
        })),
        weakPerformers: weakPerformers.map((p) => ({
          message: p.message.slice(0, 120),
          permalink_url: p.permalink_url,
          views: p.views,
          engagement: p.engagement,
          type: p.features.type,
          postedOn: `${p.features.weekday} ${p.features.hour}:00`,
        })),
        recommendations,
      };

      return jsonResult(result);
    }
  );
}
