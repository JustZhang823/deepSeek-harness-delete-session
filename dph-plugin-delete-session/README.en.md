# Delete Session

A DeepSeek Harness (DSH) session-management plugin that adds true, irreversible deletion beside the existing **Archive** action.

- **Archive** hides a session from the sidebar. Its log, messages, workspace slot, and archive record stay intact and can be restored.
- **Delete** permanently removes the selected session: its log, messages, tool calls, checkpoints, derived projection cache, workspace membership, archive entry, and pin. It cannot be restored through DSH.

---

## 1. What it adds

| Capability | Where | Notes |
|---|---|---|
| Delete one session | Sidebar session context menu / More menu → **Delete session** | Uses the existing `sidebar.workspaces.session.menu.item` extension slot; does not replace the built-in Archive item. |
| Impact preview | Opens by default after clicking Delete session | Shows title, event count, log size, creation time, working directory, archived/pinned state, and child-session count. When confirmation is disabled, the menu submits deletion directly without opening the preview. |
| Confirmation by default | Confirmation dialog | In confirmation mode, the user must check “I understand this cannot be undone” and then press **Delete permanently**. |
| Skip future confirmation dialogs | “Do not show the deletion confirmation again” in the dialog | Initially unchecked; saved only after an acknowledged deletion succeeds. Subsequent **Delete session** menu clicks submit deletion directly. |
| Restore confirmation | Session menu → **Restore delete confirmation** | Appears when confirmation is disabled; immediately restores the dialog on this page and saves the preference. |
| Deletion guards | Host + Client checks | The Host always requires `confirm: true`, a trusted page request, and a per-process token. Disabling confirmation changes only the Client interaction. |
| Running-work guard | Reuses `workspace/session-activity` | The same gate Archive uses: running turns, subagents, background jobs, and schedules block deletion. |
| Delete an idle loaded session | Same Delete entry | No session switch or restart is needed. Deletion safely releases the Agent and log writer, then acquires exclusive write ownership before deleting. |

The UI follows the active DSH locale (English and Chinese are included).

---

## 2. Install and enable

This is a local DSH bundle. The Host half provides the deletion service and a same-origin HTTP bridge; the Client half registers the menu row and dialog. It has no third-party runtime dependencies and no build step.

### Recommended: Plugin Manager / agent

Use the absolute package directory:

```text
/Users/zhangjiayi/dph-plugin-delete-session
```

Call Plugin Manager's `install_bundle` with that absolute path as `target`. A successful result contains:

```json
{
  "application": "applied",
  "bundle": "@local/dsh-session-delete",
  "version": "1.0.0",
  "warnings": []
}
```

### Web UI

1. Open DSH Web UI → **Plugins**.
2. Confirm **Delete sessions** is listed (red trash-can icon).
3. Enable it if the switch is off.
4. **Refresh the page** so the new Client bundle loads.

### Self-check

- Client `Slots.listSubTree`:
  - `sidebar.workspaces.session.menu.item` contains `id: "dsh-session-delete"`;
  - `shell.overlay` contains `id: "dsh-session-delete-dialog"`.
- The session context menu shows **Delete session**.
- `GET /api/dsh-session-delete/token` is reachable from the local page.

> If the Host is active but the menu row is missing, refresh the page. If it is still missing, check that the bundle is enabled and that the page is served by this local DSH Web server.

Reload the page after updating the plugin so the new Client bundle loads. The desktop `dsh-app://app/` page accesses the Host through a proxy that removes `Origin` / `Sec-Fetch-Site` and adds a Host-issued login cookie. The plugin validates these requests through the Host's `connection` service rather than requiring those headers.

---

## 3. Usage

1. Open a session's context menu or More menu.
2. Click **Delete session**.
3. By default, a confirmation dialog opens. Review its title, event count, log size, creation time, working directory, archived/pinned state, and any child-session warning.
4. If a red blocked notice appears (for example, the session is running or undergoing maintenance), resolve it and press **Check again**. An idle session that is merely loaded by an Agent can be deleted directly after reviewing the release notice; no session switch or restart is needed.
5. Check **I understand this cannot be undone**.
   Clicking **Delete permanently** while unchecked highlights and briefly shakes the acknowledgement, shows a reminder, and focuses the checkbox without sending a delete request. Reduced-motion preferences disable the shake.
   Optionally also check **Do not show the deletion confirmation again** (initially unchecked) to delete directly in the future.
6. Press **Delete permanently**.
7. The row disappears after success. If cleanup warnings appear, follow them (refresh the page or restart DSH).

### Direct deletion and restoring confirmation

“Do not show the deletion confirmation again” takes effect only after this acknowledged deletion succeeds. It is saved in the current client/browser's `localStorage` and survives page reloads and client restarts. Cancellation, an unchecked acknowledgement, or failed deletion does not change the preference. If deletion succeeds but saving the preference fails, both deletion success and the unsaved-preference notice are shown.

Once enabled, clicking **Delete session** submits deletion directly without a confirmation or preview dialog. Success uses a nonmodal toast; errors and cleanup warnings use persistent, dismissible nonmodal alerts. Host authentication, activity checks, safe release, exclusive write ownership, and storage validation still run.

To restore the dialog, select **Restore delete confirmation** in the same session menu. Even if saving this reset fails, confirmation is restored immediately on the current page and an unsaved-preference notice is shown.

---

## 4. Preconditions

Deletion runs only when all of these hold:

1. **Host plugin active**: `webServer`, `sessionPersistence`, and `connection` are available.
2. **Session exists**: `sessionPersistence.stat(sessionId)` returns a snapshot.
3. **Loaded sessions can be released safely**: an idle Agent does not prevent deletion, including for the currently viewed session. The Host must use the supported Agent lifecycle teardown to drain and close the log writer, detach the Agent / Session, and acquire exclusive persistence write ownership. If this cannot be completed safely, deletion is refused and the log is kept.
4. **No running work**: `workspace/session-activity` returns an empty list (running turn, subagent, background job, or schedule).
5. **Materialized log**: the snapshot has a `location`; a pending, never-materialized session is refused.
6. **Supported layout**: `location.kind === "jsonl"`, the log file matches `session.jsonl` / `session.vN.jsonl` (optionally `.zstd`), and the containing directory leaf name equals the session id.
7. **User-initiated deletion**: in the default confirmation mode, the Client acknowledgement is checked. With a saved preference to skip confirmation, the user submits directly from the menu. The Host requires `confirm: true` in both cases.
8. **Trusted page + valid token**: HTTP pages pass same-origin checks. Desktop proxy requests without `Origin` and `Sec-Fetch-Site` must have a Host-validated login cookie identifying the browser Peer. Both paths must pass the Host check and carry the current per-process token.

> Delete does **not** stop running work. This keeps deletion from becoming an implicit stop action. Stop or archive the session through the existing flow, then delete it.

---

## 5. What is deleted, and what is kept

The deletion boundary is the session-owned log directory. The Host first safely releases any idle loaded session, acquires exclusive persistence write ownership, and rechecks activity. It then deletes the irreversible log and cleans derived/rebuildable metadata. The exclusive write lease is closed when the operation ends.

### Permanently deleted

| Data | Detail |
|---|---|
| Session log directory | `session.jsonl` / `session.vN.jsonl` / `session.vN.jsonl.zstd` and `session.lock` in the session-owned directory. |
| Messages | User/assistant/system messages, reasoning text, tool calls, and tool results. |
| Checkpoints and historical generations | Retained format generations, compressed frames, and checkpoint data in that directory. |
| Derived projection cache | Removed through `storageDomain`'s `session_projcache.sessions` table; other sessions are untouched. |
| Workspace membership | Removed from every workspace's `sessionIds`. |
| Archive and pin | Removed from `archivedSessionIds` and `pinnedSessionIds`; no dangling ids remain. |
| Sidebar row | The Host emits `api-session/removed`; connected Clients drop the row. |

### Kept

| Data | Why |
|---|---|
| Child sessions and their logs | Only the selected session is deleted. Child sessions remain, but their parent link points to a missing session. |
| Attachment objects | DSH attachments are content-addressed and may be shared by other sessions; the plugin does not delete them. |
| The working directory itself | Deleting a session never deletes project files. |
| Third-party derived data | For example, a third-party cost/statistics ledger; it is outside the session-management deletion boundary. |
| Full-text search index | The `session-query` SQLite index is derived and reconciles on the next search/restart. No manual action is required. |

### Ordering rationale

Releasing a loaded session precedes file deletion. Only recognized Agent lifecycle teardown drains and closes the writer and detaches the Agent / Session; disposing a scope alone is not treated as proof that the writer has closed. Exclusive persistence write ownership and another activity check are required before these steps:

1. Delete the projection cache first. It is derived and rebuilds if log deletion fails.
2. Delete the log directory. If this irreversible step fails, workspace/archive/pin are untouched and any undeleted logs remain. Agent release events may temporarily remove the sidebar row; refresh the list to reopen or retry.
3. Clean workspace membership, archive, pin, and emit the removal event. These are idempotent; failures are returned as `warnings` and reconcile on the next restart.

---

## 6. Failure scenarios and expected results

| Scenario | Response | Data result |
|---|---|---|
| Session does not exist | `NOT_FOUND`; dialog says it no longer exists | Nothing deleted. |
| Session is loaded by an Agent but idle | Release notice in confirmation mode; saved direct-deletion mode is also supported, without switching sessions or restarting | Safely releases the Agent / Session and writer, then acquires exclusive write ownership before deletion. |
| Running turn / subagent / job / schedule | `ACTIVE`; dialog lists activity | Nothing deleted. |
| Session is undergoing maintenance, or new work starts during confirmation | `ACTIVE`; stop or wait for that work, then check again | Session log kept. |
| Unsupported lifecycle version or missing Host release/exclusive-write interfaces | `AGENT_RELEASE_UNAVAILABLE`; deletion does not continue | Session log kept. |
| Failed release, unavailable exclusive write ownership, or a session reopened during deletion | `AGENT_RELEASE_FAILED`; clear release/locking error | Session log kept. If Agent release temporarily removed the sidebar row, refresh the list to reopen or retry. |
| Another deletion request for the same session is in progress | `DELETE_IN_PROGRESS` | No second deletion starts; wait for the existing request. |
| Session not yet materialized | `NOT_MATERIALIZED` | Nothing deleted. |
| Non-JSONL storage or unexpected layout | `UNSUPPORTED_STORAGE` / `UNEXPECTED_LAYOUT` | Refused; the plugin never guesses a path. |
| Unchecked acknowledgement in confirmation mode, or missing `confirm: true` at the Host | Client focuses the acknowledgement and shows a reminder; Host returns `CONFIRMATION_REQUIRED` for an unconfirmed request | Nothing deleted; the saved confirmation preference is unchanged. |
| Deletion succeeded, but saving the confirmation preference failed | Both deletion success and an unsaved-preference notice | Deletion remains successful; subsequent actions follow the previously saved preference. |
| Stale page token (for example after Host HMR) | Client refreshes the token once; then asks for a page refresh | Nothing deleted. |
| Untrusted page origin or invalid desktop proxy credentials | `FORBIDDEN_ORIGIN`; distinct origin/desktop authorization error without token refresh retries | Nothing deleted. Repeated page refreshes cannot fix an origin configuration issue. |
| Missing token | `FORBIDDEN_TOKEN`; Client obtains a new token and retries once | Nothing deleted unless validation succeeds. |
| Cannot obtain a token from the Host | `TOKEN_UNAVAILABLE`; distinct token acquisition error | Nothing deleted; check that the Host plugin is active. |
| File in use, permission denied, Windows lock, I/O error | `DELETE_FAILED` with the reason | The log may not be deleted; workspace/archive/pin were not touched because log deletion runs before them. The projection cache may be gone and will rebuild on the next open. Retry after fixing the cause. |
| Log deleted, but metadata cleanup fails | Success with `warnings` | Session data is gone; residual metadata reconciles on the next restart or page refresh. |
| Deletion succeeded, but closing the exclusive write lease failed | Success with `WRITE_LEASE_RELEASE_FAILED` warning | The session log was deleted. Retain the warning's reason for diagnosis; it does not mean deletion was skipped. |
| Log path still exists after deletion | Success with `VERIFY_FAILED` | Inspect filesystem permissions/locks; the session may still be visible to external tools. |

### Expected success

- The row disappears from the sidebar.
- The session cannot be opened, resumed, forked, or continued.
- The session log directory is gone.
- Workspace `sessionIds`, archive set, and pin set no longer contain the id.
- The projection-cache record is gone.
- Other sessions, child sessions, attachments, and the working directory are unaffected.

---

## 7. Compatibility

- **Web / desktop clients**: supports local HTTP pages and desktop `dsh-app://app/` pages. The Host's `connection.admit()` validates desktop proxy credentials and must return the browser Peer; API/operator Peers do not authorize page requests.
- **Agent lifecycle**: automatic release of idle loaded sessions adapts the lifecycle metadata shape in the currently shipped Cordis / AgentLoop. Unsupported shapes are refused; scope disposal alone never substitutes for closing the writer. “Release session” means closing the writer and unregistering the runtime Agent / Session. The Host exposes neither an unload-by-id API nor an AgentHandle lookup; its creator lifecycle closure may retain memory references until the owning controller unloads or the Host restarts, so immediate heap reclamation is not guaranteed.
- **macOS / Windows**: only `node:fs/promises`, `node:path`, and `node:crypto`; no `rm -rf`, PowerShell, or shell. Path separators and Windows case-insensitive directory names are handled.
- **Windows file locks**: `fs.rm` uses `maxRetries: 3` and `retryDelay: 100`; a persistent failure returns a clear error instead of retrying forever.
- **Symlink protection**: the log directory must be a real directory, not a symlink; its leaf must equal the session id; the log file must match the supported JSONL naming.
- **Storage backend**: supports the shipped JSONL session-persistence layout only (`location.kind === "jsonl"`). If DSH changes the backend, deletion refuses instead of guessing.
- **No third-party runtime dependencies**: the Host uses injected DSH services; the Client uses the page-provided React and Cordis services.

---

## 8. Security

- Deletion is a user action. The plugin registers **no Agent tool**, so the model cannot invoke it.
- The preference to skip confirmation is local to the current client/browser. It starts disabled and is saved only after the user selects it and completes an acknowledged deletion successfully. It does not bypass any of the Host checks below.
- The Host route requires the bound Host authority (including loopback aliases). A supplied browser `Origin` must match the request's protocol and authority, and `Sec-Fetch-Site`, when present, must be `same-origin`.
- When both browser headers are absent, `connection.admit(req)` must validate the Host-issued cookie and return `connection.browserPeer`. Missing/invalid credentials or an unavailable admission service are refused; the mere presence of a cookie is insufficient.
- All deletion requests still require a random 32-byte per-process token, `Content-Type: application/json`, a 64 KiB body limit, and `confirm: true`.
- Session ids are whitelisted and must match the log directory leaf; path traversal and arbitrary path deletion are refused.
- The Host drains and closes an idle loaded Agent's writer, detaches the Agent / Session, acquires exclusive persistence write ownership, and rechecks activity before deletion. Running work or maintenance still blocks deletion. The write lease closes when the operation ends.

---

## 9. Uninstall

Disable or uninstall **Delete sessions** in Plugin Manager. Uninstalling removes the menu and route only; it does not restore already-deleted sessions or delete other sessions' data.

---

## 10. Files

| File | Role |
|---|---|
| `index.js` | Host half: deletion service, `/api/dsh-session-delete` same-origin route, token, plan/delete endpoints. |
| `session-files.js` | Path validation and `fs.rm` deletion. |
| `agent-lifecycle.js` | Lifecycle recognition, safe idle-Agent release, and log-writer teardown adapter. |
| `client.js` | Client half: menu row, confirmation dialog, direct-deletion preference and reset, nonmodal feedback, token fetch, English/Chinese strings. |
| `cordis.patch.yml` | Bundle Loader patch inserting the `dsh-session-delete` row. |
| `locale/en.json`, `locale/zh.json` | Plugin Manager display metadata. |
| `icon.svg` | Plugin icon. |
| `test/session-files.test.mjs`, `test/service.test.mjs` | Path-safety and service unit tests. |
| `test/bridge.test.mjs` | HTTP same-origin checks, desktop proxy admission, and deletion-token regression tests. |
| `test/client.test.mjs` | Client messages, confirmation/direct-deletion preferences, nonmodal feedback, and stale-token retry regression tests. |
| `test/agent-lifecycle.test.mjs` | Agent lifecycle recognition, teardown order, and unsupported/failed release tests. |

---

## 11. Verification status

- JavaScript syntax checks passed for `index.js`, `agent-lifecycle.js`, and `client.js`.
- Electron's Node runtime ran the full suite with `--test test/*.test.mjs`: 84/84 tests passed, including subtests covering confirmation preferences, saving after success, direct deletion after reload, duplicate-click protection, restoring confirmation, storage-failure fallback, and nonmodal feedback.
- The currently installed plugin, linked to this source directory, was reloaded by disabling and enabling its component through Plugin Manager and was confirmed running.
- The actual desktop `dsh-app://app/` page's idle-loaded release notice and Delete preview were verified. In the “嗅觉异常咨询” dialog, clicking **Delete permanently** while unchecked showed a reminder and focused the still-unchecked checkbox without deleting the session. Regression tests cover repeated reminders, clearing the reminder when checked, and submitting once after confirmation.
- The latest desktop dialog displays the skip-confirmation checkbox and explains that it takes effect after this deletion succeeds. Both checkboxes start unchecked; direct deletion was not enabled or executed on a real user session during verification.
- No real user session was deleted. Temporary test fixtures verified directory deletion and lifecycle teardown order.
- Dark theme and Windows have not been tested live.
