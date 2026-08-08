# Privacy

Community Activity Lite has no analytics, advertising, telemetry, developer
server, remote configuration, or third-party API integration.

The extension detects the member-pagination request used by the visible X
Members page, retrieves roster pages directly from x.com, and uses the existing
x.com login to count Community posts. If cursor pagination is unavailable, it
reads visible usernames from the Members page instead. The `ct0` cookie is read
only to supply X's CSRF request header. Cookies and tokens are never logged or
exported.

During operation discovery, the extension may observe URLs matching
`https://x.com/i/api/graphql/*` while reloading the visible Members page. This
is used only to identify the current operation ID and its public query
variables. When Chrome exposes request headers, the extension selects only the
`x-client-transaction-id` value needed to replay the same live operation; it
does not select, log, store, or export cookie, authorization, or CSRF headers.
Response bodies are parsed in memory for the requested roster/activity fields
and are never logged or exported in full.

The Community ID, lookback, threshold, focus-lock preference, and successful
cursor roster pages are saved in `chrome.storage.local`. Roster pages include
public account identifiers, usernames, display names, Community roles, and
protected-account status. These checkpoints let an interrupted scan resume.
Post-analysis cursors, author counters, and completed flagged results are also
saved locally so a closed side panel can resume or restore the last scan.
Activity-window completeness is stored separately from the optional historical
author-backfill state so a partial backfill cannot be mistaken for incomplete
activity coverage.

Latest, Media, and Community-search author archives use separate local
checkpoints. Search uses a fixed set of common terms and sends those queries
only to X through the signed-in browser session. These additional responses are
handled under the same no-telemetry and no-response-body-export rules.

The extension also stores a compact confirmed-member archive keyed primarily
by stable X user ID. It retains first and last confirmation timestamps,
snapshot sightings, protected-account state, and discovery categories across
scans. This archive measures accumulated coverage only: historical records are
not silently reintroduced into current removal results. Exact membership
verification keeps a separate local pending queue and removes candidates after
X returns a checked result.

Detected private-account results are stored as soon as roster collection
finishes, and are updated if later Community-author evidence adds records. The
separate export therefore remains available after stopping or reopening the
panel without waiting for post analysis. This storage is restricted to trusted
extension contexts. CSV and text files are created only when the user selects
an export button.

Requests go directly from the browser to `https://x.com`. No scan data is sent
to another service. The extension has no third-party roster-service host
permission and accepts no external API token.

Uninstalling the extension removes its saved settings under normal Chrome
behavior; exported CSV files remain under the user's control.
