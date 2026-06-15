---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(jq:*)
description: Push the current plan to a Consensum instance for team review (returns control immediately).
---

Post a plan to Consensum for asynchronous team review, then return control to the user (do NOT block waiting for feedback).

Requires env vars: `CONSENSUM_BASE_URL` (e.g. http://localhost:3000) and `CONSENSUM_API_TOKEN` (from Consensum → Settings → API tokens).

1. Determine the plan markdown: if `$ARGUMENTS` names a file, read it; otherwise use the most recent plan / your last assistant message.
2. Determine a title (first heading of the plan, else "Plan").
3. POST it:
   `curl -s -X POST "$CONSENSUM_BASE_URL/api/plans" -H "Authorization: Bearer $CONSENSUM_API_TOKEN" -H 'content-type: application/json' -d "$(jq -n --arg t "<title>" --arg m "<markdown>" '{title:$t, markdown:$m}')"`
4. Parse the JSON `{ id, reviewUrl }` and print both to the user: "Plan posted for review: <reviewUrl> (id <id>). I'll resume when you run /consensum-pull-feedback <id>."
5. Return control. Do not poll.
