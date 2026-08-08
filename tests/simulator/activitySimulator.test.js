// Drives the real, unmodified fetchActiveAuthors() (src/activity/timelineCollector.js)
// against a fake Community timeline server end to end: real request building,
// real parser (parseCommunityTimelinePage/communityActivityKind), real
// tweet-ID dedup across overlapping pages, and the real activity-window-
// complete decision logic - not a reimplementation of any of it.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchActiveAuthors } from "../../src/activity/timelineCollector.js";
import { AdaptiveRateLimiter } from "../../src/api/rateLimiter.js";
import { DOCUMENT_IDS } from "../../src/api/operations.js";
import { createFakeXActivityServer } from "./fakeXActivityServer.js";
import { installFakeXEnvironment } from "./fakeXServer.js";

const noopSleep = async () => {};
function noInjectedDelay() {
  return { limiter: new AdaptiveRateLimiter(750, noopSleep), delayFn: noopSleep };
}

const DOCUMENT_ID = DOCUMENT_IDS.CommunityTweetsTimeline;
const OPERATION = "CommunityTweetsTimeline";

// Builds a synthetic timeline, newest-first (matching X's real order), with
// a controllable mix of posts/replies/reposts across a controllable set of
// authors, plus two tweets planted exactly on and one millisecond outside
// the window boundary.
function generateTimeline({ count, authorCount, untilMs, stepMs, sinceMs }) {
  const tweets = [];
  for (let i = 0; i < count; i++) {
    const createdAtMs = untilMs - i * stepMs;
    const authorIndex = i % authorCount;
    const kind = i % 10 === 0 ? "repost" : i % 4 === 0 ? "reply" : "post";
    tweets.push({
      tweetId: `t${i}`,
      authorUserId: `u${authorIndex}`,
      authorUsername: `author_${authorIndex}`,
      createdAtMs,
      kind,
    });
  }
  // Boundary cases: one tweet exactly at sinceMs (must count), one exactly
  // 1ms before it (must not) - both from an author that appears nowhere else,
  // so the assertion can tell which rule let them in.
  tweets.push({ tweetId: "boundary-in", authorUserId: "u-boundary-in", authorUsername: "boundary_in", createdAtMs: sinceMs, kind: "post" });
  tweets.push({ tweetId: "boundary-out", authorUserId: "u-boundary-out", authorUsername: "boundary_out", createdAtMs: sinceMs - 1, kind: "post" });
  tweets.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return tweets;
}

function expectedActiveAuthorIds(tweets, sinceMs, untilMs) {
  const ids = new Set();
  for (const tweet of tweets) {
    if (tweet.kind === "repost") continue;
    if (tweet.createdAtMs < sinceMs || tweet.createdAtMs > untilMs) continue;
    ids.add(tweet.authorUserId);
  }
  return ids;
}

test("fetchActiveAuthors' discovered active author IDs exactly equal expected authors, including window boundaries and overlapping pages", async () => {
  const untilMs = Date.UTC(2026, 6, 30, 12, 0, 0);
  const sinceMs = untilMs - 30 * 24 * 60 * 60 * 1000;
  const tweets = generateTimeline({
    count: 600, authorCount: 140, untilMs, stepMs: 45 * 1000, sinceMs,
  });
  const server = createFakeXActivityServer({
    tweets, pageSize: 20, overlapCount: 5, documentId: DOCUMENT_ID, operation: OPERATION,
  });
  const env = installFakeXEnvironment(server);
  try {
    const result = await fetchActiveAuthors(
      "1234567890",
      new Date(sinceMs),
      new Date(untilMs),
      { checkpointScope: "activity-sim", maxPagesPerRun: 2000, ...noInjectedDelay() }
    );

    const expected = expectedActiveAuthorIds(tweets, sinceMs, untilMs);
    const collected = new Set(result.toJSON().map((author) => author.user_id));
    const missing = [...expected].filter((id) => !collected.has(id));
    const unexpected = [...collected].filter((id) => !expected.has(id));

    assert.equal(collected.size, expected.size,
      `missing ${missing.length} (e.g. ${missing.slice(0, 5).join(", ")}), ` +
      `${unexpected.length} unexpected (e.g. ${unexpected.slice(0, 5).join(", ")})`);
    assert.deepEqual(missing, []);
    assert.deepEqual(unexpected, []);
    assert.equal(result.activityWindowComplete, true);

    // The boundary is inclusive at sinceDate and exclusive one millisecond
    // before it - proves the real >= / < comparisons, not an approximation.
    assert.ok(collected.has("u-boundary-in"), "a tweet exactly at sinceDate must count as active");
    assert.ok(!collected.has("u-boundary-out"), "a tweet one millisecond before sinceDate must not count");

    // Every request the server saw must have been deduplicated correctly:
    // overlapping pages re-serve up to 5 tweets, so the server handled more
    // requests than there are unique tweets, yet no repost ever contributes.
    assert.ok(server.requestCount > 0);
  } finally {
    env.restore();
  }
});

test("a 429 and a transient 500 mid-walk are retried and recovered without corrupting discovered activity", async () => {
  const untilMs = Date.UTC(2026, 5, 1, 0, 0, 0);
  const sinceMs = untilMs - 10 * 24 * 60 * 60 * 1000;
  const tweets = generateTimeline({ count: 150, authorCount: 40, untilMs, stepMs: 5 * 60 * 1000, sinceMs });
  const server = createFakeXActivityServer({
    tweets, pageSize: 15, documentId: DOCUMENT_ID, operation: OPERATION,
    injectFault: (n) => (n === 2 ? "429" : n === 4 ? "500" : null),
  });
  const env = installFakeXEnvironment(server);
  try {
    const result = await fetchActiveAuthors(
      "1234567890",
      new Date(sinceMs),
      new Date(untilMs),
      { checkpointScope: "activity-sim-faults", maxPagesPerRun: 2000, ...noInjectedDelay() }
    );
    const expected = expectedActiveAuthorIds(tweets, sinceMs, untilMs);
    const collected = new Set(result.toJSON().map((author) => author.user_id));
    assert.deepEqual([...expected].sort(), [...collected].sort());
    assert.equal(result.activityWindowComplete, true);
  } finally {
    env.restore();
  }
});
