# Agent integration

The hero loop is driven by three Claude Code slash commands shipped in
[`plugins/consensum/commands/`](../plugins/consensum/commands/):
[`/consensum-push-plan`](../plugins/consensum/commands/consensum-push-plan.md),
[`/consensum-pull-feedback`](../plugins/consensum/commands/consensum-pull-feedback.md), and
[`/consensum-pull-plan`](../plugins/consensum/commands/consensum-pull-plan.md). They talk
to your instance via the machine API.

## Install

Install via the in-repo Claude Code plugin marketplace:

```
/plugin marketplace add tibuntu/consensum
/plugin install consensum@consensum                                   # slash commands, user scope
/plugin install consensum-review-gate@consensum --scope project       # optional auto-proceed hook, per project
```

Plugins are versioned and update with the marketplace, unlike a one-time copy.

### Without plugins

Install the commands with the one-liner (no checkout needed):

```bash
# Slash commands → ~/.claude/commands (available in every repo)
curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash

# …and the opt-in auto-proceed hook into the current project's ./.claude
curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash -s -- --with-hook
```

From a checkout, run the same script locally: `./scripts/install.sh [--with-hook]`.

### Point the commands at your instance

Whichever route you used, the commands and the hook read two env vars:

```bash
export CONSENSUM_BASE_URL="http://localhost:3000"
export CONSENSUM_API_TOKEN="<token from Settings → API tokens>"
```

Optionally, set these to route every pushed plan to the right people by default:

```bash
export CONSENSUM_REVIEWERS="alice@x.com:required,bob@x.com"   # comma-separated emails; ":required" marks a must-approve reviewer
export CONSENSUM_TAGS="infra,security"                         # comma-separated tag names applied to every push
export CONSENSUM_REQUIRE_BLOCKER_RESOLUTION="true"             # "1"/"true"/"yes": gate approval on every BLOCKER thread being resolved
```

`/consensum-push-plan` posts the current plan and returns a review URL. Once the team weighs
in, `/consensum-pull-feedback <id>` pulls the consolidated verdict, threads, and digest back
so the agent can revise.

## Auto-proceed (hands-off loop)

For a fully hands-off loop — the agent waits for the verdict and **proceeds on its own**
once approved — Consensum ships a Claude Code hook on the `ExitPlanMode` tool
([`consensum-exit-plan.mjs`](../plugins/consensum-review-gate/hooks/consensum-exit-plan.mjs)).
The `consensum-review-gate` plugin registers it on both events via its
[`hooks/hooks.json`](../plugins/consensum-review-gate/hooks/hooks.json); the `--with-hook`
script route (installing the same script into your project's `.claude/hooks/` and
jq-merging the registration into that project's `.claude/settings.json`) and manually
editing `.claude/settings.json` remain for projects not using plugins. When the agent
finishes planning, the hook **blocks inside the plan-exit call**: it pushes the plan,
waits on `/feedback/wait`, and then

- **Approved** → returns `allow`; the agent exits plan mode and implements automatically.
- **Changes requested** → returns `deny` with a consolidated feedback digest; the agent
  revises and re-presents the plan, which re-fires the hook (PATCHing a new version) —
  that's the loop.

State is scoped per Claude Code `session_id`, so a new session opens a new review while a
re-presented plan revises the same one. (Session state persists in a git-ignored
`.consensum/`.) With no `CONSENSUM_API_TOKEN` set the hook **fails closed** — it blocks
plan-mode exit rather than shipping an unreviewed plan. Set `CONSENSUM_SKIP=1` (or omit
`--with-hook`) on projects that don't use Consensum review; `CONSENSUM_SKIP=1` bypasses
both hook events whether or not a token is set.

### Coexisting with other ExitPlanMode hooks

Claude Code runs **all** matching `PermissionRequest` hooks **in parallel**, and the merge
rule for conflicting decisions is **undocumented** ([hooks
reference](https://code.claude.com/docs/en/hooks)). In practice another hook's instant
`allow` can win the race over Consensum's still-polling gate — observed with
[plannotator](https://plannotator.ai) 0.22.0, whose "approve and continue" auto-mode
allows `ExitPlanMode` immediately, starting implementation with zero review.

That's why `--with-hook` registers the same script on a second event: a **`PostToolUse`
backstop** that fires after plan mode actually exits, regardless of which hook allowed it.

- If the Consensum gate already approved this **exact plan content** (a sha256 handshake
  recorded in `.consensum/loop-state.json`), the backstop passes silently — no second
  review, no extra server calls.
- Otherwise (a competing hook won the race, or the content was rewritten on the way
  through), it runs the same push-and-wait gate and, unless approved, emits
  `{"decision": "block", "reason": …}` with the feedback digest and explicit
  do-not-implement instructions, so the agent revises instead of implementing.

The backstop is deliberately weaker than a permission deny — plan mode has already
exited, so it prevents *silent* unreviewed implementation rather than re-creating the
plan-mode loop. Whether Claude Code kills the losing parallel hook process is also
undocumented; the design tolerates both outcomes (idempotent plan create, optimistic-lock
re-sync on PATCH, atomic last-writer-wins state writes). Every fail-closed `deny` on the
gate has a matching fail-closed `block` on the backstop (missing token, push failure,
plan deleted mid-review, wait-window expiry, unexpected error).

For plans pushed **outside** plan mode,
[`/consensum-loop <id> [intervalMinutes]`](../plugins/consensum/commands/consensum-loop.md) does
the same wait-then-act loop on demand.

> **Permission mode is not auto-applied.** A team-chosen "implement with Accept Edits / Auto"
> setting is intentionally **deferred**: Claude Code does not let a hook switch the session's
> permission mode on approval
> ([claude-code#14044](https://github.com/anthropics/claude-code/issues/14044), closed as
> not-planned). The agent implements under whatever mode the session is already in.

> **Compatibility:** the hook uses the same `ExitPlanMode` `PermissionRequest` handshake as
> [plannotator](https://plannotator.ai), plus the documented top-level `PostToolUse` block
> shape; if your Claude Code version changes either, adjust
> `allowPayload`/`denyPayload`/`postBlockPayload` in `consensum-hook-core.mjs`.

## Machine API surface

Bearer token, owner-scoped:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/plans` | Push a plan; returns `{ id, reviewUrl }`. Optional `reviewers` (array of emails or `{email, required}`, max 20) and `tags` (array of strings, max 20) route the plan to reviewers and apply tags on create — the response echoes `reviewers: [{email, status}]` (`status` is `"added"` or an error like `"no_account"`) and `tags: [...]` when supplied. An idempotent replay (repeated key) does not re-apply either. Scope `plans:write`. |
| `PATCH /api/plans/[id]` | Post a revised version (optimistic-locked on `baseVersionNumber`). Scope `plans:write`. |
| `GET /api/plans/[id]` | Pull a plan: `{ id, title, state, markdown, versionNumber, agentContext, role, archived }`. `versionNumber` is the `baseVersionNumber` for a later `PATCH`; `role` tells the caller whether a claim is needed. Scope `feedback:read`. |
| `POST /api/plans/[id]/claim` | Take over a plan (REVIEWER only): swaps ownership to the caller, demotes the previous owner to REVIEWER, and notifies them. 409 when already owner, archived, or a concurrent claim won. Scope `plans:write`. |
| `POST /api/plans/[id]/artifacts` | Push plan-attached progress artifacts (batch upsert, latest-wins per `name`): `{ artifacts: [{ name, content, gitSha? }] }`. Owner-only; content is opaque (never parsed). Max 10 artifacts per plan, each ≤ `MAX_PLAN_BYTES` (default 1 MB). Scope `plans:write`. |
| `GET /api/plans/[id]/artifacts` | Pull progress artifacts: `{ artifacts: [{ name, content, gitSha, pushedAt }] }`. Readable by anyone who can view the plan — deliberately pre-claim, so a colleague can inspect progress before taking over. Scope `feedback:read`. |
| `GET /api/plans/[id]/feedback` | Structured feedback (`schemaVersion`, threads with severity/category/scope — `scope: "document"` marks whole-plan general comments with `quote: null`, reviews, rollups, markdown). Supports `?include=` / `?exclude=` (`blocking`, `unresolved`, `resolved`, `orphaned`). Scope `feedback:read`. |
| `GET /api/plans/[id]/feedback/wait?timeoutMs=` | Long-poll: blocks until the decision/state changes or the (clamped) timeout, then returns the same body with a `timedOut` flag. Scope `feedback:read`. |
| `PATCH /api/plans/[id]/settings` | Update review settings (`requiredApprovals`, `requireBlockerResolution`); returns the fields changed plus the resulting `state`. Scope `plans:write`. |
| `POST /api/plans/[id]/threads/[threadId]/comments` | Reply to a review thread (`threadId` is a `threads[].id` from `feedback`): `{ body }`. Owner-only. Returns `201 {comment}`; `409` if the plan is archived. Scope `plans:write`. |

For CI or headless agents that can't hold a connection open, register an
[outbound webhook](operations.md#outbound-webhooks) instead of long-polling.

### Blocker gate (opt-in)

Set `requireBlockerResolution: true` on `POST /api/plans` (or via
`PATCH /api/plans/{id}/settings`) and the server refuses to enter `APPROVED`
while any BLOCKER-severity thread is still OPEN — the decision stays
`changes_requested` even when the approval threshold is met. The feedback
payload then reports `rollup.approvalGated: true` and the digest states how
many blocking threads remain; resolving the last one flips the state and wakes
`GET /api/plans/{id}/feedback/wait`. Default off: without the flag, severity
stays advisory and `rollup.mustResolve` is the agent-side gate.

### Rate limits

Every token has a fixed budget across `/api/plans/**`
(`RATE_LIMIT_MACHINE_RPM`, default 120 requests/minute — far above a full
push → wait → pull cycle). Responses carry `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` (unix epoch seconds); an
exceeded budget returns `429` with `Retry-After` (seconds). Agents should
honor `Retry-After` before retrying. A long-poll on `feedback/wait` counts
once, at request start.

### Link the implementation

Once an approved plan is implemented, attach the resulting artifact so reviewers can navigate from plan to code:

```bash
curl -s -X POST "$CONSENSUM_BASE_URL/api/plans/<id>/links" \
  -H "Authorization: Bearer $CONSENSUM_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://github.com/acme/repo/pull/42","label":"PR #42","kind":"pr"}'
```

Requires the `plans:write` scope. `label` is optional; `kind` is one of `pr | commit | branch | other` (default `other`). Returns `201 {link}`. Links appear in an "Implementation" section on the document page, and participants get an in-app notification. `/consensum-loop` does this automatically after implementing.

### Reply to threads

After posting a revision, the agent can reply to the threads it acted on — the same convention as a PR author replying "done in abc123" instead of leaving a reviewer to diff for it:

```bash
curl -s -X POST "$CONSENSUM_BASE_URL/api/plans/<id>/threads/<threadId>/comments" \
  -H "Authorization: Bearer $CONSENSUM_API_TOKEN" -H 'content-type: application/json' \
  -d '{"body":"Addressed in v3: switched to the managed Postgres instance."}'
```

`threadId` is a `threads[].id` from `feedback`. By convention, reply `Addressed in v<N>: <what changed>` for a thread the revision fixed, or `Not changed: <reason>` for one deliberately left alone. Replies show up in the thread under the token owner's name, exactly like a reply posted from the web UI, and the feedback payload marks the agent's own replies with `comments[].mine: true` so a subsequent pull can tell them apart from reviewer activity. Posting a reply does not resolve the thread — that stays the reviewer's action. `/consensum-loop` and `/consensum-pull-feedback` do this automatically after each revision.

## Plan handover

When a plan's author is unavailable, a colleague runs
`/consensum-pull-plan <review-url>` with their own token. The command pulls
the plan (`GET /api/plans/[id]`), and — because revision and feedback are
owner-gated — offers to claim ownership (`POST /api/plans/[id]/claim`).
After a claim the previous owner is demoted to REVIEWER (keeping full read
and review access, and the ability to claim back later) and receives an
`ownership_claimed` notification. The claimer then continues with the
normal `/consensum-pull-feedback` / `/consensum-loop` cycle.

Trust model: on LINK-visibility plans — the default for agent-pushed plans —
any authenticated user with the plan URL is auto-joined as REVIEWER and can
therefore claim; the URL is the capability, same as for reviewing. The
safety valves are that the previous owner keeps access, is notified, and can
claim back. Note that `GET /api/plans/[id]` also returns `agentContext` to
every viewer (it was previously owner-only) — handover context is
team-visible by design.

Since m14, handover also carries **session state**: `/consensum-loop` pushes
the plan's `tasks.json` (when a local task file exists) and a free-text
`status.md` summary (stamped with the head commit SHA) after every revision
push, and `/consensum-pull-plan`
restores the task file next to the pulled plan and warns when the pushed SHA
is not an ancestor of the local checkout. Artifacts are readable before
claiming, so "should I take this over?" can be answered by looking at the
odometer, not just the destination.
