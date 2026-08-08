// Whether a scan's output can be trusted used to be answered by re-deriving
// it independently in three places: two export-button `.disabled` checks and
// a hand-built results summary sentence, each reading `currentRosterState`/
// `currentActivityState`/the verification diagnostics slightly differently.
// This module makes it one canonical, pure computation instead, and gives
// the sanitized diagnostics export a single "can this output be trusted"
// answer rather than requiring a reader to reconstruct it from scattered
// booleans.
//
// This intentionally does NOT block exporting a partial-roster or
// partial-verification result — that's a deliberate product decision (a
// large Community may never reach 100% roster coverage in one run, and
// blocking the export entirely would defeat the point of seek-resume). What
// it does do is make the exact conditions that already gate the confirmed
// export explicit and testable, and surface the caveats a reviewer needs
// before acting on the output, instead of leaving them implicit in prose.

export function summarizeScanCompleteness({ roster, activity, verification } = {}) {
  const rosterComplete = roster?.complete === true;
  const activityComplete = activity?.complete === true;
  const verificationRan = verification != null;
  const verificationRemaining = Math.max(0, Number(verification?.remaining) || 0);
  return {
    roster: {
      complete: rosterComplete,
      found: Number.isFinite(roster?.found) ? roster.found : 0,
      expected: Number.isFinite(roster?.expected) ? roster.expected : null,
      reason: roster?.reason || null,
    },
    activity: {
      complete: activityComplete,
      reason: activity?.reason || null,
    },
    verification: {
      ran: verificationRan,
      checked: Number.isFinite(verification?.checked) ? verification.checked : 0,
      queued: Number.isFinite(verification?.queued) ? verification.queued : 0,
      remaining: verificationRemaining,
    },
    // The activity window is the one precondition both exports already share:
    // without it, "zero posts in the window" isn't a meaningful verdict for
    // any member, confirmed or not.
    actionable: activityComplete,
    caveats: [
      !rosterComplete ? "roster-partial" : null,
      verificationRan && verificationRemaining > 0 ? "verification-remaining" : null,
    ].filter(Boolean),
  };
}

// The confirmed-only export's specific safety gate: every row it contains
// already went through a direct search (that's what "confirmed-inactive"
// means structurally, see classifySearchVerification), so the only thing
// left to check is the same activity-window precondition the broad export
// needs. Kept as its own function, rather than inlined at the call site, so
// the rule has one place to change and one place to unit test.
export function determineActionability(summary) {
  if (!summary?.activity?.complete) {
    return { safe: false, reason: "activity-window-incomplete" };
  }
  return { safe: true, reason: null };
}
