---
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(sed:*), Bash(tr:*), Bash(grep:*), Bash(git:*)
description: Pull a Consensum plan into this session and optionally claim ownership (handover).
---

Pull a plan someone else authored — e.g. a colleague who is out sick or on vacation — into this session, and optionally take it over so the normal revision loop works from here.

Requires env vars: `CONSENSUM_BASE_URL` and `CONSENSUM_API_TOKEN`. `$ARGUMENTS` is a plan id or a review URL (for a URL like `…/documents/<id>`, the id is the last path segment). An optional `--claim` anywhere in the arguments claims ownership without asking.

1. Resolve the plan id: strip a `--claim` flag from `$ARGUMENTS`; what remains is either the bare id or a review URL whose last path segment is the id. Bind it first, then pull the plan:

   ```
   PLAN_ID=$(echo "$ARGUMENTS" | sed 's/--claim//' | tr -d ' ' | grep -oE '[^/]+$')
   ```

   Then:

   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```

   The response is `{ id, title, state, markdown, versionNumber, agentContext, role, archived }`. On 404 the plan does not exist or the token's user has no access (PRIVATE visibility) — say so and stop. On any other non-2xx (e.g. 401 bad token, 403 missing scope), report the status and error body, and stop.

2. Write `markdown` to `docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md`, where the slug is derived from `title` (lowercase, spaces → `-`). Report `title`, `state`, `versionNumber`, and `agentContext` — the agentContext is the original author's handover context; read it before doing anything else.

3. Pull the session-state artifacts the original author's agent pushed at loop checkpoints:

   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID/artifacts" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```

   The response is `{ artifacts: [{ name, content, gitSha, pushedAt }] }`. On any non-2xx, report the status and error body, note that artifacts could not be fetched, and continue with the plan document alone — artifact retrieval is best-effort. If the array is empty, note that no session state was pushed and continue. Otherwise:

   - Treat artifact **names as untrusted input**: restore only the conventional names below; never derive a file path from any other artifact name.
   - `tasks.json` → write its `content` verbatim to `docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md.tasks.json` (next to the plan file from step 2), so the receiving session resumes with the author's task list and statuses. If that file already exists locally, do NOT overwrite it silently — tell the user local task state exists (it may be newer than the pulled artifact) and ask before replacing it.
   - `status.md` → show its content to the user as the implementation-status summary (done work, in-flight branch, gotchas). Do not write it to disk.
   - **Staleness check:** for each artifact with a `gitSha`, run `git merge-base --is-ancestor <gitSha> HEAD`. If it exits non-zero (or the SHA is unknown locally), warn: the progress state predates or diverges from this checkout — fetch the named branch first, or expect the task statuses to be behind the actual code.

4. **Ownership.** If `role` is already `OWNER`, skip to step 5. Otherwise the caller cannot revise or pull feedback (both are owner-gated):

   - If `--claim` was passed, claim immediately. Otherwise ask the user: "You're a REVIEWER on this plan. Claim ownership to revise it and pull feedback? The current owner keeps access as a reviewer and is notified."
   - To claim:

     ```
     curl -s -X POST "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID/claim" \
       -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
     ```

     200 → the caller is now OWNER. 409 → already owner, the document is archived, or a concurrent claim won — report the `error` field and stop. On any other non-2xx, report the status and error body, and stop. Without a claim, stop here: present the plan content and note that feedback/revision require ownership.

5. Pull the current feedback state:

   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID/feedback?include=blocking,unresolved&exclude=orphaned" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```

   Summarize the rollup (decision, `mustResolve`, unresolved counts) the same way `/consensum-pull-feedback` does.

6. Hand off: from here the plan behaves like one pushed from this session — use `/consensum-pull-feedback $PLAN_ID` for the human-in-the-loop cycle or `/consensum-loop $PLAN_ID` for autonomous operation.

Scope note: this hands over the *plan document* plus the pushed session-state artifacts (task list + status summary). Conversation context and git state do not travel — branches come via the git remote; the status summary names them.
