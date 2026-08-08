import { parseCommunityInfoPayload, requireCommunityTimeline } from "./graphqlContracts.js";

const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D" +
  "1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const REQUEST_DELAY_MS = 1500;
const ROSTER_REQUEST_DELAY_MS = 750;
const NATIVE_ROSTER_FALLBACK_COUNT = 100;
// A page can legitimately return only members already collected from an earlier
// page: the live native walk on a 79,000-member Community averaged about 91
// unique records per 100-record page. Ending the crawl on the first such page
// discards the remaining roster and caches the truncation as terminal, so
// duplicate-only pages are tolerated while the server cursor keeps advancing.
const MAX_IDLE_ROSTER_PAGES = 3;
// Schema 4 records unique tweet IDs and separates original Community posts
// from Community replies. Older checkpoints cannot provide those guarantees,
// so they are intentionally rebuilt.
const ACTIVITY_CHECKPOINT_SCHEMA = 4;
const TIMELINE_BACKFILL_CHECKPOINT_SCHEMA = 1;
const DOCUMENT_IDS = Object.freeze({
  CommunityQuery: "-ElI1vg3dYbttVMhBhGdLw",
  CommunityTweetsTimeline: "dD1uF9vQx0OX-e1rKA4YLw",
  CommunityMediaTimeline: "9MUOEALCr46-4atDb2nq1A",
  CommunityAboutTimeline: "zEwxuy-wFr9_C6lPW4xXmA",
  CommunityTweetSearchModuleQuery: "00kKs1lbMvTB7qWooua0rQ",
  CommunityAnalyticsQuery: "WjkcJu3u0ICw288PAUaPOQ",
  moderatorsSliceTimeline_Query: "0oYT9GRiWUhrz5xoqFE9uw",
});

// Extracted from the signed X Android 12.11.0-release.0 operation registry
// (2026-07-24). X may retire or server-cap this persisted operation, so callers
// must retain the live web-query and DOM fallbacks.
//
// A 2026-07-30 signed-in walk to termination measured this route reaching
// 46,960 unique members over 501 pages on a 79,397-member Community — about
// five times the roughly 9,300 records the web `membersSliceTimeline_Query`
// cursor returns. It is the primary roster source, not an experiment.
//
// `count` is capped at 100 server-side without an error: a request for 200
// still returns 100 records, so the larger request only misreports the page
// size in diagnostics. The downgrade path below is retained in case X starts
// rejecting oversized pages outright instead of silently clamping them.
export const NATIVE_MEMBERS_ALL_OPERATION = Object.freeze({
  documentId: "mq7ptH6j5ApwD9VEGR46sg",
  operation: "CommunitiesMembersAllQuery",
  communityVariable: "community_rest_id",
  cursorVariable: "cursor",
  variables: Object.freeze({ count: NATIVE_ROSTER_FALLBACK_COUNT }),
  features: Object.freeze({
    grok_translations_timeline_user_bio_auto_translation_is_enabled: false,
    unified_cards_ad_metadata_container_dynamic_card_content_query_enabled: false,
    android_ad_formats_media_component_render_overlay_enabled: false,
    unified_cards_destination_url_params_enabled: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    immersive_video_status_linkable_timestamps: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    blue_business_profile_image_shape_enabled: true,
    super_follow_user_api_enabled: false,
    super_follow_badge_privacy_enabled: false,
    super_follow_exclusive_tweet_notifications_enabled: false,
    profile_label_improvements_pcf_label_in_profile_enabled: true,
    subscriptions_verification_info_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    premium_content_api_read_enabled: false,
    super_follow_tweet_api_enabled: false,
    longform_notetweets_consumption_enabled: true,
    articles_api_enabled: true,
    grok_android_analyze_trend_fetch_enabled: false,
    android_quick_promote_analytics_banner_enabled: false,
    grok_translations_post_auto_translation_is_enabled: false,
    grok_translations_community_note_auto_translation_is_enabled: false,
    grok_translations_community_note_translation_is_enabled: false,
    android_graphql_skip_api_media_color_palette: false,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
  }),
});

const MEMBER_RELATIONSHIP_OPERATION = Object.freeze({
  documentId: "6YgvBKI7c3YZ9d7zKKojng",
  operation: "CommunityMemberRelationshipTypeahead",
});

const COMMUNITY_FEATURES = {
  c9s_list_members_action_api_enabled: false,
  c9s_superc9s_indication_enabled: false,
};

// Persisted X queries reject requests when feature variables referenced by the
// current operation are missing. The live Latest, Media, About, and Community
// search operations currently share this 38-switch contract.
const TIMELINE_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

export class StoppedError extends Error {
  constructor() {
    super("Stopped by user.");
    this.name = "StoppedError";
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new StoppedError());
    }, { once: true });
  });
}

function waitLabel(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export class AdaptiveRateLimiter {
  constructor(minDelayMs = REQUEST_DELAY_MS) {
    this.minDelayMs = Math.max(300, minDelayMs);
    this.delayMs = this.minDelayMs;
  }

  success() {
    this.delayMs = Math.max(this.minDelayMs, this.delayMs * 0.98);
  }

  failure(multiplier = 1.5) {
    this.delayMs = Math.min(12000, this.delayMs * multiplier);
  }

  async wait(signal) {
    await delay(this.delayMs + Math.random() * this.delayMs * 0.08, signal);
  }
}

export function calendarActivityWindow(lookbackDays, now = new Date()) {
  const days = Math.max(1, Math.floor(Number(lookbackDays) || 1));
  const untilDate = new Date(now);
  const sinceDate = new Date(untilDate);
  sinceDate.setDate(sinceDate.getDate() - (days - 1));
  sinceDate.setHours(0, 0, 0, 0);
  return { sinceDate, untilDate };
}

async function csrfToken() {
  const cookie = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
  if (!cookie?.value) throw new Error("Log into x.com in this Chrome profile, then retry.");
  return cookie.value;
}

async function graphqlGet(
  documentId,
  operation,
  variables,
  features,
  {
    signal,
    requestStats,
    log,
    limiter = new AdaptiveRateLimiter(),
    maxAttempts = 6,
    clientTransactionId = null,
  } = {}
) {
  const ct0 = await csrfToken();
  const params = new URLSearchParams({ variables: JSON.stringify(variables) });
  if (features) params.set("features", JSON.stringify(features));
  const url = `https://x.com/i/api/graphql/${documentId}/${operation}?${params}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new StoppedError();
    let response;
    const requestStartedAt = Date.now();
    try {
      response = await fetch(url, {
        credentials: "include",
        signal,
        headers: {
          authorization: `Bearer ${BEARER}`,
          "x-csrf-token": ct0,
          "x-twitter-active-user": "yes",
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-client-language": "en",
          ...(clientTransactionId ? { "x-client-transaction-id": clientTransactionId } : {}),
        },
      });
    } catch (error) {
      if (error.name === "AbortError") throw new StoppedError();
      if (requestStats) {
        requestStats.network ||= [];
        requestStats.network.push({
          operation,
          attempt,
          status: null,
          durationMs: Date.now() - requestStartedAt,
          outcome: "network-error",
        });
        if (requestStats.network.length > 1000) requestStats.network.shift();
      }
      limiter.failure();
      if (attempt === maxAttempts) throw new Error(`Network request failed: ${error.message}`);
      const waitMs = Math.min(20000, 1200 * 2 ** (attempt - 1));
      log?.(`Network error; retrying in ${waitLabel(waitMs)}.`);
      await delay(waitMs, signal);
      continue;
    }

    if (requestStats) {
      requestStats.count = (requestStats.count || 0) + 1;
      requestStats.quotas ||= {};
      requestStats.network ||= [];
      requestStats.network.push({
        operation,
        attempt,
        status: response.status,
        durationMs: Date.now() - requestStartedAt,
        outcome: response.ok ? "response" : "http-error",
      });
      if (requestStats.network.length > 1000) requestStats.network.shift();
      const numberHeader = (name) => {
        const raw = response.headers.get(name);
        if (raw == null || raw === "") return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      };
      const limit = numberHeader("x-rate-limit-limit");
      const remaining = numberHeader("x-rate-limit-remaining");
      const resetAtSeconds = numberHeader("x-rate-limit-reset");
      if ([limit, remaining, resetAtSeconds].some((value) => value != null)) {
        const previousQuota = requestStats.quotas[operation] || {};
        requestStats.quotas[operation] = {
          limit,
          remaining,
          resetAt: resetAtSeconds == null ? null : resetAtSeconds * 1000,
          warned: previousQuota.warned === true,
        };
        if (
          remaining != null &&
          remaining <= 5 &&
          !requestStats.quotas[operation].warned
        ) {
          requestStats.quotas[operation].warned = true;
          log?.(`${operation} has ${remaining} server-reported request(s) remaining in this window.`);
          limiter.failure(1.5);
        }
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Your x.com session cannot access this Community. Log in again and verify the Members page opens.");
    }
    if (response.status === 429) {
      limiter.failure(2);
      const resetSeconds = Number(response.headers.get("x-rate-limit-reset"));
      const retrySeconds = Number(response.headers.get("retry-after"));
      const waitMs = Math.min(
        15 * 60 * 1000,
        Math.max(
          Number.isFinite(resetSeconds) ? resetSeconds * 1000 - Date.now() : 0,
          Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
          4000 * 2 ** (attempt - 1)
        ) + 1000
      );
      if (attempt === maxAttempts) {
        const error = new Error(`X rate limit remained active after ${maxAttempts} attempts.`);
        error.code = "rate-limited";
        throw error;
      }
      log?.(`X rate limit reached; waiting ${waitLabel(waitMs)}.`);
      await delay(waitMs, signal);
      continue;
    }
    if (response.status >= 500) {
      limiter.failure();
      if (attempt === maxAttempts) throw new Error(`X request failed (${response.status}).`);
      await delay(Math.min(20000, 1200 * 2 ** (attempt - 1)), signal);
      continue;
    }
    if (!response.ok) throw new Error(`X request failed (${response.status} ${response.statusText}).`);

    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error(`X returned an unreadable response for ${operation}.`);
    if (payload.errors?.length && !payload.data) {
      throw new Error(payload.errors.map((item) => item?.message || "X GraphQL error").join("; "));
    }
    limiter.success();
    await limiter.wait(signal);
    return payload;
  }
  throw new Error(`X did not complete ${operation} after ${maxAttempts} attempts.`);
}

export async function fetchCommunityInfo(communityId, options = {}) {
  const { operation, ...requestOptions } = options;
  const variables = {
    ...(operation?.variables && typeof operation.variables === "object"
      ? operation.variables
      : {}),
    communityId,
  };
  const features = operation?.features && Object.keys(operation.features).length
    ? operation.features
    : COMMUNITY_FEATURES;
  const payload = await graphqlGet(
    operation?.documentId || DOCUMENT_IDS.CommunityQuery,
    operation?.operation || "CommunityQuery",
    variables,
    features,
    {
      ...requestOptions,
      maxAttempts: 3,
      clientTransactionId: operation?.clientTransactionId || null,
    }
  );
  return parseCommunityInfoPayload(payload);
}

// X's own Community analytics panel. Verified readable on 2026-07-30 by a
// signed-in account holding no role in the target Community, so it is a free
// source of the two totals the scanner otherwise has to guess:
// `total_members` is the authoritative coverage denominator, and
// `unique_posters` is the number of distinct authors X counted in the same
// period — the completeness target for author discovery, which previously ran
// until a cursor ended with nothing to measure itself against.
export function parseCommunityAnalyticsPayload(payload) {
  const metrics = firstKey(payload, "current_metrics").value;
  if (!metrics || typeof metrics !== "object") return null;
  const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    totalMembers: finite(metrics.total_members),
    uniquePosters: finite(metrics.unique_posters),
    newMembers: finite(metrics.new_members),
    posts: finite(metrics.num_posts),
    replies: finite(metrics.reply_count),
    favorites: finite(metrics.fav_count),
    impressions: finite(metrics.impressions),
    measuredAt: finite(metrics.timestamp),
  };
}

export async function fetchCommunityAnalytics(communityId, options = {}) {
  const { operation, ...requestOptions } = options;
  const payload = await graphqlGet(
    operation?.documentId || DOCUMENT_IDS.CommunityAnalyticsQuery,
    operation?.operation || "CommunityAnalyticsQuery",
    { communityId },
    null,
    {
      ...requestOptions,
      maxAttempts: 2,
      clientTransactionId: operation?.clientTransactionId || null,
    }
  );
  return parseCommunityAnalyticsPayload(payload);
}

// The About timeline returns only the small visible moderator group (5 entries
// on the audited Community). This operation returns the full moderator and
// admin set — 37 records in one uncursored response on the same Community, 9 of
// which never appeared anywhere in a 46,960-member native roster walk. Every
// record carries an explicit X-assigned role, so it is the strongest membership
// evidence available and costs a single request.
export function parseCommunityModeratorsPayload(payload) {
  const slice = firstKey(payload, "moderators_slice").value;
  const items = Array.isArray(slice?.items_results) ? slice.items_results : [];
  const members = [];
  for (const item of items) {
    const user = unwrapUserResult(item?.result) || findUserResult(item);
    const username = user?.core?.screen_name || user?.legacy?.screen_name;
    if (!username) continue;
    members.push({
      username,
      name: user.core?.name || user.legacy?.name || username,
      user_id: user.rest_id || user.id_str || null,
      role: firstKey(item, "community_role").value || "Moderator",
      protected: typeof user.privacy?.protected === "boolean"
        ? user.privacy.protected
        : typeof user.legacy?.protected === "boolean"
          ? user.legacy.protected
          : null,
      roleConfidence: "high",
      source: "moderator-slice",
      membershipEvidence: "x-roster",
    });
  }
  const raw = typeof slice?.slice_info?.next_cursor === "string"
    ? slice.slice_info.next_cursor
    : null;
  // Same zero-prefixed terminal sentinel the member slice uses.
  const nextCursor = raw && raw.split("|", 1)[0] !== "0" ? raw : null;
  return { members, nextCursor, rawCount: items.length };
}

export async function fetchCommunityModerators(
  communityId,
  { signal, requestStats, log, limiter, operation, count = 100 } = {}
) {
  const moderatorOperation = operation || {
    documentId: DOCUMENT_IDS.moderatorsSliceTimeline_Query,
    operation: "moderatorsSliceTimeline_Query",
  };
  const members = [];
  const seen = new Set();
  let cursor = null;
  const seenCursors = new Set();
  // The audited Community returned every moderator in one page with no next
  // cursor, but the operation does accept one, so a larger moderator group is
  // followed rather than silently truncated.
  for (let page = 0; page < 20; page++) {
    const variables = { communityId, count };
    if (cursor) variables.cursor = cursor;
    const payload = await graphqlGet(
      moderatorOperation.documentId,
      moderatorOperation.operation,
      variables,
      moderatorOperation.features && Object.keys(moderatorOperation.features).length
        ? moderatorOperation.features
        : null,
      {
        signal,
        requestStats,
        log,
        limiter,
        maxAttempts: 3,
        clientTransactionId: moderatorOperation.clientTransactionId || null,
      }
    );
    const page = parseCommunityModeratorsPayload(payload);
    for (const member of page.members) {
      const key = member.username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(member);
    }
    if (!page.rawCount || !page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return members;
}

// Bumped to 3 in 5.10.1, when the collector could not read the native roster
// response and recorded "terminal, 0 members"; bumped to 4 in 5.12.1, when a
// broken seek-resume recorded "complete, 46,951 of 79,397". Both would be
// replayed on the next scan — a complete checkpoint for twelve hours — and so
// would hide the very fix that was just shipped. Changing the schema makes
// loadCursorCheckpoint discard those records outright.
const CURSOR_CHECKPOINT_SCHEMA = 4;
const COMPLETE_CHECKPOINT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PARTIAL_CHECKPOINT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function createMemberStore(seed = []) {
  const members = [];
  const byId = new Map();
  const byUsername = new Map();
  const upsert = (member) => {
    if (!member?.username) return false;
    const idKey = member.user_id ? String(member.user_id) : null;
    const usernameKey = member.username.toLowerCase();
    const index = (idKey && byId.get(idKey)) ?? byUsername.get(usernameKey);
    if (index == null) {
      const nextIndex = members.length;
      members.push(member);
      if (idKey) byId.set(idKey, nextIndex);
      byUsername.set(usernameKey, nextIndex);
      return true;
    }
    const previous = members[index];
    // Unlike mergeMemberLists (which merges distinct sources of differing
    // trust and deliberately keeps the higher-trust side), this store only
    // ever merges pages of the same roster source across time — a resumed
    // checkpoint can be hours old, so the incoming page should win for any
    // field (e.g. protected, name) that may have changed since. user_id and
    // a confirmed role are still sticky once known.
    const replacement = {
      ...previous,
      ...member,
      user_id: previous.user_id || member.user_id || null,
      role: previous.role !== "Member" ? previous.role : member.role,
    };
    members[index] = replacement;
    if (replacement.user_id) byId.set(String(replacement.user_id), index);
    byUsername.set(replacement.username.toLowerCase(), index);
    byUsername.set(usernameKey, index);
    return false;
  };
  for (const member of seed) upsert(member);
  return { members, upsert };
}

function firstKey(node, key) {
  if (!node || typeof node !== "object") return { found: false, value: undefined };
  if (Object.prototype.hasOwnProperty.call(node, key)) return { found: true, value: node[key] };
  for (const value of Object.values(node)) {
    const result = firstKey(value, key);
    if (result.found) return result;
  }
  return { found: false, value: undefined };
}

function findUserResult(node) {
  if (!node || typeof node !== "object") return null;
  if (node.core?.screen_name || node.legacy?.screen_name) return node;
  for (const value of Object.values(node)) {
    const result = findUserResult(value);
    if (result) return result;
  }
  return null;
}

// X marks timeline nodes with `entryType` on some surfaces and `__typename` on
// others. The native Android roster uses `__typename` only, so testing one
// field alone silently loses that route's cursor.
function isCursorNode(node) {
  return node.entryType === "TimelineTimelineCursor" ||
    node.__typename === "TimelineTimelineCursor";
}

function bottomTimelineCursor(node) {
  if (!node || typeof node !== "object") return null;
  if (
    isCursorNode(node) &&
    String(node.cursorType || "").toLowerCase() === "bottom" &&
    typeof node.value === "string"
  ) return node.value;
  for (const value of Object.values(node)) {
    const cursor = bottomTimelineCursor(value);
    if (cursor) return cursor;
  }
  return null;
}

// The native `CommunitiesMembersAllQuery` does not answer with the web slice's
// `items_results`/`next_cursor` shape at all. It returns a timeline whose
// entries carry `TimelineUser` items, so a parser written only for the web
// contract reads zero members and no cursor from a perfectly good 200 response
// — which is how the route appeared to "fail" and fall back on every scan.
export function parseCommunityMembersTimelinePayload(payload) {
  const members = [];
  const seen = new Set();
  let rawCount = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.__typename === "TimelineUser" || node.userResult) {
      rawCount++;
      const user = findUserResult(node.userResult?.result ?? node);
      const username = user?.core?.screen_name || user?.legacy?.screen_name;
      if (username && !seen.has(username.toLowerCase())) {
        seen.add(username.toLowerCase());
        members.push({
          username,
          name: user.core?.name || user.legacy?.name || username,
          user_id: user.rest_id || user.id_str || null,
          role: firstKey(node, "community_role").value || "Member",
          protected: typeof user.privacy?.protected === "boolean"
            ? user.privacy.protected
            : typeof user.legacy?.protected === "boolean"
              ? user.legacy.protected
              : null,
          roleConfidence: "medium",
          source: "cursor",
        });
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(payload);
  const raw = bottomTimelineCursor(payload);
  const nextCursor = raw && raw.split("|", 1)[0] !== "0" ? raw : null;
  return { members, nextCursor, rawCount };
}

export function parseCommunityMembersCursorPayload(payload) {
  const itemsResult = firstKey(payload, "items_results");
  // No `items_results` means this is not the web slice contract. Fall through
  // to the native timeline shape rather than reporting an empty roster.
  if (!Array.isArray(itemsResult.value)) {
    return parseCommunityMembersTimelinePayload(payload);
  }
  const items = itemsResult.value;
  const members = [];
  for (const item of items) {
    const user = findUserResult(item);
    const username = user?.core?.screen_name || user?.legacy?.screen_name;
    if (!username) continue;
    const roleResult = firstKey(item, "community_role");
    const protectedValue = typeof user.privacy?.protected === "boolean"
      ? user.privacy.protected
      : typeof user.legacy?.protected === "boolean"
        ? user.legacy.protected
        : null;
    members.push({
      username,
      name: user.core?.name || user.legacy?.name || username,
      user_id: user.rest_id || user.id_str || null,
      role: roleResult.value || "Member",
      protected: protectedValue,
      roleConfidence: "high",
      source: "cursor",
    });
  }
  const cursorResult = firstKey(payload, "next_cursor");
  const rawCursor = typeof cursorResult.value === "string"
    ? cursorResult.value
    : bottomTimelineCursor(payload);
  // X uses a leading zero segment as the roster's terminal cursor sentinel.
  // Treating it as another page only repeats the final request and obscures
  // the fact that the server deliberately ended pagination.
  const nextCursor = rawCursor && rawCursor.split("|", 1)[0] !== "0"
    ? rawCursor
    : null;
  return { members, nextCursor: nextCursor || null, rawCount: items.length };
}

export function parseCommunityMemberRelationshipPayload(payload, candidate) {
  const result = firstKey(payload, "member_relationship_typeahead");
  const relationships = Array.isArray(result.value) ? result.value : [];
  const candidateId = candidate?.user_id ? String(candidate.user_id) : null;
  const candidateUsername = String(candidate?.username || "").toLowerCase();
  for (const relationship of relationships) {
    const user = findUserResult(relationship);
    const username = user?.core?.screen_name || user?.legacy?.screen_name;
    const userId = user?.rest_id || user?.id_str || null;
    if (!username) continue;
    const exactMatch = candidateId
      ? String(userId || "") === candidateId
      : username.toLowerCase() === candidateUsername;
    if (!exactMatch) continue;
    // The July 2026 web contract places the relationship role directly on
    // each typeahead item. Older clients embedded it as community_role.
    const role =
      relationship?.role ||
      firstKey(relationship, "community_role").value ||
      "NonMember";
    if (String(role).toLowerCase() === "nonmember") return null;
    return {
      username,
      name: user.core?.name || user.legacy?.name || username,
      user_id: userId,
      role,
      protected: typeof user.privacy?.protected === "boolean"
        ? user.privacy.protected
        : typeof user.legacy?.protected === "boolean"
          ? user.legacy.protected
          : null,
      roleConfidence: "high",
      source: "relationship-verification",
      membershipEvidence: "x-roster",
    };
  }
  return null;
}

function checkpointMetaKey(communityId, scope = "web") {
  return scope === "web"
    ? `cursorRoster:${communityId}:meta`
    : `cursorRoster:${scope}:${communityId}:meta`;
}

function checkpointPageKey(communityId, generation, page, scope = "web") {
  return scope === "web"
    ? `cursorRoster:${communityId}:${generation}:page:${page}`
    : `cursorRoster:${scope}:${communityId}:${generation}:page:${page}`;
}

function packMember(member) {
  return [
    member.username,
    member.name || member.username,
    member.user_id || null,
    member.role || "Member",
    member.protected === true ? 1 : member.protected === false ? 0 : null,
  ];
}

function unpackMember(row) {
  return {
    username: row[0],
    name: row[1] || row[0],
    user_id: row[2] || null,
    role: row[3] || "Member",
    protected: row[4] === 1 ? true : row[4] === 0 ? false : null,
    roleConfidence: "high",
    source: "cursor-checkpoint",
  };
}

async function removeCheckpointPages(communityId, meta, scope = "web") {
  if (!meta?.generation || !meta?.pageCount) return;
  const keys = Array.from(
    { length: meta.pageCount },
    (_, index) => checkpointPageKey(communityId, meta.generation, index + 1, scope)
  );
  if (keys.length) await chrome.storage.local.remove(keys);
}

async function loadCursorCheckpoint(communityId, scope = "web") {
  const metaKey = checkpointMetaKey(communityId, scope);
  const stored = await chrome.storage.local.get(metaKey);
  const meta = stored[metaKey];
  if (!meta || meta.schema !== CURSOR_CHECKPOINT_SCHEMA) return null;
  const pageKeys = Array.from(
    { length: meta.pageCount || 0 },
    (_, index) => checkpointPageKey(communityId, meta.generation, index + 1, scope)
  );
  const pages = pageKeys.length ? await chrome.storage.local.get(pageKeys) : {};
  const store = createMemberStore();
  for (const key of pageKeys) {
    for (const row of pages[key]?.rows || []) {
      const member = unpackMember(row);
      store.upsert(member);
    }
  }
  return { meta, members: store.members };
}

async function startFreshCursorCheckpoint(communityId, previousMeta, scope = "web") {
  await removeCheckpointPages(communityId, previousMeta, scope);
  return {
    schema: CURSOR_CHECKPOINT_SCHEMA,
    communityId,
    generation: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    pageCount: 0,
    nextCursor: null,
    complete: false,
    terminal: false,
    reason: null,
    updatedAt: Date.now(),
  };
}

async function saveCursorPage(communityId, meta, cursorIn, nextCursor, members, scope = "web") {
  const page = meta.pageCount + 1;
  const pageKey = checkpointPageKey(communityId, meta.generation, page, scope);
  const nextMeta = {
    ...meta,
    pageCount: page,
    nextCursor,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({
    [pageKey]: {
      cursorIn,
      nextCursor,
      rows: members.map(packMember),
    },
    [checkpointMetaKey(communityId, scope)]: nextMeta,
  });
  return nextMeta;
}

// X's roster cursor is an unsigned base64 Thrift struct. Byte 30 begins a
// big-endian int64 holding the join-time position the next page reads from, and
// the server validates nothing else about it: rewriting those eight bytes seeks
// anywhere in the roster and returns a fresh, valid continuation cursor.
//
// This matters because a single cursor chain is capped at 500 pages. On a
// 79,397-member Community that cap stops the walk at 46,960 with the final page
// still returning a full 100 records — the roster is not exhausted, the chain
// is. Re-seeking from the last observed position starts a new chain and
// continues. A measured run reached 76,273 members (96.07%); a 24-point sweep
// across the whole join-time range then returned zero further members, so the
// remaining ~3,100 are counted by X but never served, and are almost certainly
// deactivated or suspended accounts.
//
// The offset is a property of X's current cursor layout and can change without
// notice, so every helper here fails closed and callers must treat a null as
// "seek unavailable" rather than an error.
const ROSTER_CURSOR_TIMESTAMP_OFFSET = 30;
// Byte 71 is the chain's page counter. Reading eight consecutive pages on
// 2026-07-30 returned 2, 3, 4, 5, 6, 7, 8, 9 there while every other byte moved
// unpredictably. It is what the 500-page cap counts, so a cursor taken from
// deep in a spent chain resumes with an exhausted budget: rewriting only its
// timestamp yields a single page and no continuation, which is precisely how a
// resumed walk stalled at 46,951 of 79,397. Seeking resets it.
const ROSTER_CURSOR_PAGE_COUNTER_OFFSET = 71;
const ROSTER_CURSOR_PAGE_COUNTER_START = 2;
const ROSTER_CURSOR_MIN_BYTES = ROSTER_CURSOR_PAGE_COUNTER_OFFSET + 1;
// Re-seeking lands slightly behind the last position so a member sitting exactly
// on the boundary is not stepped over. The overlap costs a fraction of a page.
const SEEK_RESUME_OVERLAP_MS = 2000;
const SEEK_RESUME_MAX_SEGMENTS = 240;
// A resumed segment opens inside the overlap window above, so its first pages
// legitimately return members already held. Judging a segment before it clears
// that window ends the walk at the very cap seek-resume exists to defeat.
const SEEK_RESUME_MIN_SEGMENT_PAGES = 5;
// Only consecutive fully-tried segments that find nobody mean the roster is
// genuinely saturated. A dead zone is crossed by doubling the skip below, so
// this many idle segments spans months, not hours.
const SEEK_RESUME_MAX_IDLE_SEGMENTS = 9;
// When a chain stalls, the next seek steps just past the position it stalled
// on. One millisecond is deliberate: the stall means members share that exact
// timestamp, and the only ones a timestamp seek cannot reach are the remainder
// of that millisecond. Skipping by a coarse interval instead steps over members
// that were never collected — a modelled roster lost 21,540 of them to a single
// six-hour skip and finished at 66.57%, where a one-millisecond step finishes
// at 100%.
const SEEK_RESUME_FORWARD_STEP_MS = 1;
// A duplicate-only run is the expected cost of re-entering collected ground on
// the way to ground that is not collected yet, so during a seek-resume walk it
// must not end the chain: crossing a re-walked region took about 350 pages in a
// modelled roster, and the plain three-page limit stops the walk partway across
// and strands everyone beyond it.
//
// The bound is deliberate rather than infinite. X caps one chain at 500 pages,
// so a chain can never contain more than 500 idle pages; anything above that is
// provably enough to cross any re-walked region, while still stopping a
// pathological chain that keeps serving duplicates from spending the whole
// 10,000-page budget on the signed-in account.
export const SEEK_RESUME_IDLE_PAGE_LIMIT = 600;

export function seekResumeForwardStep() {
  return SEEK_RESUME_FORWARD_STEP_MS;
}

// A chain can stall three ways and all three mean the chain ended, not the
// roster: X withholds the next cursor at its page cap, the walk re-enters
// ground it already holds and stops adding, or the cursor repeats. Treating
// only the first as resumable is what left a seek-resume run stranded far below
// the advertised count, because the first duplicate-heavy stretch after a
// re-seek ended the whole walk.
export function shouldResumeChain({
  seekResume = false,
  cursorEnded = false,
  reason = null,
  memberCount = 0,
  expectedCount = null,
  lastTimestamp = null,
} = {}) {
  if (!seekResume || lastTimestamp == null) return false;
  const stalled = cursorEnded ||
    reason === "no-new-members" ||
    reason === "repeated-cursor";
  if (!stalled) return false;
  // An unknown total is a reason to keep going, not to stop: requiring one let
  // a failed analytics call (50 requests per window) disable seek-resume.
  return !expectedCount || memberCount < expectedCount;
}

function decodeCursorBytes(cursor) {
  if (typeof cursor !== "string" || !cursor) return null;
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    if (binary.length < ROSTER_CURSOR_MIN_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function readRosterCursorTimestamp(cursor) {
  const bytes = decodeCursorBytes(cursor);
  if (!bytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = Number(view.getBigInt64(ROSTER_CURSOR_TIMESTAMP_OFFSET));
  // Only accept something that reads as a plausible millisecond timestamp, so a
  // layout change degrades to "no seek" instead of producing a junk cursor.
  if (!Number.isFinite(value) || value < 1.3e12 || value > 2.0e12) return null;
  return value;
}

// Seeking starts a new chain, so the page counter is reset alongside the
// position. Without this a seek inherits the spent budget of the chain its
// cursor came from and dies after one page.
export function withRosterCursorTimestamp(cursor, timestampMs) {
  const bytes = decodeCursorBytes(cursor);
  if (!bytes || !Number.isFinite(timestampMs)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setBigInt64(ROSTER_CURSOR_TIMESTAMP_OFFSET, BigInt(Math.floor(timestampMs)));
  bytes[ROSTER_CURSOR_PAGE_COUNTER_OFFSET] = ROSTER_CURSOR_PAGE_COUNTER_START;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// A page that adds nothing is not on its own proof that the roster ended: X
// serves overlapping pages, and the measured native walk averaged about 91
// unique records per 100-record page. Only a run of consecutive duplicate-only
// pages, a repeated cursor, or the absence of a next cursor ends collection.
export function resolveRosterStopReason({
  idlePages = 0,
  idleLimit = MAX_IDLE_ROSTER_PAGES,
  repeatedCursor = false,
  cursorEnded = false,
  memberCount = 0,
  expectedCount = null,
} = {}) {
  if (idlePages >= idleLimit) return "no-new-members";
  if (repeatedCursor) return "repeated-cursor";
  if (expectedCount && memberCount >= expectedCount) return "expected-count-reached";
  if (cursorEnded) {
    return expectedCount && memberCount < expectedCount
      ? "cursor-ended-before-count"
      : "cursor-ended";
  }
  return null;
}

export function buildMemberCursorRequest(operation, communityId, cursor = null) {
  const liveVariables = operation?.variables && typeof operation.variables === "object"
    ? operation.variables
    : {};
  const liveFeatures = operation?.features && typeof operation.features === "object"
    ? operation.features
    : {};
  const communityVariable = operation?.communityVariable || "communityId";
  const cursorVariable = operation?.cursorVariable || "cursor";
  const variables = { ...liveVariables, [communityVariable]: communityId };
  if (communityVariable !== "communityId") delete variables.communityId;
  if (communityVariable !== "community_rest_id") delete variables.community_rest_id;
  delete variables.count;
  delete variables[cursorVariable];
  if (Object.prototype.hasOwnProperty.call(liveVariables, "count")) {
    variables.count = liveVariables.count;
  }
  if (cursor) variables[cursorVariable] = cursor;
  return {
    variables,
    features: Object.keys(liveFeatures).length ? liveFeatures : null,
  };
}

export async function fetchCommunityMembersByCursor(
  communityId,
  operation,
  {
    signal,
    requestStats,
    log,
    onProgress,
    expectedCount,
    maxPages = 10000,
    checkpointScope = "web",
    seekResume = false,
  } = {}
) {
  if (!operation?.documentId || !operation?.operation) {
    throw new Error("The live Community member cursor operation was not detected.");
  }

  let checkpoint = await loadCursorCheckpoint(communityId, checkpointScope);
  const checkpointAge = checkpoint?.meta?.updatedAt ? Date.now() - checkpoint.meta.updatedAt : Infinity;
  const expectedCountMatches = checkpoint?.meta?.expectedCount == null ||
    expectedCount == null ||
    checkpoint.meta.expectedCount === expectedCount;
  // A cached result holding no members is never worth replaying: it can only
  // have come from a source that failed to yield anything, and reusing it turns
  // one bad run into hours of empty ones.
  const checkpointHasMembers = (checkpoint?.members?.length || 0) > 0;
  const completeCheckpoint = checkpoint?.meta?.complete &&
    checkpointHasMembers &&
    checkpointAge <= COMPLETE_CHECKPOINT_MAX_AGE_MS &&
    expectedCountMatches;
  const partialTerminalCheckpoint = checkpoint?.meta?.terminal &&
    !checkpoint.meta.complete &&
    checkpointHasMembers &&
    checkpointAge <= PARTIAL_CHECKPOINT_MAX_AGE_MS &&
    expectedCountMatches;
  const canResume = Boolean(
    checkpoint &&
    !checkpoint.meta.terminal &&
    !checkpoint.meta.complete &&
    checkpoint.meta.nextCursor
  );

  if (completeCheckpoint) {
    log?.(`Loaded a complete ${checkpoint.members.length.toLocaleString()}-member cursor checkpoint.`);
    return {
      members: checkpoint.members,
      complete: true,
      resumed: true,
      pages: checkpoint.meta.pageCount,
      reason: "checkpoint-complete",
    };
  }
  if (partialTerminalCheckpoint) {
    log?.(
      `Loaded a recent partial ${checkpoint.members.length.toLocaleString()}-member checkpoint ` +
      `(${checkpoint.meta.reason}); skipping a duplicate crawl.`
    );
    return {
      members: checkpoint.members,
      complete: false,
      resumed: true,
      pages: checkpoint.meta.pageCount,
      reason: checkpoint.meta.reason || "checkpoint-partial",
      cached: true,
    };
  }

  let meta;
  let seededMembers;
  if (canResume) {
    meta = checkpoint.meta;
    seededMembers = checkpoint.members;
    log?.(`Resuming cursor page ${meta.pageCount + 1} with ${seededMembers.length.toLocaleString()} saved member(s).`);
  } else {
    meta = await startFreshCursorCheckpoint(communityId, checkpoint?.meta, checkpointScope);
    seededMembers = [];
    await chrome.storage.local.set({ [checkpointMetaKey(communityId, checkpointScope)]: meta });
  }

  const store = createMemberStore(seededMembers);
  const seenCursors = new Set();
  let cursor = meta.nextCursor || null;
  if (cursor) seenCursors.add(cursor);
  let reason = null;
  let terminalError = null;
  let idlePages = 0;
  // Seek-resume bookkeeping. `segmentAdded` is the guard that a naive
  // implementation lacks: once a chain ends, re-seeking into a region that is
  // already fully collected returns the same members forever, so a segment that
  // contributes nothing new ends the walk instead of looping.
  let lastCursorTimestamp = null;
  let segments = 0;
  let reseeks = 0;
  let segmentAdded = 0;
  let segmentPages = 0;
  let unproductiveSegments = 0;
  // Every resume must land strictly ahead of the previous one, so a segment
  // that ends too early to be judged cannot pin the walk in place.
  let lastSeekTarget = null;
  // The opening cursor doubles as the seek template: it carries an unspent page
  // budget, which a cursor from deep in a capped chain does not.
  let seekTemplateCursor = cursor && readRosterCursorTimestamp(cursor) != null ? cursor : null;
  // X's web roster is fixed at about 20 records per response. A shorter
  // adaptive interval improves throughput while the shared limiter still
  // backs off on low quota, throttling, network failures, and 5xx responses.
  const limiter = new AdaptiveRateLimiter(ROSTER_REQUEST_DELAY_MS);
  let requestOperation = operation;
  let nativePageSizeDowngraded = false;

  while (meta.pageCount < maxPages) {
    if (signal?.aborted) throw new StoppedError();
    let payload;
    try {
      const request = buildMemberCursorRequest(requestOperation, communityId, cursor);
      payload = await graphqlGet(
        requestOperation.documentId,
        requestOperation.operation,
        request.variables,
        request.features,
        {
          signal,
          requestStats,
          log,
          limiter,
          maxAttempts: 6,
          clientTransactionId: requestOperation.clientTransactionId || null,
        }
      );
    } catch (error) {
      if (error instanceof StoppedError || error?.name === "StoppedError") throw error;
      const requestedCount = Number(requestOperation?.variables?.count);
      if (
        store.members.length === 0 &&
        !nativePageSizeDowngraded &&
        Number.isFinite(requestedCount) &&
        requestedCount > NATIVE_ROSTER_FALLBACK_COUNT
      ) {
        nativePageSizeDowngraded = true;
        requestOperation = {
          ...requestOperation,
          variables: {
            ...requestOperation.variables,
            count: NATIVE_ROSTER_FALLBACK_COUNT,
          },
        };
        log?.(
          `X rejected the ${requestedCount}-member native page; retrying with ` +
          `${NATIVE_ROSTER_FALLBACK_COUNT}.`
        );
        continue;
      }
      if (store.members.length === 0) throw error;
      terminalError = error;
      reason = error?.code === "rate-limited" ? "rate-limited" : "request-error";
      break;
    }
    const page = parseCommunityMembersCursorPayload(payload);
    const before = store.members.length;
    for (const member of page.members) {
      store.upsert(member);
    }
    const added = store.members.length - before;
    idlePages = added === 0 ? idlePages + 1 : 0;
    segmentAdded += added;
    segmentPages++;
    const idleLimit = seekResume ? SEEK_RESUME_IDLE_PAGE_LIMIT : MAX_IDLE_ROSTER_PAGES;
    if (page.nextCursor) {
      const timestamp = readRosterCursorTimestamp(page.nextCursor);
      if (timestamp != null) lastCursorTimestamp = timestamp;
      if (!seekTemplateCursor) seekTemplateCursor = page.nextCursor;
    }
    reason = resolveRosterStopReason({
      idlePages,
      idleLimit,
      repeatedCursor: Boolean(
        page.nextCursor && (page.nextCursor === cursor || seenCursors.has(page.nextCursor))
      ),
      cursorEnded: !page.nextCursor,
      memberCount: store.members.length,
      expectedCount,
    });

    meta = await saveCursorPage(
      communityId,
      meta,
      cursor,
      page.nextCursor,
      page.members,
      checkpointScope
    );
    onProgress?.({
      page: meta.pageCount,
      count: store.members.length,
      added,
      nextCursor: page.nextCursor,
      segments: segments + 1,
    });

    // X caps a single cursor chain well before a large roster is exhausted. If
    // the chain ended rather than the roster, re-seek from the last position
    // and keep going; the guards below stop a walk that is no longer finding
    // anyone, which is what separates this from an endless re-seek loop.
    if (shouldResumeChain({
      seekResume,
      cursorEnded: !page.nextCursor,
      reason,
      memberCount: store.members.length,
      expectedCount,
      lastTimestamp: lastCursorTimestamp,
    })) {
      // A segment is only judged once it has had a fair run. The first pages
      // after a re-seek land inside the deliberate overlap window and return
      // members already held, so ruling on one page ends the walk at the very
      // cap it exists to defeat.
      const segmentWasFairlyTried = segmentPages >= SEEK_RESUME_MIN_SEGMENT_PAGES;
      // A page that served no records at all means the seek landed past the end
      // of the roster. That is a complete verdict on the segment however short
      // it was, and it must count: without it the segment was never judged
      // unproductive, the counter never advanced, and each resume stepped a
      // single millisecond — burning the entire 240-segment budget crawling
      // past the end of the roster instead of stopping.
      const servedNothing = page.rawCount === 0;
      // Stalling on duplicates means the walk is standing in ground it already
      // holds, whatever the segment produced earlier, so seeking back from
      // there would re-enter the same region.
      const deadZone = reason === "no-new-members" ||
        servedNothing ||
        (segmentAdded === 0 && segmentWasFairlyTried);
      if (deadZone) {
        unproductiveSegments++;
      } else if (segmentAdded > 0) {
        unproductiveSegments = 0;
      }
      if (unproductiveSegments >= SEEK_RESUME_MAX_IDLE_SEGMENTS) {
        reason = "seek-resume-exhausted";
      } else if (reseeks >= SEEK_RESUME_MAX_SEGMENTS) {
        reason = "seek-resume-segment-limit";
      } else {
        // Seek from the first cursor of the walk rather than the exhausted
        // one. A late-chain cursor carries that chain's spent page budget, so
        // rewriting its position yields a single page and no continuation; the
        // opening cursor reseeks with a fresh budget.
        const template = seekTemplateCursor || cursor || page.nextCursor;
        // An unproductive segment means this position is already collected, so
        // step forward past it instead of retrying the same dead zone.
        let target = deadZone
          ? lastCursorTimestamp + SEEK_RESUME_FORWARD_STEP_MS
          : lastCursorTimestamp - SEEK_RESUME_OVERLAP_MS;
        // Seek positions must advance. A segment that ends before it can be
        // judged fairly tried leaves the idle counter untouched, so without
        // this every resume computed the same target, re-walked the same
        // ground, and burned the segment budget without progressing — a
        // modelled roster whose page cap fell inside a large block of members
        // sharing one timestamp thrashed through 240 resumes and stalled at
        // 66.57%. Forcing strictly forward movement turns that into progress.
        if (lastSeekTarget != null && target <= lastSeekTarget) {
          target = lastSeekTarget + SEEK_RESUME_FORWARD_STEP_MS;
        }
        const resumed = withRosterCursorTimestamp(template, target);
        if (resumed && !seenCursors.has(resumed)) {
          reseeks++;
          segments++;
          segmentAdded = 0;
          segmentPages = 0;
          idlePages = 0;
          reason = null;
          cursor = resumed;
          lastCursorTimestamp = target;
          lastSeekTarget = target;
          seenCursors.add(resumed);
          log?.(
            `Roster chain ended at X's page cap; resuming from ` +
            `${new Date(lastCursorTimestamp).toISOString().slice(0, 10)} ` +
            `(segment ${segments + 1}, ${store.members.length.toLocaleString()} member(s) so far).`
          );
          continue;
        }
      }
    }

    if (reason) break;
    cursor = page.nextCursor;
    seenCursors.add(cursor);
  }

  if (!reason && meta.pageCount >= maxPages) reason = "page-safety-limit";
  // `seek-resume-exhausted` means X stopped returning anyone new, which is not
  // the same as reaching the advertised count. Treating it as complete once
  // labelled a 46,951-of-79,397 result as finished. A result below the
  // advertised count stays partial and carries its own stop reason, in keeping
  // with never claiming completeness the roster does not support.
  const complete = reason === "expected-count-reached" || reason === "cursor-ended";
  const terminal = !complete && !["request-error", "page-safety-limit"].includes(reason);
  meta = {
    ...meta,
    complete,
    terminal,
    reason,
    operation: requestOperation.operation,
    documentId: requestOperation.documentId,
    memberCount: store.members.length,
    expectedCount: expectedCount || null,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [checkpointMetaKey(communityId, checkpointScope)]: meta });
  log?.(
    `Cursor collection stopped (${reason || "unknown"}) after ${meta.pageCount.toLocaleString()} page(s): ` +
    `${store.members.length.toLocaleString()} unique member(s).`
  );
  return {
    members: store.members,
    complete,
    resumed: Boolean(canResume),
    pages: meta.pageCount,
    reason,
    error: terminalError,
    segments: segments + 1,
    reseeks,
  };
}

const MEMBERSHIP_VERIFICATION_SCHEMA = 2;
const MEMBERSHIP_VERIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function verificationKey(communityId) {
  return `membershipVerification:${communityId}`;
}

function candidateIdentity(candidate) {
  return candidate?.user_id
    ? `id:${String(candidate.user_id)}`
    : `username:${String(candidate?.username || "").toLowerCase()}`;
}

export async function verifyKnownCommunityMembers(
  communityId,
  candidates,
  {
    signal,
    requestStats,
    log,
    onProgress,
    maxCandidatesPerRun = 350,
  } = {}
) {
  const key = verificationKey(communityId);
  const stored = (await chrome.storage.local.get(key))[key];
  const entries = [1, MEMBERSHIP_VERIFICATION_SCHEMA].includes(stored?.schema) &&
    stored.entries &&
    typeof stored.entries === "object"
    ? { ...stored.entries }
    : {};
  const now = Date.now();
  const pending = new Map();
  if (stored?.schema === MEMBERSHIP_VERIFICATION_SCHEMA && Array.isArray(stored.pending)) {
    for (const row of stored.pending) {
      const candidate = unpackMember(row);
      if (candidate?.username) pending.set(candidateIdentity(candidate), candidate);
    }
  }
  for (const candidate of candidates || []) {
    if (!candidate?.username) continue;
    const identity = candidateIdentity(candidate);
    if (!identity) continue;
    const previous = entries[identity];
    if (previous?.checkedAt && now - previous.checkedAt <= MEMBERSHIP_VERIFICATION_MAX_AGE_MS) {
      pending.delete(identity);
      continue;
    }
    pending.set(identity, candidate);
  }
  const queue = [...pending.values()];

  const limiter = new AdaptiveRateLimiter(1250);
  let checked = 0;
  let stoppedReason = queue.length ? "run-limit" : "up-to-date";
  let terminalError = null;
  for (const candidate of queue.slice(0, maxCandidatesPerRun)) {
    if (signal?.aborted) throw new StoppedError();
    const identity = candidateIdentity(candidate);
    try {
      const payload = await graphqlGet(
        MEMBER_RELATIONSHIP_OPERATION.documentId,
        MEMBER_RELATIONSHIP_OPERATION.operation,
        {
          communityId,
          prefix: candidate.username,
        },
        null,
        {
          signal,
          requestStats,
          log,
          limiter,
          maxAttempts: 3,
        }
      );
      const member = parseCommunityMemberRelationshipPayload(payload, candidate);
      entries[identity] = {
        checkedAt: Date.now(),
        member: member ? packMember(member) : null,
      };
      pending.delete(identity);
      checked++;
      if (checked % 10 === 0) {
        await chrome.storage.local.set({
          [key]: {
            schema: MEMBERSHIP_VERIFICATION_SCHEMA,
            updatedAt: Date.now(),
            entries,
            pending: [...pending.values()].map(packMember),
          },
        });
      }
      onProgress?.({
        checked,
        queued: queue.length,
        confirmed: Object.values(entries).filter((entry) => Array.isArray(entry?.member)).length,
      });
    } catch (error) {
      if (error instanceof StoppedError || error?.name === "StoppedError") throw error;
      terminalError = error;
      stoppedReason = error?.code === "rate-limited" ? "rate-limited" : "request-error";
      break;
    }
  }

  if (!terminalError && checked >= queue.length) stoppedReason = "queue-complete";
  await chrome.storage.local.set({
    [key]: {
      schema: MEMBERSHIP_VERIFICATION_SCHEMA,
      updatedAt: Date.now(),
      entries,
      pending: [...pending.values()].map(packMember),
    },
  });
  const members = Object.values(entries)
    .filter(
      (entry) =>
        Array.isArray(entry?.member) &&
        entry.checkedAt &&
        now - entry.checkedAt <= MEMBERSHIP_VERIFICATION_MAX_AGE_MS
    )
    .map((entry) => ({
      ...unpackMember(entry.member),
      source: "relationship-verification",
      membershipEvidence: "x-roster",
    }));
  return {
    members,
    checked,
    queued: queue.length,
    remaining: pending.size,
    reason: stoppedReason,
    error: terminalError,
  };
}

const ACTIVITY_SEARCH_VERIFICATION_SCHEMA = 1;
// Not tied to a lookback window: a search answers "when did this account last
// post here", which stays true regardless of which rolling window is selected
// today. The cache only needs to be fresh enough that a very recent post could
// not have been missed.
const ACTIVITY_SEARCH_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function activitySearchVerificationKey(communityId) {
  return `activitySearchVerification:${communityId}`;
}

// Exported so callers building the flagged list (and filtering it after
// verification) use the exact same identity rule as the cache keys below;
// two independent copies of this logic drifting apart would silently break
// the match between a flagged member and its verification result.
export function activitySearchCandidateIdentity(candidate) {
  return candidate?.user_id
    ? `id:${String(candidate.user_id)}`
    : `username:${String(candidate?.username || "").toLowerCase()}`;
}

// Matches the live contract captured from x.com's own Community search UI on
// 2026-07-31: `query` is exactly `(from:<username>)` — parentheses included —
// with `timelineRankingMode: "Recency"` so the newest post sorts first.
export function buildActivitySearchVariables(communityId, username) {
  return {
    count: 20,
    query: `(from:${username})`,
    communityId,
    timelineRankingMode: "Recency",
    includePromotedContent: false,
    timelineId: `communityTweetSearch-${communityId}-from-${username}-Recency`,
    withBirdwatchNotes: false,
    withDmMuting: false,
    withClientEventToken: false,
    withVoice: false,
    isListMemberTargetUserId: "0",
    withCommunity: false,
    withQuickPromoteEligibilityTweetFields: false,
    withGrokTranslatedBio: false,
    includeProfessionalCategory: true,
  };
}

// A repost can appear in a Community feed without the account having authored
// anything there, so it must not count as a post when deciding whether the
// member has been active.
export function latestCommunityPostAt(tweets) {
  let latest = null;
  for (const tweet of tweets || []) {
    if (communityActivityKind(tweet) === "repost") continue;
    const createdAt = tweet?.legacy?.created_at ? new Date(tweet.legacy.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    if (!latest || createdAt > latest) latest = createdAt;
  }
  return latest;
}

// The broad Community timeline/media/search-shard crawl that supplies
// `activityDetailsForMember` can miss a member's post: it never covers the full
// history, and the generic word-shard search only catches posts containing one
// of a handful of common words. A member with genuine activity the crawl did
// not happen to see is then flagged inactive incorrectly.
//
// `CommunityTweetSearchModuleQuery` — the same operation and document ID the
// word-shard backfill already uses — accepts an X search operator directly:
// `(from:<username>)` scoped to `communityId` returns exactly that member's
// posts in this Community, ranked by recency. One request per member settles
// the question with certainty instead of inference, so this is meant to run
// only against members a scan has already flagged, not the full roster: the
// full roster is tens of thousands of accounts, and it is not a request budget
// this can spend on everyone.
export async function verifyMemberActivityViaSearch(
  communityId,
  candidates,
  {
    signal,
    requestStats,
    log,
    onProgress,
    operation,
    sinceDate,
    // Verified directly against x.com's own rate-limit response headers:
    // CommunityTweetSearchModuleQuery gets its own 500-per-15-minute bucket,
    // separate from every other operation this scan uses. The word-shard
    // author-discovery backfill draws from that same bucket earlier in the
    // same scan (up to 6 shards x 8 pages = 48 requests), so 400 here leaves
    // roughly the same safety margin under 500 as the previous 300 did before
    // that fact was confirmed, while checking noticeably more of a large
    // flagged backlog per run.
    maxCandidatesPerRun = 400,
  } = {}
) {
  const searchOperation = operation || {
    documentId: DOCUMENT_IDS.CommunityTweetSearchModuleQuery,
    operation: "CommunityTweetSearchModuleQuery",
  };
  const key = activitySearchVerificationKey(communityId);
  const stored = (await chrome.storage.local.get(key))[key];
  const entries = stored?.schema === ACTIVITY_SEARCH_VERIFICATION_SCHEMA &&
    stored.entries && typeof stored.entries === "object"
    ? { ...stored.entries }
    : {};
  const now = Date.now();

  const seenIdentities = new Set();
  const pendingCandidates = [];
  for (const candidate of candidates || []) {
    if (!candidate?.username) continue;
    const identity = activitySearchCandidateIdentity(candidate);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    const previous = entries[identity];
    if (previous?.checkedAt && now - previous.checkedAt <= ACTIVITY_SEARCH_VERIFICATION_MAX_AGE_MS) {
      continue;
    }
    pendingCandidates.push({ identity, candidate });
  }

  const limiter = new AdaptiveRateLimiter(1250);
  const searchFeatures = searchOperation.features && Object.keys(searchOperation.features).length
    ? searchOperation.features
    : TIMELINE_FEATURES;
  let checked = 0;
  let stoppedReason = pendingCandidates.length ? "run-limit" : "up-to-date";
  let terminalError = null;

  for (const { identity, candidate } of pendingCandidates.slice(0, maxCandidatesPerRun)) {
    if (signal?.aborted) throw new StoppedError();
    try {
      const payload = await graphqlGet(
        searchOperation.documentId,
        searchOperation.operation,
        buildActivitySearchVariables(communityId, candidate.username),
        searchFeatures,
        {
          signal,
          requestStats,
          log,
          limiter,
          maxAttempts: 3,
          clientTransactionId: searchOperation.clientTransactionId || null,
        }
      );
      const page = parseCommunityTimelinePage(payload, "search");
      const lastPostAt = latestCommunityPostAt(page.tweets);
      entries[identity] = {
        checkedAt: Date.now(),
        lastPostAt: lastPostAt ? lastPostAt.toISOString() : null,
      };
      checked++;
      if (checked % 10 === 0) {
        await chrome.storage.local.set({
          [key]: { schema: ACTIVITY_SEARCH_VERIFICATION_SCHEMA, updatedAt: Date.now(), entries },
        });
      }
      onProgress?.({ checked, queued: pendingCandidates.length });
    } catch (error) {
      if (error instanceof StoppedError || error?.name === "StoppedError") throw error;
      terminalError = error;
      stoppedReason = error?.code === "rate-limited" ? "rate-limited" : "request-error";
      break;
    }
  }

  if (!terminalError && checked >= pendingCandidates.length) stoppedReason = "queue-complete";
  await chrome.storage.local.set({
    [key]: { schema: ACTIVITY_SEARCH_VERIFICATION_SCHEMA, updatedAt: Date.now(), entries },
  });

  const results = new Map();
  for (const candidate of candidates || []) {
    if (!candidate?.username) continue;
    const identity = activitySearchCandidateIdentity(candidate);
    if (results.has(identity)) continue;
    const entry = entries[identity];
    if (!entry) continue;
    const lastPostAt = entry.lastPostAt ? new Date(entry.lastPostAt) : null;
    results.set(identity, {
      username: candidate.username,
      lastPostAt: entry.lastPostAt || null,
      hasActivityInWindow: Boolean(lastPostAt && sinceDate && lastPostAt >= sinceDate),
      checkedAt: entry.checkedAt,
    });
  }

  return {
    results,
    checked,
    queued: pendingCandidates.length,
    remaining: Math.max(0, pendingCandidates.length - checked),
    reason: stoppedReason,
    error: terminalError,
  };
}

export async function fetchActiveAuthors(
  communityId,
  sinceDate,
  untilDate,
  {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation,
    observationSinceDate = sinceDate,
    maxPagesPerRun = 250,
  } = {}
) {
  const checkpointKey =
    `activityScan:${communityId}:${sinceDate.toISOString().slice(0, 10)}:` +
    `${observationSinceDate.toISOString().slice(0, 10)}:${untilDate.toISOString().slice(0, 10)}`;
  const stored = (await chrome.storage.local.get(checkpointKey))[checkpointKey];
  const checkpointAge = stored?.updatedAt ? Date.now() - stored.updatedAt : Infinity;
  const canResume =
    stored?.schema === ACTIVITY_CHECKPOINT_SCHEMA &&
    !stored.complete &&
    stored.cursor &&
    checkpointAge < 12 * 60 * 60 * 1000;
  const canReuseComplete =
    stored?.schema === ACTIVITY_CHECKPOINT_SCHEMA &&
    stored.complete &&
    checkpointAge < 10 * 60 * 1000;
  const active = createActivityIndex(canResume || canReuseComplete ? stored.authors : []);
  const observed = createActivityIndex(
    canResume || canReuseComplete ? stored.observedAuthors : []
  );
  const seenTweetIds = new Set(
    canResume || canReuseComplete ? stored.seenTweetIds || [] : []
  );
  const finalizeActivity = (windowComplete, backfillComplete, pages) => {
    active.observedAuthors = observed.toJSON();
    active.activityWindowComplete = windowComplete;
    active.observationComplete = backfillComplete;
    active.observationPages = pages;
    active.continuationCursor = stored?.cursor || null;
    return active;
  };
  if (canReuseComplete) {
    log?.(
      `Loaded a recent activity checkpoint with ${active.size.toLocaleString()} active and ` +
      `${observed.size.toLocaleString()} observed author(s).`
    );
    return finalizeActivity(true, true, stored.pages || 0);
  }
  let cursor = null;
  let scanned = 0;
  let pages = 0;
  let activityWindowComplete = false;
  let observationComplete = false;
  let continuationCursor = null;
  if (canResume) {
    cursor = stored.cursor;
    scanned = stored.scanned || 0;
    pages = stored.pages || 0;
    activityWindowComplete = stored.activityWindowComplete === true;
    log?.(
      `Resuming author backfill with ${active.size.toLocaleString()} active and ` +
      `${observed.size.toLocaleString()} observed author(s).`
    );
  }

  let pagesThisRun = 0;
  const timelineDocumentId = operation?.documentId || DOCUMENT_IDS.CommunityTweetsTimeline;
  const timelineOperation = operation?.operation || "CommunityTweetsTimeline";
  const timelineVariables = operation?.variables && typeof operation.variables === "object"
    ? operation.variables
    : {};
  const timelineFeatures = operation?.features && Object.keys(operation.features).length
    ? operation.features
    : TIMELINE_FEATURES;
  while (pagesThisRun < maxPagesPerRun) {
    if (signal?.aborted) throw new StoppedError();
    const payload = await graphqlGet(
      timelineDocumentId,
      timelineOperation,
      {
        ...timelineVariables,
        communityId,
        count: 20,
        cursor,
        displayLocation: "Community",
        rankingMode: "Recency",
        withCommunity: true,
      },
      timelineFeatures,
      {
        signal,
        requestStats,
        log,
        limiter,
        clientTransactionId: operation?.clientTransactionId || null,
      }
    );
    const page = parseCommunityTimelinePage(payload);
    pages++;
    pagesThisRun++;
    let pageHasObservedPost = false;
    let pageHasInWindowEntry = false;
    let pageHasOlderPost = false;
    let pageHasPreWindowPost = false;

    for (const tweet of page.tweets) {
      const author = unwrapUserResult(tweet?.core?.user_results?.result);
      const username = author?.core?.screen_name;
      const createdAt = tweet?.legacy?.created_at ? new Date(tweet.legacy.created_at) : null;
      if (!username || !createdAt || Number.isNaN(createdAt.getTime())) continue;
      if (createdAt < sinceDate) pageHasPreWindowPost = true;
      if (createdAt < observationSinceDate) {
        pageHasOlderPost = true;
        continue;
      }
      if (createdAt > untilDate) continue;

      pageHasInWindowEntry = true;
      // Timeline pages can overlap. Count each Community post/reply once even
      // when X repeats it on the following cursor page or a scan resumes.
      const tweetId = String(tweet.rest_id || tweet.legacy?.id_str || "");
      if (tweetId && seenTweetIds.has(tweetId)) continue;
      if (tweetId) seenTweetIds.add(tweetId);
      const activityKind = communityActivityKind(tweet);
      // A repost can be visible in a Community feed, but it is neither an
      // original Community post nor a reply authored there.
      if (activityKind === "repost") continue;
      const isReply = activityKind === "reply";
      pageHasObservedPost = true;
      scanned++;
      const authorRecord = {
        username,
        count: 1,
        posts: isReply ? 0 : 1,
        replies: isReply ? 1 : 0,
        user_id: author.rest_id || null,
        name: author.core?.name || username,
        protected: typeof author.privacy?.protected === "boolean"
          ? author.privacy.protected
          : typeof author.legacy?.protected === "boolean"
            ? author.legacy.protected
            : null,
        lastSeenCommunityPost: createdAt.toISOString(),
      };
      observed.add(authorRecord);
      if (createdAt >= sinceDate) active.add(authorRecord);
    }

    activityWindowComplete =
      activityWindowComplete ||
      // One old/pinned entry can be mixed into an otherwise recent page.
      // Require a page with no qualifying in-window activity before treating
      // the selected date boundary as covered.
      (pageHasPreWindowPost && !pageHasInWindowEntry) ||
      !page.nextCursor ||
      page.entryCount === 0;
    observationComplete =
      (pageHasOlderPost && !pageHasInWindowEntry) ||
      !page.nextCursor ||
      page.entryCount === 0;
    onProgress?.({
      scanned,
      authors: active.size,
      activeAuthors: active.size,
      observedAuthors: observed.size,
      pages,
      windowComplete: activityWindowComplete,
      backfillComplete: observationComplete,
    });
    await chrome.storage.local.set({
      [checkpointKey]: {
        schema: ACTIVITY_CHECKPOINT_SCHEMA,
        communityId,
        since: sinceDate.toISOString(),
        observationSince: observationSinceDate.toISOString(),
        until: untilDate.toISOString(),
        cursor: page.nextCursor,
        scanned,
        pages,
        activityWindowComplete,
        complete: observationComplete,
        authors: active.toJSON(),
        observedAuthors: observed.toJSON(),
        seenTweetIds: [...seenTweetIds],
        updatedAt: Date.now(),
      },
    });
    continuationCursor = page.nextCursor || null;
    if (observationComplete) break;
    cursor = page.nextCursor;
  }
  if (!observationComplete) {
    log?.(
      `Author backfill paused after ${pagesThisRun.toLocaleString()} page(s) this run; ` +
      `the saved cursor will continue next scan.`
    );
  }
  const result = finalizeActivity(activityWindowComplete, observationComplete, pages);
  result.continuationCursor = continuationCursor;
  return result;
}

export async function backfillCommunityTimelineAuthors(
  communityId,
  {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation,
    initialCursor = null,
    seedAuthors = [],
    maxPagesPerRun = 250,
  } = {}
) {
  const checkpointKey = `communityTimelineBackfill:${communityId}`;
  const stored = (await chrome.storage.local.get(checkpointKey))[checkpointKey];
  const validCheckpoint =
    stored?.schema === TIMELINE_BACKFILL_CHECKPOINT_SCHEMA &&
    stored.communityId === communityId;
  const checkpointAge = stored?.updatedAt ? Date.now() - stored.updatedAt : Infinity;
  const retryStoppedCheckpoint =
    validCheckpoint &&
    stored.terminal === true &&
    stored.complete !== true &&
    checkpointAge >= 6 * 60 * 60 * 1000;
  const observed = createActivityIndex([
    ...(validCheckpoint ? stored.authors || [] : []),
    ...(seedAuthors || []),
  ]);
  let cursor = validCheckpoint ? stored.cursor || null : initialCursor;
  let scanned = validCheckpoint ? stored.scanned || 0 : 0;
  let pages = validCheckpoint ? stored.pages || 0 : 0;
  let oldestPostAt = validCheckpoint ? stored.oldestPostAt || null : null;
  let complete = validCheckpoint && stored.complete === true;
  let halted = validCheckpoint && stored.terminal === true && !retryStoppedCheckpoint;
  let reason = complete ? stored.reason || "timeline-ended" : "in-progress";
  const seenCursors = new Set(cursor ? [cursor] : []);

  if (complete) {
    log?.(
      `Loaded the completed timeline archive with ${observed.size.toLocaleString()} unique author(s).`
    );
  } else if (halted) {
    reason = stored.reason || "timeline-stopped";
    log?.(
      `Loaded a partial timeline archive stopped at ${reason}, with ` +
      `${observed.size.toLocaleString()} unique author(s).`
    );
  } else if (validCheckpoint && cursor) {
    log?.(
      `${retryStoppedCheckpoint ? "Retrying" : "Resuming"} the Community timeline at page ` +
      `${(pages + 1).toLocaleString()} with ` +
      `${observed.size.toLocaleString()} unique author(s) already saved.`
    );
  } else {
    log?.("Starting the Community timeline archive from the newest available posts.");
  }

  const timelineDocumentId = operation?.documentId || DOCUMENT_IDS.CommunityTweetsTimeline;
  const timelineOperation = operation?.operation || "CommunityTweetsTimeline";
  const timelineVariables = operation?.variables && typeof operation.variables === "object"
    ? operation.variables
    : {};
  const timelineFeatures = operation?.features && Object.keys(operation.features).length
    ? operation.features
    : TIMELINE_FEATURES;
  let pagesThisRun = 0;

  while (!complete && !halted && pagesThisRun < maxPagesPerRun) {
    if (signal?.aborted) throw new StoppedError();
    const payload = await graphqlGet(
      timelineDocumentId,
      timelineOperation,
      {
        ...timelineVariables,
        communityId,
        count: 20,
        cursor,
        displayLocation: "Community",
        rankingMode: "Recency",
        withCommunity: true,
      },
      timelineFeatures,
      {
        signal,
        requestStats,
        log,
        limiter,
        clientTransactionId: operation?.clientTransactionId || null,
      }
    );
    const page = parseCommunityTimelinePage(payload);
    pages++;
    pagesThisRun++;
    let acceptedPosts = 0;

    for (const tweet of page.tweets) {
      const author = unwrapUserResult(tweet?.core?.user_results?.result);
      const username = author?.core?.screen_name;
      const createdAt = tweet?.legacy?.created_at ? new Date(tweet.legacy.created_at) : null;
      if (!username || !createdAt || Number.isNaN(createdAt.getTime())) continue;
      acceptedPosts++;
      scanned++;
      const postTime = createdAt.toISOString();
      if (!oldestPostAt || postTime < oldestPostAt) oldestPostAt = postTime;
      observed.add({
        username,
        count: 0,
        user_id: author.rest_id || null,
        name: author.core?.name || username,
        protected: typeof author.privacy?.protected === "boolean"
          ? author.privacy.protected
          : typeof author.legacy?.protected === "boolean"
            ? author.legacy.protected
            : null,
        lastSeenCommunityPost: postTime,
      });
    }

    const repeatedCursor =
      Boolean(page.nextCursor) &&
      (page.nextCursor === cursor || seenCursors.has(page.nextCursor));
    if (!page.nextCursor) {
      complete = true;
      reason = "timeline-ended";
    } else if (repeatedCursor) {
      halted = true;
      reason = "repeated-cursor";
    } else if (page.entryCount === 0 || (acceptedPosts === 0 && page.tweets.length === 0)) {
      halted = true;
      reason = "empty-page";
    } else {
      cursor = page.nextCursor;
      seenCursors.add(cursor);
    }

    await chrome.storage.local.set({
      [checkpointKey]: {
        schema: TIMELINE_BACKFILL_CHECKPOINT_SCHEMA,
        communityId,
        cursor: complete ? null : cursor,
        scanned,
        pages,
        oldestPostAt,
        complete,
        terminal: complete || halted,
        reason,
        authors: observed.toJSON(),
        updatedAt: Date.now(),
      },
    });
    onProgress?.({
      scanned,
      authors: observed.size,
      pages,
      pagesThisRun,
      oldestPostAt,
      complete,
      reason,
    });
  }

  if (!complete && !halted) {
    reason = "page-budget-reached";
    log?.(
      `Timeline archive paused after ${pagesThisRun.toLocaleString()} page(s) this run; ` +
      `the durable cursor will continue next scan.`
    );
  } else if (complete) {
    log?.(
      `Timeline archive reached X's oldest available post; ` +
      `${observed.size.toLocaleString()} unique author(s) saved.`
    );
  } else {
    log?.(
      `Timeline archive stopped at ${reason}; saved authors remain available as partial evidence.`
    );
  }
  observed.timelineComplete = complete;
  observed.timelineReason = reason;
  observed.timelinePages = pages;
  observed.timelinePosts = scanned;
  observed.oldestPostAt = oldestPostAt;
  return observed;
}

function unwrapTweetResult(result) {
  if (!result || typeof result !== "object") return null;
  if (result.tweet) return unwrapTweetResult(result.tweet);
  if (result.result) return unwrapTweetResult(result.result);
  return result.legacy?.created_at ? result : null;
}

function unwrapUserResult(result) {
  if (!result || typeof result !== "object") return null;
  if (result.user) return unwrapUserResult(result.user);
  if (result.result) return unwrapUserResult(result.result);
  return result.core?.screen_name || result.legacy?.screen_name ? result : null;
}

export function communityActivityKind(tweet) {
  if (
    tweet?.legacy?.retweeted_status_result ||
    tweet?.retweeted_status_result
  ) {
    return "repost";
  }
  return tweet?.legacy?.in_reply_to_status_id_str ||
    tweet?.legacy?.in_reply_to_user_id_str
    ? "reply"
    : "post";
}

export function parseCommunityTimelinePage(payload, kind = "activity") {
  const timeline = requireCommunityTimeline(payload, kind);
  const entries = (timeline.instructions || []).flatMap((instruction) => instruction.entries || []);
  const tweets = [];
  const tweetIds = new Set();
  let nextCursor = null;

  for (const entry of entries) {
    const content = entry?.content || {};
    if (
      content.entryType === "TimelineTimelineCursor" &&
      String(content.cursorType).toLowerCase() === "bottom"
    ) {
      nextCursor = content.value || null;
      continue;
    }
    const itemContents = [
      content.itemContent,
      ...(content.items || []).map((item) => item?.item?.itemContent || item?.itemContent),
    ].filter(Boolean);
    for (const itemContent of itemContents) {
      const tweet = unwrapTweetResult(itemContent?.tweet_results?.result);
      if (!tweet) continue;
      const tweetId = String(tweet.rest_id || tweet.legacy?.id_str || "");
      if (tweetId && tweetIds.has(tweetId)) continue;
      if (tweetId) tweetIds.add(tweetId);
      tweets.push(tweet);
    }
  }
  return { tweets, nextCursor, entryCount: entries.length };
}

async function backfillSupplementalTimelineAuthors(
  communityId,
  {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation,
    checkpointKey,
    label,
    timelineKind,
    variables,
    maxPagesPerRun,
  }
) {
  const stored = (await chrome.storage.local.get(checkpointKey))[checkpointKey];
  const validCheckpoint =
    stored?.schema === TIMELINE_BACKFILL_CHECKPOINT_SCHEMA &&
    stored.communityId === communityId;
  const checkpointAge = stored?.updatedAt ? Date.now() - stored.updatedAt : Infinity;
  const retryStoppedCheckpoint =
    validCheckpoint &&
    stored.terminal === true &&
    stored.complete !== true &&
    checkpointAge >= 6 * 60 * 60 * 1000;
  const observed = createActivityIndex(validCheckpoint ? stored.authors || [] : []);
  let cursor = validCheckpoint ? stored.cursor || null : null;
  let scanned = validCheckpoint ? stored.scanned || 0 : 0;
  let pages = validCheckpoint ? stored.pages || 0 : 0;
  let oldestPostAt = validCheckpoint ? stored.oldestPostAt || null : null;
  let complete = validCheckpoint && stored.complete === true;
  let halted = validCheckpoint && stored.terminal === true && !retryStoppedCheckpoint;
  let reason = complete ? stored.reason || "timeline-ended" : "in-progress";
  const seenCursors = new Set(cursor ? [cursor] : []);

  if (complete) {
    log?.(`Loaded the completed ${label} archive with ${observed.size.toLocaleString()} author(s).`);
  } else if (halted) {
    reason = stored.reason || "timeline-stopped";
    log?.(`Loaded the partial ${label} archive stopped at ${reason}.`);
  } else if (validCheckpoint && cursor) {
    log?.(
      `${retryStoppedCheckpoint ? "Retrying" : "Resuming"} ${label} page ` +
      `${(pages + 1).toLocaleString()} with ${observed.size.toLocaleString()} author(s) saved.`
    );
  } else {
    log?.(`Starting the ${label} archive.`);
  }

  const timelineDocumentId = operation?.documentId;
  const timelineOperation = operation?.operation;
  const timelineFeatures = operation?.features && Object.keys(operation.features).length
    ? operation.features
    : TIMELINE_FEATURES;
  let pagesThisRun = 0;
  while (!complete && !halted && pagesThisRun < maxPagesPerRun) {
    if (signal?.aborted) throw new StoppedError();
    const payload = await graphqlGet(
      timelineDocumentId,
      timelineOperation,
      variables(cursor),
      timelineFeatures,
      {
        signal,
        requestStats,
        log,
        limiter,
        clientTransactionId: operation?.clientTransactionId || null,
      }
    );
    const page = parseCommunityTimelinePage(payload, timelineKind);
    pages++;
    pagesThisRun++;
    let acceptedPosts = 0;
    for (const tweet of page.tweets) {
      const author = unwrapUserResult(tweet?.core?.user_results?.result);
      const username = author?.core?.screen_name;
      const createdAt = tweet?.legacy?.created_at ? new Date(tweet.legacy.created_at) : null;
      if (!username || !createdAt || Number.isNaN(createdAt.getTime())) continue;
      acceptedPosts++;
      scanned++;
      const postTime = createdAt.toISOString();
      if (!oldestPostAt || postTime < oldestPostAt) oldestPostAt = postTime;
      observed.add({
        username,
        count: 0,
        user_id: author.rest_id || null,
        name: author.core?.name || username,
        protected: typeof author.privacy?.protected === "boolean"
          ? author.privacy.protected
          : typeof author.legacy?.protected === "boolean"
            ? author.legacy.protected
            : null,
        lastSeenCommunityPost: postTime,
      });
    }
    const repeatedCursor =
      Boolean(page.nextCursor) &&
      (page.nextCursor === cursor || seenCursors.has(page.nextCursor));
    if (!page.nextCursor) {
      complete = true;
      reason = "timeline-ended";
    } else if (repeatedCursor) {
      halted = true;
      reason = "repeated-cursor";
    } else if (page.entryCount === 0 || (acceptedPosts === 0 && page.tweets.length === 0)) {
      halted = true;
      reason = "empty-page";
    } else {
      cursor = page.nextCursor;
      seenCursors.add(cursor);
    }
    await chrome.storage.local.set({
      [checkpointKey]: {
        schema: TIMELINE_BACKFILL_CHECKPOINT_SCHEMA,
        communityId,
        cursor: complete ? null : cursor,
        scanned,
        pages,
        oldestPostAt,
        complete,
        terminal: complete || halted,
        reason,
        authors: observed.toJSON(),
        updatedAt: Date.now(),
      },
    });
    onProgress?.({
      scanned,
      authors: observed.size,
      pages,
      pagesThisRun,
      oldestPostAt,
      complete,
      reason,
    });
  }
  if (!complete && !halted) reason = "page-budget-reached";
  observed.timelineComplete = complete;
  observed.timelineReason = reason;
  observed.timelinePages = pages;
  observed.timelinePosts = scanned;
  observed.oldestPostAt = oldestPostAt;
  return observed;
}

export async function backfillCommunityMediaAuthors(
  communityId,
  {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation,
    maxPagesPerRun = 75,
  } = {}
) {
  const mediaOperation = operation || {
    documentId: DOCUMENT_IDS.CommunityMediaTimeline,
    operation: "CommunityMediaTimeline",
  };
  return backfillSupplementalTimelineAuthors(communityId, {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation: mediaOperation,
    checkpointKey: `communityMediaBackfill:${communityId}`,
    label: "Community media timeline",
    timelineKind: "media",
    maxPagesPerRun,
    variables: (cursor) => ({
      communityId,
      count: 20,
      cursor,
      withCommunity: true,
    }),
  });
}

const COMMUNITY_SEARCH_SHARDS = Object.freeze(["a", "the", "to", "and", "i", "you"]);

export async function backfillCommunitySearchAuthors(
  communityId,
  {
    signal,
    requestStats,
    log,
    onProgress,
    limiter,
    operation,
    maxPagesPerShard = 8,
  } = {}
) {
  const searchOperation = operation || {
    documentId: DOCUMENT_IDS.CommunityTweetSearchModuleQuery,
    operation: "CommunityTweetSearchModuleQuery",
  };
  const combined = createActivityIndex();
  const shardStates = [];
  for (const query of COMMUNITY_SEARCH_SHARDS) {
    const archive = await backfillSupplementalTimelineAuthors(communityId, {
      signal,
      requestStats,
      log,
      limiter,
      operation: searchOperation,
      checkpointKey: `communitySearchBackfill:${communityId}:${query}`,
      label: `Community search “${query}”`,
      timelineKind: "search",
      maxPagesPerRun: maxPagesPerShard,
      variables: (cursor) => ({
        count: 20,
        cursor,
        query,
        communityId,
        timelineRankingMode: "Recency",
        includePromotedContent: false,
        timelineId: `communityTweetSearch-${communityId}-${query}-Recency`,
        withBirdwatchNotes: false,
        withDmMuting: false,
        withClientEventToken: false,
        withVoice: false,
        isListMemberTargetUserId: "0",
        withCommunity: false,
        withQuickPromoteEligibilityTweetFields: false,
        withGrokTranslatedBio: false,
        includeProfessionalCategory: true,
      }),
    });
    for (const author of archive.toJSON()) combined.add(author);
    shardStates.push({
      query,
      pages: archive.timelinePages,
      posts: archive.timelinePosts,
      authors: archive.size,
      oldestPostAt: archive.oldestPostAt,
      complete: archive.timelineComplete,
      reason: archive.timelineReason,
    });
    onProgress?.({
      query,
      shard: shardStates.length,
      shardCount: COMMUNITY_SEARCH_SHARDS.length,
      authors: combined.size,
      states: shardStates,
    });
  }
  combined.shards = shardStates;
  combined.timelineComplete = shardStates.every((state) => state.complete);
  return combined;
}

export async function fetchCommunityAboutMembers(
  communityId,
  { signal, requestStats, log, limiter, operation } = {}
) {
  const aboutOperation = operation || {
    documentId: DOCUMENT_IDS.CommunityAboutTimeline,
    operation: "CommunityAboutTimeline",
  };
  const payload = await graphqlGet(
    aboutOperation.documentId,
    aboutOperation.operation,
    { communityId, withCommunity: true },
    aboutOperation.features && Object.keys(aboutOperation.features).length
      ? aboutOperation.features
      : TIMELINE_FEATURES,
    {
      signal,
      requestStats,
      log,
      limiter,
      clientTransactionId: aboutOperation.clientTransactionId || null,
    }
  );
  const entries =
    payload?.data?.communityResults?.result?.about_timeline?.timeline?.instructions
      ?.flatMap((instruction) => instruction.entries || []) || [];
  const members = [];
  for (const entry of entries) {
    const role = entry?.entryId === "communityModerators" ? "Moderator" : "Member";
    for (const item of entry?.content?.items || []) {
      const user = unwrapUserResult(
        item?.item?.itemContent?.user_results?.result ||
        item?.itemContent?.user_results?.result
      );
      const username = user?.core?.screen_name;
      if (!username) continue;
      members.push({
        username,
        name: user.core?.name || username,
        user_id: user.rest_id || null,
        role,
        protected: typeof user.privacy?.protected === "boolean"
          ? user.privacy.protected
          : typeof user.legacy?.protected === "boolean"
            ? user.legacy.protected
            : null,
        roleConfidence: role === "Moderator" ? "high" : "medium",
        source: role === "Moderator" ? "moderator-surface" : "about-surface",
        membershipEvidence: "x-roster",
      });
    }
  }
  return members;
}

function createActivityIndex(seed = []) {
  const byUsername = new Map();
  const byId = new Map();
  // byUsername can map more than one key to the same author object (a
  // username change keeps the old key so lookups by either still resolve),
  // so unique authors are tracked separately rather than recomputed from
  // byUsername.values() on every size/toJSON access — that access happens
  // once per page during a scan and would otherwise rebuild a Set over the
  // full author list each time.
  const uniqueAuthors = new Set();
  const counts = (author) => {
    const rawCount = Number(author?.count);
    const rawPosts = Number(author?.posts);
    const rawReplies = Number(author?.replies);
    const hasBreakdown = Number.isFinite(rawPosts) || Number.isFinite(rawReplies);
    const posts = hasBreakdown
      ? Math.max(0, Number.isFinite(rawPosts) ? rawPosts : 0)
      : Math.max(0, Number.isFinite(rawCount) ? rawCount : 0);
    const replies = hasBreakdown
      ? Math.max(0, Number.isFinite(rawReplies) ? rawReplies : 0)
      : 0;
    return { posts, replies, count: posts + replies };
  };
  const add = (author) => {
    if (!author?.username) return;
    const incoming = counts(author);
    const usernameKey = author.username.toLowerCase();
    const idKey = author.user_id ? String(author.user_id) : null;
    const previous = (idKey && byId.get(idKey)) || byUsername.get(usernameKey);
    if (previous) {
      previous.posts = (previous.posts || 0) + incoming.posts;
      previous.replies = (previous.replies || 0) + incoming.replies;
      previous.count = previous.posts + previous.replies;
      if (
        author.lastSeenCommunityPost &&
        (!previous.lastSeenCommunityPost ||
          author.lastSeenCommunityPost > previous.lastSeenCommunityPost)
      ) {
        previous.lastSeenCommunityPost = author.lastSeenCommunityPost;
      }
      if (previous.username.toLowerCase() !== usernameKey) byUsername.set(usernameKey, previous);
      return;
    }
    const next = {
      ...author,
      posts: incoming.posts,
      replies: incoming.replies,
      count: incoming.count,
    };
    byUsername.set(usernameKey, next);
    if (idKey) byId.set(idKey, next);
    uniqueAuthors.add(next);
  };
  for (const author of seed || []) add(author);
  return {
    byUsername,
    byId,
    add,
    get size() {
      return uniqueAuthors.size;
    },
    toJSON: () => [...uniqueAuthors],
  };
}

export function activityDetailsForMember(activity, member) {
  const byStableId = member?.user_id ? activity?.byId?.get(String(member.user_id)) : null;
  const record = byStableId || activity?.byUsername?.get(member?.username?.toLowerCase());
  const posts = Math.max(0, Number(record?.posts) || 0);
  const replies = Math.max(0, Number(record?.replies) || 0);
  const legacyCount = Math.max(0, Number(record?.count) || 0);
  const total = posts + replies || legacyCount;
  return {
    posts,
    replies,
    total,
    lastSeenCommunityPost: record?.lastSeenCommunityPost || "",
  };
}

export function activityCountForMember(activity, member) {
  return activityDetailsForMember(activity, member).total;
}

export function buildCsv(rows, roster = {}, activity = {}) {
  const escape = (value) => {
    const raw = String(value ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const found = Number.isFinite(roster.found) ? roster.found : "";
  const expected = Number.isFinite(roster.expected) ? roster.expected : "";
  const coverage = found !== "" && expected
    ? ((found / expected) * 100).toFixed(1)
    : "";
  const status = roster.complete ? "complete" : "partial";
  const activityStatus = activity.complete ? "complete" : "partial";
  const header =
    "username,community_posts_in_window,community_replies_in_window," +
    "community_activity_in_window,role,membership_evidence,last_seen_community_activity,reason," +
    "activity_status,activity_stop_reason,roster_status,roster_coverage_percent," +
    "roster_members_found,roster_members_expected,roster_stop_reason,activity_verification\n";
  return header + rows.map((row) => [
    row.username,
    row.communityPostsInWindow ?? 0,
    row.communityRepliesInWindow ?? 0,
    row.postsInWindow,
    row.role,
    row.membershipEvidence || "x-roster",
    row.lastSeenCommunityPost || "",
    row.flagReason,
    activityStatus,
    activity.reason || "",
    status,
    coverage,
    found,
    expected,
    roster.reason || "",
    // Whether a direct (from:username) search confirmed this specific row, as
    // opposed to it resting only on the broad crawl's inference. Distinct from
    // "unverified": a protected account a viewer session cannot see into
    // returns no results either way, so this row can never be confirmed and
    // must not be read as though it had been.
    row.activityVerification || "unverified",
  ].map(escape).join(",")).join("\n");
}

function privateAccountUsernames(rows) {
  const usernames = new Map();
  for (const row of rows) {
    if (row?.protected !== true || !row?.username) continue;
    const username = String(row.username).replace(/^@/, "");
    const key = username.toLowerCase();
    if (!usernames.has(key)) usernames.set(key, username);
  }
  return [...usernames.values()]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function buildPrivateAccountsCsv(rows) {
  const escape = (value) => {
    const raw = String(value ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "username\n" + privateAccountUsernames(rows).map(escape).join("\n");
}

export function buildPrivateAccountsText(rows) {
  return privateAccountUsernames(rows).map((username) => `@${username}`).join("\n");
}

export function downloadBlob(content, mimeType, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
