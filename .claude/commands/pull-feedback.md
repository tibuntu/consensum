---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Quorum AI plan and revise accordingly.
---

Wait for a team decision on a plan, then revise. This blocks via long-poll instead of one-shot polling, so an agent (or CI) can wait for humans to decide rather than re-running by hand.

Requires env vars: `QUORUM_BASE_URL` and `QUORUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. Wait loop — up to 10 iterations, each a ~30s long-poll. The server holds the connection open until the decision/state changes, then returns the feedback body with a `timedOut` flag (HTTP 200 even on timeout):

   ```
   for i in 1..10:
     resp=$(curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback/wait?timeoutMs=30000" \
       -H "Authorization: Bearer $QUORUM_API_TOKEN")
     decision=$(echo "$resp" | jq -r .decision)
     if [ "$decision" = "approved" ] || [ "$decision" = "changes_requested" ]; then
       break   # terminal — stop waiting
     fi
     # decision == "pending" (timed out, or a non-terminal change such as a new version): re-arm
   ```

2. If the loop exhausts all 10 iterations with `decision` still `"pending"`: tell the user the plan is still pending after 10 waits (~5 minutes) and stop. Do not block indefinitely.
3. Parse the final response `{ decision, state, markdown, threads, reviews }`.
4. Present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
