# Changelog

## [0.3.0](https://github.com/tibuntu/QuorumAI/compare/v0.2.0...v0.3.0) (2026-06-11)


### Features

* **m6-p1:** leading-H1 demotion, token presence colors, diff column headers, session helpers, cursor legend ([74c01c6](https://github.com/tibuntu/QuorumAI/commit/74c01c61aca14578a71cc514b7a5cd6950db6682))
* **m6-p2:** add User.notificationPrefs JSON column + backfill migration ([12f09a6](https://github.com/tibuntu/QuorumAI/commit/12f09a6a694d568fb5b064c9dbf02a1835b24092))
* **m6-p2:** drop legacy notification booleans (migrated to notificationPrefs) ([cbc5c95](https://github.com/tibuntu/QuorumAI/commit/cbc5c95d7d34b743642d7ffa2b8a5363e921932f))
* **m6-p2:** notification prefs matrix value-sets + pure helper ([9e0413f](https://github.com/tibuntu/QuorumAI/commit/9e0413fc8e086aa2368ecd49799be1b066ac0ca1))
* **m6-p2:** per-cell PATCH for notification prefs ([803cfac](https://github.com/tibuntu/QuorumAI/commit/803cfac3a08190454cd00062e141aa4dae51da5a))
* **m6-p2:** per-type desktop notification firing ([bf31876](https://github.com/tibuntu/QuorumAI/commit/bf318768ad7394a2a5450f1ef02ed6a5bed223ed))
* **m6-p2:** per-type dispatch filtering in notifyParticipants ([3d772bf](https://github.com/tibuntu/QuorumAI/commit/3d772bf8a6fb3099f52014c6d68d851c85c75ac4))
* **m6-p2:** per-type notification settings matrix UI ([6c39f11](https://github.com/tibuntu/QuorumAI/commit/6c39f11ea7dbd51a96cf3e35120e4f78a391be9c))
* **m6-p3:** owner-only settings routes for requiredApprovals ([14f1eba](https://github.com/tibuntu/QuorumAI/commit/14f1ebaf10911b83451dd4596b5686b6da9eda7f))
* **m6-p3:** pure quorum helper (parseRequiredApprovals + approvalCount) ([4d4ded9](https://github.com/tibuntu/QuorumAI/commit/4d4ded96e2bf42ae1bd5b37bde9fef7c514acd65))
* **m6-p3:** set requiredApprovals at document creation ([c2e14d5](https://github.com/tibuntu/QuorumAI/commit/c2e14d5ce24712d175d2952bc775b53a2fd9ff8d))
* **m6-p3:** setRequiredApprovals service + shared state recompute ([5b935a9](https://github.com/tibuntu/QuorumAI/commit/5b935a9d96bcec23753a32d51863aee2879399b1))
* **m6-p3:** show N-of-M approvals + owner threshold control ([bc09e6e](https://github.com/tibuntu/QuorumAI/commit/bc09e6e988b9640d2091959663dbb3a7d04d50bb))
* **m6-p3:** surface requiredApprovals + approvals in feedback contract ([cb6e721](https://github.com/tibuntu/QuorumAI/commit/cb6e7214a9f45f3656ea5e6d3e7b7f21c688cb5b))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.15 ([bdc6565](https://github.com/tibuntu/QuorumAI/commit/bdc6565c4df1a5cf67e4b534cd956eb10347a3df))
* **m6-p1:** dark-theme the CodeMirror editor pane in dark mode ([64077b9](https://github.com/tibuntu/QuorumAI/commit/64077b9808c32a4ed3e6c600b7aa7b39077360af))
* **m6-p1:** drop leaked node prop on demoted H1; fix cursor-legend comment ([c691c82](https://github.com/tibuntu/QuorumAI/commit/c691c82334966de68e8242677245b56a191039f6))
* **m6-p1:** editor line-wrap, violet form controls, dark task-list checkbox ([1af3e55](https://github.com/tibuntu/QuorumAI/commit/1af3e55f6616331dfb3490fdc8a890c0822e1ae7))

## [0.2.0](https://github.com/tibuntu/QuorumAI/compare/v0.1.0...v0.2.0) (2026-06-10)

Real-time collaboration: multiple reviewers can now work in the same document together and see each other live.

### Features

* **Live presence** — see who else is in a document via an avatar stack, backed by heartbeats with automatic TTL expiry and a roster replayed on connect.
* **Shared text selections** — other participants' selections render as tinted, per-user highlights in real time.
* **Live cursors** — collaborators' cursor positions are broadcast and rendered as a moving overlay.
* **Review sessions** — start, join, leave, and end a shared review session led by a designated leader; the session auto-ends when the leader drops, and reconnecting replays the active session.
* **Follow-the-leader scroll** — followers' viewports track the leader's scroll position, automatically detaching when a follower scrolls manually and resuming on demand.

### Bug Fixes

* Hardened the presence beacon against out-of-range selection offsets and unparseable request bodies ([b4e78a8](https://github.com/tibuntu/QuorumAI/commit/b4e78a8cd2a12486fd47d22463604da61624a054)).
