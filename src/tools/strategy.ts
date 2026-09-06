import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { facebook } from "../facebook.js";
import { jsonResult } from "../toolResult.js";

// Default content pillars — matches the weekly pattern you sketched.
// Each pillar has keywords used to tag past posts so we can measure
// how that pillar actually performed on the Page.
const CONTENT_PILLARS = [
  { id: "react_tip", label: "React Tip", keywords: ["react", "hook", "usestate", "jsx", "component"] },
  { id: "backend_concept", label: "Backend Concept", keywords: ["backend", "api", "database", "server", "express", "mongodb"] },
  { id: "coding_mistake", label: "Coding Mistake", keywords: ["mistake", "bug", "avoid", "wrong", "error"] },
  { id: "nodejs_tip", label: "Node.js Tip", keywords: ["node", "node.js", "npm", "async", "event loop"] },
  { id: "programming_reel", label: "Programming Reel", keywords: ["reel", "video", "watch", "demo"] },
  { id: "educational_carousel", label: "Educational Carousel", keywords: ["carousel", "swipe", "slides", "guide", "steps"] },
  { id: "engagement_post", label: "Engagement Post", keywords: ["question", "comment", "poll", "what do you think", "agree"] },
] as const;

const WEEK_TEMPLATE = [
  "react_tip",
  "backend_concept",
  "coding_mistake",
  "nodejs_tip",
  "programming_reel",
  "educational_carousel",
  "engagement_post",
] as const;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function tagPillar(message: string | undefined): string {
  const text = (message || "").toLowerCase();
  for (const pillar of CONTENT_PILLARS) {
    if (pillar.keywords.some((k) => text.includes(k))) return pillar.id;
  }
  return "uncategorized";
}

function extractEngagement(insightsData: any): number {
  // Sums whatever numeric total values Graph API returned for a post's
  // insight metrics (impressions, engaged_users, reactions, etc).
  let total = 0;
  for (const metric of insightsData?.data || []) {
    const val = metric?.values?.[0]?.value;
    if (typeof val === "number") total += val;
    else if (val && typeof val === "object") {
      total += Object.values(val).reduce(
        (sum: number, v) => sum + (typeof v === "number" ? v : 0),
        0
      );
    }
  }
  return total;
}

export function registerStrategyTools(server: McpServer) {
  server.registerTool(
    "create_content_strategy",
    {
      description:
        "Run the full pipeline: pull recent posts, pull their insights and Page insights, " +
        "identify winning/weak content topics, and generate a 30-day content calendar.",
      inputSchema: {
        postsToAnalyze: z
          .number()
          .min(5)
          .max(50)
          .default(20)
          .describe("How many recent posts to pull and analyze"),
      },
    },
    async ({ postsToAnalyze }) => {
      // 1. get_recent_posts
      const postsResp = await facebook.getPagePosts(postsToAnalyze);
      const posts = postsResp.data || [];

      // 2. get_post_insights (per post)
      const performance: Record<string, { count: number; totalEngagement: number }> = {};
      for (const post of posts) {
        const pillarId = tagPillar(post.message);
        let engagement = 0;
        try {
          const insights = await facebook.getPostInsights(post.id);
          engagement = extractEngagement(insights);
        } catch {
          // Post may be too old for some metrics, or insights unavailable — skip silently.
        }
        if (!performance[pillarId]) performance[pillarId] = { count: 0, totalEngagement: 0 };
        performance[pillarId].count += 1;
        performance[pillarId].totalEngagement += engagement;
      }

      // 3. get_page_insights
      let pageInsights: any = null;
      try {
        pageInsights = await facebook.getPageInsights();
      } catch {
        pageInsights = { note: "Page insights unavailable (check permissions/token)." };
      }

      // 4-6. Analyze performance, identify winning/weak topics
      const ranked = Object.entries(performance)
        .filter(([id]) => id !== "uncategorized")
        .map(([id, stats]) => ({
          id,
          label: CONTENT_PILLARS.find((p) => p.id === id)?.label || id,
          postsAnalyzed: stats.count,
          avgEngagement: stats.count ? +(stats.totalEngagement / stats.count).toFixed(2) : 0,
        }))
        .sort((a, b) => b.avgEngagement - a.avgEngagement);

      const winningTopics = ranked.slice(0, 3);
      const weakTopics = ranked.slice(-3).reverse();

      // 7. Create 30-day strategy
      // Base rotation follows your weekly template. If we have real
      // performance data, weak-performing pillars are swapped out in
      // favor of winning pillars so the calendar leans into what works.
      let rotation: string[] = [...WEEK_TEMPLATE];
      if (ranked.length >= 2) {
        const weakIds = new Set(weakTopics.map((t) => t.id));
        const winners = winningTopics.map((t) => t.id);
        let winnerCursor = 0;
        rotation = rotation.map((pillarId) => {
          if (weakIds.has(pillarId) && winners.length) {
            const swap = winners[winnerCursor % winners.length];
            winnerCursor += 1;
            return swap;
          }
          return pillarId;
        });
      }

      const calendar: { day: number; weekday: string; pillar: string; topic: string }[] = [];
      for (let day = 1; day <= 30; day++) {
        const weekdayIndex = (day - 1) % 7;
        const pillarId = rotation[weekdayIndex];
        const pillar = CONTENT_PILLARS.find((p) => p.id === pillarId);
        calendar.push({
          day,
          weekday: DAY_NAMES[weekdayIndex],
          pillar: pillarId,
          topic: pillar?.label || pillarId,
        });
      }

      const result = {
        postsAnalyzed: posts.length,
        performanceByPillar: ranked,
        winningTopics,
        weakTopics,
        pageInsightsSnapshot: pageInsights,
        weeklyRotation: rotation.map((id, i) => ({
          weekday: DAY_NAMES[i],
          pillar: id,
          topic: CONTENT_PILLARS.find((p) => p.id === id)?.label || id,
        })),
        thirtyDayCalendar: calendar,
      };

      return jsonResult(result);
    }
  );
}
