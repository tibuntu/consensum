---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(jq:*)
description: Push the current plan to a Consensum instance for team review (returns control immediately).
---

Post a plan to Consensum for asynchronous team review, then return control to the user (do NOT block waiting for feedback).

Requires env vars: `CONSENSUM_BASE_URL` (e.g. http://localhost:3000) and `CONSENSUM_API_TOKEN` (from Consensum → Settings → API tokens).

Optional env vars, honored as defaults for every push: `CONSENSUM_REVIEWERS` (comma-separated emails, e.g. `alice@x.com:required,bob@x.com` — the `:required` suffix marks a must-approve reviewer), `CONSENSUM_TAGS` (comma-separated tag names, e.g. `infra,security`), and `CONSENSUM_REQUIRE_BLOCKER_RESOLUTION` (`1`/`true`/`yes` to gate approval on every BLOCKER thread being resolved).

1. Determine the plan markdown: if `$ARGUMENTS` names a file, read it; otherwise use the most recent plan / your last assistant message. `$ARGUMENTS` may also carry `--reviewers a@x.com,b@x.com:required` and/or `--tags infra,security`, which override `CONSENSUM_REVIEWERS`/`CONSENSUM_TAGS` for this push only (same comma-separated syntax as the env vars).
2. Determine a title (first heading of the plan, else "Plan").
3. POST it. Send an `Idempotency-Key` header so a retry never creates a duplicate plan — use a stable value derived from the content (e.g. a short hash of `<title>` + `<markdown>`). Optionally include `agentContext` (free-form context that is echoed back in later feedback so you can recover it after a multi-day review) and `requiredApprovals` (integer 1–10). Capture the HTTP status:
   `curl -s -w '\n%{http_code}' -X POST "$CONSENSUM_BASE_URL/api/plans" -H "Authorization: Bearer $CONSENSUM_API_TOKEN" -H 'content-type: application/json' -H "Idempotency-Key: <stable-key>" -d "$(jq -n --arg t "<title>" --arg m "<markdown>" '{title:$t, markdown:$m}')"`
   Tip: for a multi-line or quote-bearing plan, write the markdown to a temp file and build the body with `jq -n --arg t "<title>" --rawfile m plan.md '{title:$t, markdown:$m}'` so shell quoting can't mangle it.
   If reviewers or tags apply (from env or `--reviewers`/`--tags`), add them as JSON arrays with `--argjson`, e.g. `jq -n --arg t "<title>" --rawfile m plan.md --argjson r '[{"email":"alice@x.com","required":true},{"email":"bob@x.com","required":false}]' --argjson g '["infra","security"]' '{title:$t, markdown:$m, reviewers:$r, tags:$g}'`.
4. **Check the status code.** On `201` (created) or `200` (idempotent replay of an earlier identical push), parse `{ id, reviewUrl }` and print both: "Plan posted for review: <reviewUrl> (id <id>). I'll resume when you run /consensum-pull-feedback <id>." If the response includes `reviewers[]`, print any entry whose `status` is not `"added"` (e.g. `no_account`) so the user knows who wasn't reached. On any non-2xx — e.g. `401` (bad/expired token), `403` (token missing the `plans:write` scope), `413` (plan markdown too large) — tell the user the push **failed**, with the status and error body, and do NOT claim it succeeded or invent an id.
5. Return control. Do not poll.
