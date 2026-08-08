// A deterministic fake X Community timeline server, driving the real,
// unmodified fetchActiveAuthors() (src/activity/timelineCollector.js) end to
// end - same rationale as fakeXServer.js for the roster collector: prove the
// real orchestration and parser wiring, not a reimplementation of it.
//
// Unlike the roster cursor, this endpoint has no seek/reseek mechanism in
// production - fetchActiveAuthors only ever walks forward via the server's
// own page.nextCursor until it decides the window is covered - so an opaque
// position-encoded cursor is an honest model here; there is no dead-zone
// class of bug for this endpoint to reproduce.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// X's classic tweet date format ("Wed Jul 22 12:00:00 +0000 2026") - the
// exact string production's `new Date(tweet.legacy.created_at)` must parse.
export function twitterDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

function tweetNode(t) {
  return {
    rest_id: t.tweetId,
    legacy: {
      created_at: twitterDate(t.createdAtMs),
      ...(t.kind === "reply" ? { in_reply_to_status_id_str: `parent-${t.tweetId}` } : {}),
      ...(t.kind === "repost" ? { retweeted_status_result: { result: { rest_id: `orig-${t.tweetId}` } } } : {}),
    },
    core: {
      user_results: {
        result: {
          rest_id: t.authorUserId,
          core: { screen_name: t.authorUsername, name: t.authorUsername },
          legacy: { protected: t.protected === true },
        },
      },
    },
  };
}

function timelinePayload(pageTweets, nextCursor) {
  const entries = pageTweets.map((t, i) => ({
    entryId: `tweet-${t.tweetId}-${i}`,
    content: { itemContent: { tweet_results: { result: tweetNode(t) } } },
  }));
  if (nextCursor) {
    entries.push({
      content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: nextCursor },
    });
  }
  return {
    data: {
      communityResults: {
        result: { ranked_community_timeline: { timeline: { instructions: [{ entries }] } } },
      },
    },
  };
}

// `tweets` must be pre-sorted descending by createdAtMs (newest first) -
// that's the order a real Community timeline walks. `overlapCount` re-serves
// the tail of the previous page at the start of the next one, modelling the
// overlapping/duplicate pages a real cursor walk actually returns; the real
// collector's seenTweetIds dedup is what's under test when this is nonzero.
export function createFakeXActivityServer({
  tweets, pageSize, documentId, operation, overlapCount = 0, injectFault,
}) {
  let requestCount = 0;

  function respond(url) {
    requestCount++;
    const fault = injectFault?.(requestCount);
    if (fault === "429") {
      return {
        status: 429, statusText: "Too Many Requests", body: null,
        headers: { "retry-after": "0", "x-rate-limit-reset": String(Math.floor(Date.now() / 1000)) },
      };
    }
    if (fault === "500") return { status: 500, statusText: "Internal Server Error", body: null };
    if (fault === "malformed") return { status: 200, statusText: "OK", body: { data: {} } };

    const parsed = new URL(url);
    const [, , , , reqDocumentId, reqOperation] = parsed.pathname.split("/");
    if (reqDocumentId !== documentId || reqOperation !== operation) {
      return { status: 404, statusText: "Not Found", body: null };
    }
    const variables = JSON.parse(parsed.searchParams.get("variables") || "{}");
    const requestedPosition = variables.cursor
      ? Number(Buffer.from(variables.cursor, "base64").toString("utf8"))
      : 0;
    const position = Math.max(0, requestedPosition - overlapCount);
    const page = tweets.slice(position, position + pageSize);
    const nextPosition = position + page.length;
    const nextCursor = page.length > 0 && nextPosition < tweets.length
      ? Buffer.from(String(nextPosition)).toString("base64")
      : null;
    return {
      status: 200,
      statusText: "OK",
      body: timelinePayload(page, nextCursor),
      headers: { "x-rate-limit-limit": "500", "x-rate-limit-remaining": "499", "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900) },
    };
  }

  return {
    respond,
    get requestCount() {
      return requestCount;
    },
  };
}
