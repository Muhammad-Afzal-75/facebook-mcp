import "dotenv/config";

// Meta retired Graph API v20 in Sept 2026; v25.0 is current as of this
// writing. Override via GRAPH_API_VERSION in .env if Meta ships a newer
// one before you next touch this file.
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v25.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

function assertConfigured() {
  if (!PAGE_ID || !PAGE_ACCESS_TOKEN) {
    throw new Error(
      "Missing FACEBOOK_PAGE_ID or FACEBOOK_PAGE_ACCESS_TOKEN in .env. Copy .env.example to .env and fill in your credentials."
    );
  }
}

type GraphParams = Record<string, string | number | boolean | undefined>;

async function graphGet(path: string, params: GraphParams = {}) {
  assertConfigured();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", PAGE_ACCESS_TOKEN!);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString());
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Graph API GET ${path} returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Graph API GET ${path} failed: ${data?.error?.message || res.statusText}`
    );
  }
  return data;
}

async function graphPost(path: string, body: GraphParams = {}) {
  assertConfigured();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", PAGE_ACCESS_TOKEN!);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(
      Object.entries(body)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ),
  });
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Graph API POST ${path} returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Graph API POST ${path} failed: ${data?.error?.message || res.statusText}`
    );
  }
  return data;
}

// --- Insight metric resilience -----------------------------------------
// Meta has been deprecating/renaming Insights metrics on a rolling basis
// (a large batch of reach/impressions metrics went invalid in June 2026).
// Rather than hardcode one metric list and break the whole call the next
// time Meta renames something, we try the full candidate list in one
// request first (cheap — 1 call), and only fall back to querying metrics
// one at a time — silently dropping whichever ones the current API
// version rejects — if the batched call fails.
async function graphGetResilientMetrics(
  path: string,
  candidateMetrics: string[],
  extraParams: GraphParams = {}
) {
  try {
    return await graphGet(path, { ...extraParams, metric: candidateMetrics.join(",") });
  } catch {
    const data: any[] = [];
    const dropped: string[] = [];
    for (const metric of candidateMetrics) {
      try {
        const single = await graphGet(path, { ...extraParams, metric });
        data.push(...(single.data || []));
      } catch {
        dropped.push(metric);
      }
    }
    return { data, _droppedMetrics: dropped };
  }
}

// Post-level candidates. post_impressions_unique and other "unique"/reach
// variants were deprecated Jun 2026 — deliberately not requested here.
// post_video_views only counts views 3s+ and undercounts Reels significantly
// — it's kept only as a last-resort fallback. It is NOT the "Plays" number
// shown in the app's reel grid / Professional Dashboard; that number comes
// from blue_reels_play_count, which Meta only exposes on the underlying
// video object's /video_insights edge (see REEL_METRIC_CANDIDATES below),
// not on the post's own /insights edge — confirmed Sep 2026 against Meta's
// Video Insights docs after blue_reels_play_count silently returned no
// data when requested here.
const POST_METRIC_CANDIDATES = [
  "post_impressions_organic",
  "post_impressions_paid",
  "post_impressions_viral",
  "post_engaged_users",
  "post_clicks",
  "post_reactions_by_type_total",
  "post_video_views",
];

// Reel-level candidates, queried against /{video-id}/video_insights (the
// video object, not the post). blue_reels_play_count is the "Plays" count
// shown in the app's reel grid / Professional Dashboard.
const REEL_METRIC_CANDIDATES = ["blue_reels_play_count", "fb_reels_replay_count"];

// Page-level candidates. page_impressions and page_fans were deprecated
// Nov 2025 — not requested here.
const PAGE_METRIC_CANDIDATES = [
  "page_engaged_users",
  "page_post_engagements",
  "page_fan_adds",
  "page_fan_removes",
  "page_views_total",
];

export const facebook = {
  pageId: PAGE_ID,

  async getPageInfo() {
    return graphGet(`/${PAGE_ID}`, {
      fields: "id,name,fan_count,followers_count,link,about,category",
    });
  },

  async getPagePosts(limit = 10) {
    return graphGet(`/${PAGE_ID}/posts`, {
      fields: "id,message,created_time,permalink_url,attachments{media_type,type,target}",
      limit,
    });
  },

  // Reels' real "Plays" count only lives on the underlying video object's
  // /video_insights edge, not on the post's own /insights edge. We resolve
  // the video ID from the post's attachment target, then query it
  // separately and merge the result into the post-level insights so
  // callers (analyze_content, growth tools, get_post_insights) don't need
  // to know about the split.
  async getPostInsights(postId: string) {
    const postInsights = await graphGetResilientMetrics(`/${postId}/insights`, POST_METRIC_CANDIDATES);
    try {
      const post = await graphGet(`/${postId}`, { fields: "attachments{media_type,type,target}" });
      const videoId = post?.attachments?.data?.[0]?.target?.id;
      if (videoId) {
        const reelInsights = await graphGetResilientMetrics(`/${videoId}/video_insights`, REEL_METRIC_CANDIDATES);
        if (reelInsights?.data?.length) {
          return { data: [...(postInsights.data || []), ...reelInsights.data] };
        }
      }
    } catch {
      // Not a video/reel post, or the attachment has no linked video
      // object — fall back to post-level insights only.
    }
    return postInsights;
  },

  async getPageInsights(metric?: string, period = "day") {
    const candidates = metric ? metric.split(",") : PAGE_METRIC_CANDIDATES;
    return graphGetResilientMetrics(`/${PAGE_ID}/insights`, candidates, { period });
  },

  async getReels(limit = 10) {
    return graphGet(`/${PAGE_ID}/video_reels`, {
      fields: "id,description,created_time,permalink_url",
      limit,
    });
  },

  async createDraftPost(message: string, link?: string) {
    // Local "draft" — does NOT call the Graph API. Just returns a preview
    // object so a human (or Claude) can review before publishing.
    return {
      status: "draft",
      preview: { message, link: link || null },
      note: "This is a draft only. Call publish_post to actually post it.",
    };
  },

  async publishPost(message: string, link?: string) {
    return graphPost(`/${PAGE_ID}/feed`, { message, link });
  },

  async getComments(postId: string, limit = 25) {
    return graphGet(`/${postId}/comments`, {
      fields: "id,message,from,created_time,like_count,comment_count",
      limit,
      order: "reverse_chronological",
    });
  },

  async draftCommentReply(commentId: string, message: string) {
    // Local preview only — does NOT call the Graph API.
    return {
      status: "draft",
      commentId,
      preview: { message },
      note: "This is a draft only. Call reply_to_comment to actually post it.",
    };
  },

  async replyToComment(commentId: string, message: string) {
    // Requires the pages_manage_engagement permission on the Page token.
    return graphPost(`/${commentId}/comments`, { message });
  },

  // --- Reels upload/scheduling --------------------------------------
  // 3-phase resumable upload: start -> transfer -> finish. We use the
  // "file_url" transfer method (Facebook fetches the video itself from
  // a public URL) instead of proxying raw video bytes through our own
  // server — simpler and avoids request-size limits.
  async startReelUpload() {
    // Returns { video_id, upload_url }
    return graphPost(`/${PAGE_ID}/video_reels`, { upload_phase: "start" });
  },

  async transferReelVideoFromUrl(uploadUrl: string, videoUrl: string) {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${PAGE_ACCESS_TOKEN}`,
        file_url: videoUrl,
      },
    });
    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Reel video transfer returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`
      );
    }
    if (!res.ok) {
      throw new Error(`Reel video transfer failed: ${data?.error?.message || res.statusText}`);
    }
    return data;
  },

  async finishReelUpload(
    videoId: string,
    description: string,
    options: { scheduledPublishTime?: number } = {}
  ) {
    const isScheduled = !!options.scheduledPublishTime;
    return graphPost(`/${PAGE_ID}/video_reels`, {
      upload_phase: "finish",
      video_id: videoId,
      description,
      video_state: isScheduled ? "SCHEDULED" : "PUBLISHED",
      ...(isScheduled ? { scheduled_publish_time: options.scheduledPublishTime } : {}),
    });
  },

  // --- Messenger -------------------------------------------------------
  // Requires the pages_messaging permission. Facebook enforces the
  // 24-hour standard messaging window server-side — sendMessage will
  // fail on its own if the person hasn't messaged the Page recently;
  // we don't need to track that ourselves.
  async getConversations(limit = 25) {
    return graphGet(`/${PAGE_ID}/conversations`, {
      fields: "id,updated_time,snippet,participants",
      limit,
    });
  },

  async getMessages(conversationId: string, limit = 25) {
    return graphGet(`/${conversationId}/messages`, {
      fields: "id,message,from,created_time",
      limit,
    });
  },

  async draftMessageReply(recipientId: string, message: string) {
    return {
      status: "draft",
      recipientId,
      preview: { message },
      note: "This is a draft only. Call send_message to actually send it.",
    };
  },

  async sendMessage(recipientId: string, message: string) {
    return graphPost(`/me/messages`, {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text: message }),
      messaging_type: "RESPONSE",
    });
  },
};
