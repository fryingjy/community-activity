function escape(value) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildCsv(rows, roster = {}, activity = {}) {
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
