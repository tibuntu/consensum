---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull a Consensum plan into this session and optionally claim ownership (handover).
---

Pull a plan someone else authored — e.g. a colleague who is out sick or on
vacation — into this session, and optionally take it over so the normal
revision loop works from here.

Requires env vars: `CONSENSUM_BASE_URL` and `CONSENSUM_API_TOKEN`.
`$ARGUMENTS` is a plan id or a review URL (for a URL like
`…/documents/<id>`, the id is the last path segment). An optional `--claim`
anywhere in the arguments claims ownership without asking.

1. Resolve the plan id from `$ARGUMENTS`, then pull the plan:

   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```

   The response is `{ id, title, state, markdown, versionNumber,
   agentContext, role, archived }`. On 404 the plan does not exist or the
   token's user has no access (PRIVATE visibility) — say so and stop.

2. Write `markdown` to `docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md`,
   where the slug is derived from `title` (lowercase, spaces → `-`).
   Report `title`, `state`, `versionNumber`, and `agentContext` — the
   agentContext is the original author's handover context; read it before
   doing anything else.

3. **Ownership.** If `role` is already `OWNER`, skip to step 4. Otherwise
   the caller cannot revise or pull feedback (both are owner-gated):

   - If `--claim` was passed, claim immediately. Otherwise ask the user:
     "You're a REVIEWER on this plan. Claim ownership to revise it and pull
     feedback? The current owner keeps access as a reviewer and is
     notified."
   - To claim:

     ```
     curl -s -X POST "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID/claim" \
       -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
     ```

     200 → the caller is now OWNER. 409 → already owner, the document is
     archived, or a concurrent claim won — report the `error` field and
     stop. Without a claim, stop here: present the plan content and note
     that feedback/revision require ownership.

4. Pull the current feedback state:

   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/$PLAN_ID/feedback?include=blocking,unresolved&exclude=orphaned" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```

   Summarize the rollup (decision, `mustResolve`, unresolved counts) the
   same way `/consensum-pull-feedback` does.

5. Hand off: from here the plan behaves like one pushed from this session —
   use `/consensum-pull-feedback $PLAN_ID` for the human-in-the-loop cycle
   or `/consensum-loop $PLAN_ID` for autonomous operation.

Scope note: this hands over the *plan document*, not session state. Task
files and implementation progress from the original author's machine do not
travel.
