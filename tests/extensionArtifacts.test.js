import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("lite manifest uses MV3 least privilege and stable Chrome APIs", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "5.14.0");
  assert.equal(manifest.minimum_chrome_version, "114");
  assert.equal("message_serialization" in manifest, false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal(manifest.permissions.includes("unlimitedStorage"), true);
  assert.equal("optional_permissions" in manifest, false);
  assert.equal("optional_host_permissions" in manifest, false);
  assert.equal(manifest.background.type, "module");
});

test("side panel exposes only essential scan and CSV controls", async () => {
  const html = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  for (const marker of ["communityId", "lookbackDays", "inactiveRule", "timelineBackfill", "focusLock", "startBtn", "stopBtn", "modeToggleBtn", "communityTabBtn", "exportBtn", "exportDiagnosticsBtn", "privatePanel", "privateValue", "exportPrivateBtn", "exportPrivateTextBtn", "aria-live=\"polite\""]) {
    assert.match(html, new RegExp(marker));
  }
  assert.doesNotMatch(html, /minPosts|Minimum posts/);
  for (const removed of ["officialApiToken", "diagnosticRecorderToggle", "operationRecoveryStatus", "exportFormat", "deepRescue", "useApifyProvider", "apifyToken", "apifyMaxCharge"]) {
    assert.doesNotMatch(html, new RegExp(removed));
  }
});

test("private-account export becomes durable before activity analysis", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const rosterPrivateIndex = source.indexOf(
    "currentPrivateAccounts = ctx.members.filter((member) => member.protected === true)"
  );
  const activityIndex = source.indexOf('setPhase("Analyzing posts", "activity")');
  assert.ok(rosterPrivateIndex >= 0);
  assert.ok(activityIndex > rosterPrivateIndex);
  assert.match(source, /privateAccounts: currentPrivateAccounts/);
  assert.match(source, /privateRosterReady/);
  assert.match(source, /member\.membershipEvidence === "x-roster"/);
});

test("side panel uses structured scan events and accessible motion", async () => {
  const [html, script, css, background] = await Promise.all([
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.css", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /class="phase-rail"/);
  assert.match(html, /class="scan-log"/);
  assert.match(html, /role="log"/);
  assert.doesNotMatch(html, /<pre id="log"/);
  assert.match(script, /professionalLogMessage/);
  assert.match(script, /Live roster connection established/);
  assert.match(script, /buildDiagnosticReport/);
  assert.match(script, /archiving-timeline/);
  assert.match(script, /will not physically scroll/);
  assert.match(script, /phaseValue\.dataset\.stage/);
  assert.match(script, /stage === "activity"/);
  assert.match(script, /collectSafeBrowserDiagnostics/);
  assert.match(script, /dashboardMode/);
  assert.match(script, /Open Lite panel/);
  assert.match(script, /focusCommunityTab/);
  assert.match(script, /dashboardTab/);
  assert.match(background, /chrome\.tabs\.create/);
  assert.match(background, /ACQUIRE_SCAN_LEASE/);
  assert.match(script, /acquireScanLease/);
  assert.doesNotMatch(background, /chrome\.windows\.create/);
  assert.match(css, /data-mode="dashboard"/);
  assert.match(css, /main:has\(\.progress-card\[hidden\]\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /--ease-out/);
});

test("panel typography stays on real font weights and a legible floor", async () => {
  const css = await readFile(new URL("../sidepanel.css", import.meta.url), "utf8");
  // Static system faces cannot render 520/650/720/750, so two labels asking for
  // different phantom weights render identically and the hierarchy is lost.
  const weights = [...css.matchAll(/font-weight:\s*(\d{3})/g)].map((match) => Number(match[1]));
  const inlineWeights = [...css.matchAll(/font:\s*(\d{3})\s/g)].map((match) => Number(match[1]));
  for (const weight of [...weights, ...inlineWeights]) {
    assert.ok([100, 200, 300, 400, 500, 600, 700, 800, 900].includes(weight),
      `unsupported font-weight ${weight}`);
  }
  // Nothing may be smaller than the --step--2 floor.
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
  for (const size of sizes) assert.ok(size >= 10, `font-size ${size}px is below the 10px floor`);
  assert.match(css, /--step--2:\s*10px/);
  assert.match(css, /prefers-contrast: more/);
  // Counters must not reflow while a scan increments them.
  assert.match(css, /font-variant-numeric: tabular-nums/);
  // Cards no longer force a composited layer for the whole scan. Matches the
  // declaration only, so the comment explaining the removal is allowed to
  // mention the property by name.
  assert.doesNotMatch(css, /^\s*backdrop-filter:/m);
});

test("the scan log appends entries instead of rebuilding the list", async () => {
  const script = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(script, /function appendLogEntry/);
  assert.match(script, /pinnedToBottom/);
  // Rebuilding all retained rows per event re-ran every entrance animation and
  // threw away the reader's scroll position.
  assert.doesNotMatch(script, /logEl\.replaceChildren\(\);/);
  assert.match(script, /coverageValue/);
});

test("DOM collection sends deltas instead of cloning the full roster per pass", async () => {
  const source = await readFile(new URL("../domScan.js", import.meta.url), "utf8");
  assert.match(source, /primaryColumn \|\| document/);
  assert.match(source, /rosterRows\(\)/);
  assert.doesNotMatch(source, /state\.mutations\+\+;\s*collect\(\)/);
  assert.match(source, /pendingMembers = Object\.values\(state\.pending\)/);
  assert.doesNotMatch(source, /members:\s*Object\.values\(state\.members\)/);
  assert.doesNotMatch(source, /Object\.keys\(state\.members\)\.length/);
  assert.doesNotMatch(source, /onCheckpoint\?\.\(\{ members, complete: true \}\)/);
  assert.match(source, /stopReason = "dom-stalled"/);
  assert.match(source, /row-ancestor/);
  assert.match(source, /targetCount/);
});

// The 5.14 module split moved every pattern this test checks for out of
// liteScanner.js (now a re-export barrel, see its own header comment) into
// src/api/ and src/roster/. Concatenating that domain's real source keeps
// every regression this test pins meaningful, without needing a separate
// test per file for what was always one cohesive concern: the roster cursor
// implementation.
async function rosterDomainSource() {
  const { readdir } = await import("node:fs/promises");
  const dirs = ["../src/api", "../src/roster", "../src/activity"];
  let combined = "";
  for (const dir of dirs) {
    const base = new URL(dir + "/", import.meta.url);
    for (const name of await readdir(base)) {
      if (name.endsWith(".js")) combined += await readFile(new URL(name, base), "utf8") + "\n";
    }
  }
  return combined;
}

test("cursor mode discovers the live operation and checkpoints every page", async () => {
  const [domSource, scannerSource, panelHtmlForSeek] = await Promise.all([
    readFile(new URL("../domScan.js", import.meta.url), "utf8"),
    rosterDomainSource(),
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
  ]);
  assert.match(domSource, /membersSliceTimeline_Query/);
  assert.match(domSource, /performance\.getEntriesByType\("resource"\)/);
  assert.match(domSource, /chrome\.tabs\.reload\(tabId\)/);
  assert.match(domSource, /safeRotatedName/);
  assert.match(domSource, /chrome\.webRequest\.onBeforeSendHeaders/);
  assert.match(domSource, /https:\/\/x\.com\/i\/api\/graphql\/\*/);
  assert.match(scannerSource, /clientTransactionId/);
  assert.match(scannerSource, /buildMemberCursorRequest/);
  assert.match(scannerSource, /cursorRoster:/);
  assert.match(scannerSource, /saveCursorPage/);
  assert.match(scannerSource, /repeated-cursor/);
  assert.match(scannerSource, /rate-limited/);
  assert.match(scannerSource, /activityScan:/);
  assert.match(scannerSource, /communityTimelineBackfill:/);
  assert.match(scannerSource, /backfillCommunityTimelineAuthors/);
  assert.match(scannerSource, /backfillCommunityMediaAuthors/);
  assert.match(scannerSource, /backfillCommunitySearchAuthors/);
  assert.match(scannerSource, /fetchCommunityAboutMembers/);
  assert.match(scannerSource, /activityWindowComplete/);
  assert.match(domSource, /discoverCommunityTimelineOperation/);
  assert.match(scannerSource, /timelineDocumentId/);
  assert.match(scannerSource, /operation\?\.documentId \|\| DOCUMENT_IDS\.CommunityQuery/);
  assert.match(scannerSource, /pageHasPreWindowPost/);
  assert.match(scannerSource, /no-new-members/);
  assert.match(scannerSource, /PARTIAL_CHECKPOINT_MAX_AGE_MS/);
  // Checkpoints written by the pre-5.10.1 collector could say "terminal, 0
  // members" for the native scope; they must not be replayed.
  assert.match(scannerSource, /CURSOR_CHECKPOINT_SCHEMA = 4/);
  assert.match(scannerSource, /checkpointHasMembers/);
  assert.match(scannerSource, /parseCommunityMembersTimelinePayload/);
  // Seek-resume must stay opt-in and must never loop on an exhausted region.
  assert.match(scannerSource, /seekResume = false/);
  assert.match(scannerSource, /seek-resume-exhausted/);
  assert.match(scannerSource, /SEEK_RESUME_MAX_SEGMENTS/);
  // Regression: a resumed segment was judged after a single page, which lands
  // inside the overlap window, so the walk ended at the cap with 46,951 of
  // 79,397 and called itself complete.
  assert.match(scannerSource, /SEEK_RESUME_MIN_SEGMENT_PAGES/);
  assert.match(scannerSource, /segmentPages >= SEEK_RESUME_MIN_SEGMENT_PAGES/);
  assert.match(scannerSource, /unproductiveSegments/);
  // Regression: duplicate pages must not end a resumed walk. Re-entering
  // collected ground on the way to uncollected ground can take hundreds of
  // pages, and any finite idle limit strands everyone beyond it.
  // Above X's 500-page chain cap, so it cannot fire mid-crossing, but finite so
  // a duplicate-only chain cannot spend the whole page budget.
  assert.match(scannerSource, /SEEK_RESUME_IDLE_PAGE_LIMIT = 600/);
  // Regression: a coarse forward skip steps over members that were never
  // collected. One millisecond escapes a tied timestamp without doing that.
  assert.match(scannerSource, /SEEK_RESUME_FORWARD_STEP_MS = 1/);
  // Regression: successive resumes must advance, or a segment that ends before
  // it can be judged pins the walk and burns the segment budget.
  assert.match(scannerSource, /lastSeekTarget/);
  // Re-seeks must use the opening cursor; a late-chain cursor carries a spent
  // page budget and yields one page with no continuation.
  assert.match(scannerSource, /seekTemplateCursor/);
  // A short roster must never be reported as complete.
  assert.doesNotMatch(
    scannerSource,
    /reason === "seek-resume-exhausted";\s*\n\s*const terminal/
  );
  assert.match(panelHtmlForSeek, /id="seekResume"/);
  assert.doesNotMatch(panelHtmlForSeek, /id="seekResume"[^>]*checked/);
  assert.match(scannerSource, /CommunitiesMembersAllQuery/);
  assert.match(scannerSource, /checkpointScope/);
  assert.match(scannerSource, /CommunityMemberRelationshipTypeahead/);
  assert.match(scannerSource, /verifyKnownCommunityMembers/);
  assert.doesNotMatch(scannerSource, /byUsername\.size/);
  assert.match(domSource, /maxIdlePasses = MAX_IDLE_PASSES/);
});

test("flagged members are confirmed with a direct from: search before export", async () => {
  const [scannerSource, panelSource, csvSource] = await Promise.all([
    readFile(new URL("../src/activity/directVerification.js", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../src/export/csv.js", import.meta.url), "utf8"),
  ]);
  assert.match(scannerSource, /export async function verifyMemberActivityViaSearch/);
  // Same operation and document ID the word-shard backfill already uses — this
  // is a different query on an existing contract, not a new endpoint.
  assert.match(scannerSource, /query: `\(from:\$\{username\}\)`/);
  assert.match(scannerSource, /DOCUMENT_IDS\.CommunityTweetSearchModuleQuery/);
  // Verification must run only against members already flagged, never the
  // full roster — the roster is tens of thousands of accounts and this is not
  // a request budget spent on everyone.
  assert.match(panelSource, /verifySearchActivityForFlagged/);
  assert.match(panelSource, /verifyMemberActivityViaSearch\(\s*ctx\.communityId,\s*currentResults/);
  assert.doesNotMatch(panelSource, /verifyMemberActivityViaSearch\(\s*ctx\.communityId,\s*ctx\.members/);
  // A confirmed-active member must be removed from the exported flagged list,
  // not merely annotated.
  assert.match(panelSource, /result\?\.hasActivityInWindow/);
  assert.match(scannerSource, /activitySearchCandidateIdentity/);
  // A protected account returns the same empty search result whether it
  // genuinely posted nothing or is simply invisible to this session, so an
  // empty result there is not the same evidence it is for a public account.
  // A row must say so rather than reading as an equally-confirmed "inactive".
  assert.match(panelSource, /unverifiable-protected/);
  assert.match(panelSource, /member\.protected === true/);
  // Every exported row must state whether it rests on the direct search or
  // only on the broad crawl's inference, and default to the unconfirmed state
  // rather than silently reading as verified.
  assert.match(csvSource, /activity_verification/);
  assert.match(csvSource, /row\.activityVerification \|\| "unverified"/);
});

test("a separate export offers only the directly-confirmed subset, with a manual-review warning", async () => {
  // This export's stated purpose is deciding who to remove from a Community.
  // The main export intentionally mixes confirmed, unverified, and
  // unverifiable-protected rows for review; a second, narrower export must
  // exist so that decision doesn't default to the unfiltered list.
  const [html, panelSource] = await Promise.all([
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="exportConfirmedBtn"/);
  assert.match(html, /unverifiable-protected/);
  assert.match(html, /review both manually before acting on them/);
  assert.match(panelSource, /activityVerification === "confirmed-inactive"/);
  assert.match(panelSource, /confirmedCountEl\.textContent/);
  // The confirmed export must filter currentResults, not just relabel it —
  // an unverified row must never end up in this file.
  assert.match(
    panelSource,
    /currentResults\.filter\(\(row\) => row\.activityVerification === "confirmed-inactive"\)/
  );
});

test("roster sources use a pluggable registry", async () => {
  const { createRosterSourceRegistry } = await import("../rosterSources.js");
  const registry = createRosterSourceRegistry([
    { id: "fixture", collect: async () => ({ members: [{ username: "Alice" }], reason: "fixture" }) },
  ]);
  assert.equal(registry.has("fixture"), true);
  const result = await registry.collect("fixture", {});
  assert.equal(result.source, "fixture");
  assert.equal(result.members[0].username, "Alice");
});

test("extension remains local and free of third-party roster services", async () => {
  const [manifestText, panelHtml, panelSource, packageText, privacy] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
  ]);
  for (const source of [manifestText, panelHtml, panelSource, packageText]) {
    assert.doesNotMatch(source, /api\.apify|Apify|Xquik|prove:full-roster/i);
  }
  assert.match(privacy, /No scan data is sent\s+to another service/);
});

test("optional launcher disables the three Chromium background schedulers", async () => {
  const source = await readFile(new URL("../launch-unthrottled-chrome.ps1", import.meta.url), "utf8");
  for (const flag of [
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ]) assert.match(source, new RegExp(flag));
  assert.doesNotMatch(source, /Stop-Process|taskkill/i);
});
