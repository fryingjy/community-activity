// Drives the real, unmodified fetchCommunityMembersByCursor() against a fake
// X roster server, instead of proving the seek-resume *decision helpers*
// correct against a reimplementation of the orchestration loop (see
// liteScanner.test.js's simulateSeekResume). This exercises the actual
// production code path: request building, the real cursor codec, real
// checkpoint persistence, and the real chain-cap/dead-zone/reseek state
// machine in collectRoster.js - so a bug in how that code wires the
// decision helpers together, not just in the helpers themselves, would fail
// this test.
//
// Scale is deliberately small relative to a real Community (900 members, not
// 79,000): fetchCommunityMembersByCursor's rate limiter imposes a real
// ~750ms wait after every successful request, uninjectable from test code by
// design (it's the same pacing a real scan uses), so this test's wall-clock
// cost is directly proportional to how many requests the walk needs. The
// scenario is still structurally adversarial at this scale: a chain cap far
// below the roster size forces multiple seek-resume segments, and a large
// tied-timestamp block forces the exact dead-zone-crossing logic that
// previously stalled a real scan at 66.57%.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchCommunityMembersByCursor } from "../../src/roster/collectRoster.js";
import { NATIVE_MEMBERS_ALL_OPERATION } from "../../src/api/operations.js";
import { createFakeXRosterServer, installFakeXEnvironment } from "./fakeXServer.js";

const TOTAL = 900;
const TIED_BLOCK_SIZE = 100;
const START = Date.UTC(2025, 0, 23);
const SPAN = 200 * 24 * 60 * 60 * 1000;

function generateServableMembers() {
  const members = [];
  for (let i = 0; i < TOTAL; i++) {
    const joinTimeMs = i < TIED_BLOCK_SIZE
      ? START
      : START + Math.floor(SPAN * Math.pow((i - TIED_BLOCK_SIZE) / (TOTAL - TIED_BLOCK_SIZE), 2.2));
    members.push({ userId: String(1000 + i), username: `member_${i}`, joinTimeMs });
  }
  members.sort((left, right) => left.joinTimeMs - right.joinTimeMs);
  return members;
}

test(
  "fetchCommunityMembersByCursor's collected IDs exactly equal the servable roster's IDs, through real seek-resume against a fake X server",
  { timeout: 90000 },
  async () => {
    const servable = generateServableMembers();
    const server = createFakeXRosterServer({
      members: servable,
      pageSize: 30,
      chainPageCap: 6,
      documentId: NATIVE_MEMBERS_ALL_OPERATION.documentId,
      operation: NATIVE_MEMBERS_ALL_OPERATION.operation,
    });
    const env = installFakeXEnvironment(server);
    try {
      const result = await fetchCommunityMembersByCursor(
        "9999999999",
        NATIVE_MEMBERS_ALL_OPERATION,
        {
          expectedCount: TOTAL,
          seekResume: true,
          checkpointScope: "simulator-roster",
          maxPages: 2000,
        }
      );

      const expectedIds = new Set(servable.map((member) => member.userId));
      const collectedIds = new Set(result.members.map((member) => member.user_id));
      const missing = [...expectedIds].filter((id) => !collectedIds.has(id));
      const unexpected = [...collectedIds].filter((id) => !expectedIds.has(id));

      // The core claim this simulator exists to prove: expected servable IDs
      // === collected IDs, exactly - not "most of them," and driven through
      // the real production orchestrator, not a reimplementation of its
      // decision logic.
      assert.equal(collectedIds.size, expectedIds.size,
        `missing ${missing.length} id(s) (e.g. ${missing.slice(0, 5).join(", ")}), ` +
        `${unexpected.length} unexpected id(s) (e.g. ${unexpected.slice(0, 5).join(", ")})`);
      assert.deepEqual(missing, []);
      assert.deepEqual(unexpected, []);
      assert.equal(result.complete, true);
      assert.equal(result.reason, "expected-count-reached");

      // The chain cap (6 pages) is far below what a single unbroken chain
      // could serve (900/30 = 30 pages), so completing at all is only
      // possible if the real seek-resume path in collectRoster.js actually
      // fired, not just the plain linear-cursor path.
      assert.ok(result.reseeks >= 3, `expected multiple seek-resume reseeks, got ${result.reseeks}`);

      // The real checkpoint code path must have actually run, not just the
      // request loop - this is what proves rosterCheckpoint.js's storage
      // contract, not only collectRoster.js's request/response handling.
      const checkpointKeys = [...env.storage.keys()].filter((key) => key.startsWith("cursorRoster:simulator-roster:"));
      assert.ok(checkpointKeys.length > 0, "expected checkpoint pages to be written during the walk");
    } finally {
      env.restore();
    }
  }
);
