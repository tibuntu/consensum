# Changelog

## [0.16.0](https://github.com/tibuntu/consensum/compare/v0.15.0...v0.16.0) (2026-07-13)


### Features

* **m12a:** stale-review banner with inline since-your-review diff and queue hint ([914a69b](https://github.com/tibuntu/consensum/commit/914a69b0a38ce7b3daf44b436db5705157773585))
* **m12a:** version diff endpoint gated on view access ([6033932](https://github.com/tibuntu/consensum/commit/603393203d0540f4312c0e6cb5c24c065936c559))
* **m12a:** version-aware review queue re-surfaces stale request-changes reviewers ([36a2664](https://github.com/tibuntu/consensum/commit/36a2664925d24629aeb9613045e6b3021a4ba813))
* **m12b:** implementation links card on the document page ([4e1a292](https://github.com/tibuntu/consensum/commit/4e1a292d0537fb36ec321932c0542846e5696a8e))
* **m12b:** implementation links service, notification type, and machine/web APIs ([1bea37f](https://github.com/tibuntu/consensum/commit/1bea37fa7d4cf7a4bd4e0d77287f031eda3d1021))
* **m12b:** ImplementationLink schema with dual-DB migration ([f72f2e2](https://github.com/tibuntu/consensum/commit/f72f2e2b52f6bd8d2b6463d2e7eb61bef85daa6f))
* **ui:** use full display width for app content ([5fd9666](https://github.com/tibuntu/consensum/commit/5fd9666316522cd357a7b8b7e913312f0fd35569))


### Bug Fixes

* **deps:** update dependency @uiw/react-codemirror to v4.25.11 ([5823709](https://github.com/tibuntu/consensum/commit/5823709db30419845b1bc9065de39a54b5264d9b))
* **deps:** update pnpm to v11.11.0 ([cb19571](https://github.com/tibuntu/consensum/commit/cb1957168919d97d84c87f673479c5b85b0f0198))
* **m12a:** keep stale-review banner in sync with live review state ([2213382](https://github.com/tibuntu/consensum/commit/22133821ef9fedd6f0fd9edd0ac8f3b675600c57))
* **m12a:** recompute stale-banner state on SSE refetch ([ff6c334](https://github.com/tibuntu/consensum/commit/ff6c334eb62d8523c32cdddff389ad7c288b2cc3))
* **m12b:** normalize stored link URLs and trim labels before validation ([b02357d](https://github.com/tibuntu/consensum/commit/b02357d39b3eab802da6a52217b03dcacc27753b))
* **m12b:** surface link-removal failures and refresh links on refetch ([49fc9f5](https://github.com/tibuntu/consensum/commit/49fc9f50dcfa011a04a5f614000ee450edc26a59))
* **presence:** stop cursor/selection broadcasts when viewing alone ([433b25a](https://github.com/tibuntu/consensum/commit/433b25a471244e7a0f4e0b95d43fb749f36d72a9))
* **ui:** prevent hydration mismatch in leading-H1 demotion ([7b2282e](https://github.com/tibuntu/consensum/commit/7b2282e3923b27ee93809fc75bd816d029236e6b))

## [0.15.0](https://github.com/tibuntu/consensum/compare/v0.14.0...v0.15.0) (2026-07-08)


### Features

* **m11:** add User.disabled and RegistrationAllowlistEntry schema ([0edb002](https://github.com/tibuntu/consensum/commit/0edb00251fbe5910217248d4a3a02141ebda2b4e))
* **m11:** admin API routes (users, allowlist) gated by requireAdmin ([4e11311](https://github.com/tibuntu/consensum/commit/4e113112f301fb3760460fb13acff09a26f5f6d2))
* **m11:** admin gating (isAdmin/requireAdmin, ADMIN_EMAILS) ([f63775b](https://github.com/tibuntu/consensum/commit/f63775b07bbfab93abd489d09528227b9361892e))
* **m11:** admin settings UI (users + allowlist) with conditional tab ([f90ef79](https://github.com/tibuntu/consensum/commit/f90ef79d360459b31049cf2606e935df59aca1e3))
* **m11:** DB-backed allowlist union with admin actions ([9086e53](https://github.com/tibuntu/consensum/commit/9086e53dd1a14d6b2656f525e2d8902dc20cb03a))
* **m11:** enforce deactivation on API tokens and new logins ([c48df30](https://github.com/tibuntu/consensum/commit/c48df30d00c7920b431bb3a5d844464942cbbbc7))
* **m11:** user-management actions with self/env-admin guards ([6fdb7de](https://github.com/tibuntu/consensum/commit/6fdb7de69b6247e5f210d3a886ed8e86e4174f55))


### Bug Fixes

* **deps:** update codemirror to v6.7.1 ([bc1aa64](https://github.com/tibuntu/consensum/commit/bc1aa64c1c16546bed1138b5b876e1ba92acf284))
* **deps:** update pnpm to v11.10.0 ([abd555a](https://github.com/tibuntu/consensum/commit/abd555a5bdea6511f18b77cc6d45264c262e2beb))
* **m11:** add Postgres migration for User.disabled + RegistrationAllowlistEntry ([508cde7](https://github.com/tibuntu/consensum/commit/508cde735ac6f1a9b34f4d6c47dd59578d6db576))
* **m11:** cast ProcessEnv stub via unknown to satisfy tsc ([9e06589](https://github.com/tibuntu/consensum/commit/9e06589596c31a779b5924aa25835536a182a1b3))
* **m11:** dedup allowlist row when re-adding an existing entry ([7353365](https://github.com/tibuntu/consensum/commit/7353365d851ba13c826321df24f895a39fc57b9d))

## [0.14.0](https://github.com/tibuntu/consensum/compare/v0.13.0...v0.14.0) (2026-07-06)


### Features

* **hook:** PostToolUse backstop so competing ExitPlanMode hooks can't bypass review ([84c442f](https://github.com/tibuntu/consensum/commit/84c442f1cb51203ec2126622ac48e468df6b62f1))
* **viewer:** render pasted terminal box-drawing tables as monospace blocks ([639c102](https://github.com/tibuntu/consensum/commit/639c102f62362edb900009fa3e919a2298fb2672))


### Bug Fixes

* **home:** don't list documents twice when they're already in a review queue ([db6fcbc](https://github.com/tibuntu/consensum/commit/db6fcbc7a87830feafeb1662ec55951eadb75841))
* **hook:** encode Idempotency-Key so non-Latin-1 plan titles don't fail closed ([0ab14ad](https://github.com/tibuntu/consensum/commit/0ab14ad68413854011e70afc1897b3a09370056c))

## [0.13.0](https://github.com/tibuntu/consensum/compare/v0.12.0...v0.13.0) (2026-07-05)


### Features

* **access:** add document visibility and participant role columns ([9181f67](https://github.com/tibuntu/consensum/commit/9181f67dece8ef656ecf9f61d0b610dc26c11256))
* **access:** capability-based resolveAccess module ([75f570c](https://github.com/tibuntu/consensum/commit/75f570cf88f5e98659b7294f167c7221acc161e2))
* **access:** participant management API + visibility setting ([2e99876](https://github.com/tibuntu/consensum/commit/2e998766b5c20500a7fc9369217587cd067e4068))
* **access:** share dialog and role-aware document affordances ([6d7a782](https://github.com/tibuntu/consensum/commit/6d7a7829cc838d4c5ff46ba4a71d7c52b8d83c6d))
* **access:** shared notification type and notifyShared helper ([31896cd](https://github.com/tibuntu/consensum/commit/31896cd374527f10abff26e559e57a89c3e9bd8c))
* **access:** sharing service (share, setRole, remove, setVisibility) ([fe08c08](https://github.com/tibuntu/consensum/commit/fe08c086dee362e2ce8a02a19140f1cb47ea5b18))
* **access:** visibility by source in createDocument ([89e2388](https://github.com/tibuntu/consensum/commit/89e2388916009cb8dd92f0a98a7f2f51719be697))
* **api:** EDIT_UI_ENABLED also gates the session edit endpoint ([4e382b0](https://github.com/tibuntu/consensum/commit/4e382b04aef014d085279e94f4a5f2a61aa60742))
* **api:** expose requireBlockerResolution via settings and plan create ([b0c96d1](https://github.com/tibuntu/consensum/commit/b0c96d14a302705a9273237c1d9b0003b9fec6d2))
* **api:** per-token rate limit on the machine API ([cb8feac](https://github.com/tibuntu/consensum/commit/cb8feac88a5eac929637482551b33737ffb6bf24))
* **db:** requireBlockerResolution flag on Document (sqlite + postgres) ([457cf92](https://github.com/tibuntu/consensum/commit/457cf929cff84d38a66fed9b00f24f3c37c76e99))
* **feedback:** approvalGated rollup flag and digest line for gated approvals ([429097b](https://github.com/tibuntu/consensum/commit/429097b00eb1bffd1b36752d48a42666653af919))
* **reviewers:** add DocumentParticipant.required column ([9f346da](https://github.com/tibuntu/consensum/commit/9f346da3e1e1c0080e522d241627a3b16e4f1a98))
* **reviewers:** add review_requested notification type ([bd4eb24](https://github.com/tibuntu/consensum/commit/bd4eb247ddf4d1a126ee27654a5c1edac72684ec))
* **reviewers:** gate APPROVED on required reviewers in computeDocumentState ([8d8bc31](https://github.com/tibuntu/consensum/commit/8d8bc31309adf8f9c1498cf15209bad92ca4721f))
* **reviewers:** listReviewQueue two-tier queue data ([3f9fd3f](https://github.com/tibuntu/consensum/commit/3f9fd3ff1a46c99599b02271b5df2f20801bbcd7))
* **reviewers:** notifyReviewRequested helper ([c44cf3c](https://github.com/tibuntu/consensum/commit/c44cf3ca086d76f33fad588238d19fa826e25465))
* **reviewers:** recompute state with required reviewer IDs ([19a864c](https://github.com/tibuntu/consensum/commit/19a864c6d44f3be11218149b5feca18b42177409))
* **reviewers:** required flag on participants API ([acb92cc](https://github.com/tibuntu/consensum/commit/acb92cc277b1f8b1bbc8c081792f109a00bf81c0))
* **reviewers:** required toggle in the share dialog ([4eeb708](https://github.com/tibuntu/consensum/commit/4eeb7086c4c8e849ff3fb8871c6d941480149844))
* **reviewers:** review queue sections on the home page ([c5fa156](https://github.com/tibuntu/consensum/commit/c5fa156303ddeef822608d86c717647ac4053dbc))
* **reviewers:** setRequired + required-aware shareWith/setRole/listParticipants ([b5edeb1](https://github.com/tibuntu/consensum/commit/b5edeb1e341e75a2765927d010d2ee08005b452c))
* **reviews:** optional blocker gate in document-state computation ([273a207](https://github.com/tibuntu/consensum/commit/273a20722289db145ddb066180d401d83a63a3c8))
* **reviews:** recompute gated document state on blocker-thread changes ([5a2f690](https://github.com/tibuntu/consensum/commit/5a2f690bd5cfb3018a4d626a56090776d9b34f17))
* serve the app at / instead of /app ([a8b10e5](https://github.com/tibuntu/consensum/commit/a8b10e53090af7e571a3f628bfec26f6c23885e7))
* **ui:** owner toggle for requiring blocker resolution before approval ([49b495e](https://github.com/tibuntu/consensum/commit/49b495e01c8356f13e36417e079289e47cc037cf))


### Bug Fixes

* **access:** gate comment-thread controls for viewers and handle share-dialog request failures ([d4e2fc9](https://github.com/tibuntu/consensum/commit/d4e2fc9199c5aa7f68ab53629d7972f7c58b402b))
* **access:** live share-dialog visibility, setRole owner guard, and corrected reviewer copy ([42a82a0](https://github.com/tibuntu/consensum/commit/42a82a077e17bf723615e0132e420d49c01a2e01))
* **access:** lowercase email in shareWith lookup to match stored emails ([d9027a5](https://github.com/tibuntu/consensum/commit/d9027a5819edacf91defff17a705f060b5ed1954))
* **api:** log gate-recompute failures and correct fail-open budget header ([21e72b9](https://github.com/tibuntu/consensum/commit/21e72b9de0dee32c1bc7c66cedf21a09c2d5e0ac))
* **deps:** update dev dependencies to v16.2.10 ([e0bc7b3](https://github.com/tibuntu/consensum/commit/e0bc7b3954e83e19cc3c8f5b8b839ffbc7f62096))
* **deps:** update nextjs monorepo to v16.2.10 ([b3d1fdf](https://github.com/tibuntu/consensum/commit/b3d1fdfbcf8a48927862e0fa6bd8f9382c628a11))
* **reviewers:** recompute on required-flag clear via shareWith; drop redundant casts ([aed45b2](https://github.com/tibuntu/consensum/commit/aed45b25633f9d14841f1167bb364babbb4273dc))
* **reviewers:** thread actorId through setRole for correct decision attribution ([43a68a2](https://github.com/tibuntu/consensum/commit/43a68a239d98d737d6683b40a0c63024ba4d6bfe))
* **ui:** let the wrapping label supply the gate toggle's accessible name ([cf5f127](https://github.com/tibuntu/consensum/commit/cf5f127834887395f6be07ec2863ab7fccc462cd))

## [0.12.0](https://github.com/tibuntu/consensum/compare/v0.11.1...v0.12.0) (2026-07-03)


### Features

* accept document-scoped annotations in create service and route ([011e380](https://github.com/tibuntu/consensum/commit/011e3807c337f62c7e0578229f727abab38cdb66))
* add scope column to Annotation for document-scoped comments ([e41377f](https://github.com/tibuntu/consensum/commit/e41377f9f469435cc64acfe43441ad78f5e09aeb))
* deliver document-scoped threads in consolidated feedback (schemaVersion 2) ([47093b2](https://github.com/tibuntu/consensum/commit/47093b2f9df4619f4923e72b0a0dd38fcef8e3e9))
* exclude document-scoped annotations from highlight relocation ([0a5d0d0](https://github.com/tibuntu/consensum/commit/0a5d0d021ff55cecc9b18f2c71755421429bea7c))
* general-comment composer and sidebar group in review UI ([f982eb7](https://github.com/tibuntu/consensum/commit/f982eb707cf606bfea769086d551b889cb0a8adf))
* keep document-scoped annotations ACTIVE across revisions ([41ce049](https://github.com/tibuntu/consensum/commit/41ce049a80498dee7008a0bff5ac0eedff90e004))

## [0.11.1](https://github.com/tibuntu/consensum/compare/v0.11.0...v0.11.1) (2026-07-02)


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.23 ([061785b](https://github.com/tibuntu/consensum/commit/061785bcd8d090f7cec589b814d4fcd2a46add17))
* **deps:** update dependency nodemailer to v9.0.3 ([fb9cc51](https://github.com/tibuntu/consensum/commit/fb9cc515107388d92efb55189728b4d6e89a3996))
* **deps:** update dev dependencies to v4.3.2 ([d2ece3b](https://github.com/tibuntu/consensum/commit/d2ece3bfddbb0c490d72aa5137df4ecae6bf81ed))

## [0.11.0](https://github.com/tibuntu/consensum/compare/v0.10.0...v0.11.0) (2026-06-28)


### Features

* **auth:** DB-backed rate-limit storage + provider-matched adapter ([47366d2](https://github.com/tibuntu/consensum/commit/47366d2e3883e40a6496a3d90b4e0daf939fc1fa))
* **db:** dual-provider Prisma scaffolding (sqlite + postgresql) ([a1509e4](https://github.com/tibuntu/consensum/commit/a1509e46363a72958eb673006322b9febc20b38e))
* **db:** select Prisma driver adapter by DATABASE_URL (pg vs sqlite) ([eb2c0df](https://github.com/tibuntu/consensum/commit/eb2c0df62f566eddead3c184fe74c2ba56db9c58))
* **deploy:** multi-replica docker-compose reference (postgres + 2 replicas) ([23ce0b8](https://github.com/tibuntu/consensum/commit/23ce0b8de53aeaa663c053057f72c2d28378d994))
* **docker:** build and run the image on PostgreSQL (build-arg + gated migrate) ([d8aee94](https://github.com/tibuntu/consensum/commit/d8aee942e55673db5e6848685135ee7a01196c12))
* **events:** cross-replica event bus via Postgres LISTEN/NOTIFY ([59d7a0b](https://github.com/tibuntu/consensum/commit/59d7a0bef249e581004b662070cf5d0b195829b6))
* **outbox:** atomic claiming + lease-based recovery for multi-replica ([0ba07b9](https://github.com/tibuntu/consensum/commit/0ba07b9fef3b4456220b0fb51135fe863cee1ac0))
* **presence:** converge presence + review-session across replicas ([b302add](https://github.com/tibuntu/consensum/commit/b302addb47582835de9b963beedf75a0c0e7ac9e))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.21 ([15eee5a](https://github.com/tibuntu/consensum/commit/15eee5af0fb785d37f49b1850b3f41af81f52d61))

## [0.10.0](https://github.com/tibuntu/consensum/compare/v0.9.0...v0.10.0) (2026-06-26)


### Features

* **agent-api:** harden the agent review-loop contract ([a2a5d42](https://github.com/tibuntu/consensum/commit/a2a5d4275f5878d3a6ae2fd5e90249eb4be480f7))


### Bug Fixes

* **deps:** dedupe @codemirror/state to a single version ([7a72afa](https://github.com/tibuntu/consensum/commit/7a72afaebc92f7b6feac103e39e7d6bd5127980e))

## [0.9.0](https://github.com/tibuntu/consensum/compare/v0.8.0...v0.9.0) (2026-06-26)


### Features

* **ui:** UI overhaul — identity, accessibility, and review workflow ([b8ad15c](https://github.com/tibuntu/consensum/commit/b8ad15c8a1aaffcc077dc7088dc7d599eaea5f8e))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.20 ([307c857](https://github.com/tibuntu/consensum/commit/307c8579cfafa53564a3fb24d3026dea5b15ad49))
* **deps:** update dev dependencies ([8425928](https://github.com/tibuntu/consensum/commit/84259280bee7e3fb68d5357e3db37f753489b989))
* **deps:** update pnpm to v11.9.0 ([740c06d](https://github.com/tibuntu/consensum/commit/740c06dc63a679f8bb11a09a00854363625301a8))
* **docker:** drop npm from the runtime image to clear a Trivy HIGH ([137a4e0](https://github.com/tibuntu/consensum/commit/137a4e06935619e37f378dd5953e3c48a3321acd))

## [0.8.0](https://github.com/tibuntu/consensum/compare/v0.7.0...v0.8.0) (2026-06-20)


### Features

* **auth:** gate self-service registration behind an email allowlist ([75df860](https://github.com/tibuntu/consensum/commit/75df86004003973d66b76cb64bf78af9aef02144))

## [0.7.0](https://github.com/tibuntu/consensum/compare/v0.6.1...v0.7.0) (2026-06-20)


### Features

* **api:** expose anchor offsets and context on feedback threads ([2a291a4](https://github.com/tibuntu/consensum/commit/2a291a43a788dd12bda421b9b13ab8f1d93a921b))
* **api:** expose comment/review ids, timestamps, and reviewed version in feedback API ([6d45161](https://github.com/tibuntu/consensum/commit/6d4516183e43b049b70d3804fbfffd99097b3db5))


### Bug Fixes

* **api:** expose suggestion replacement text in feedback API ([3519f91](https://github.com/tibuntu/consensum/commit/3519f91acd08db82188013121d52988b0117f1e8))

## [0.6.1](https://github.com/tibuntu/consensum/compare/v0.6.0...v0.6.1) (2026-06-19)


### Bug Fixes

* **ci:** properly extract image metadate via jq ([feebf2b](https://github.com/tibuntu/consensum/commit/feebf2bed4005253dc88a92f5a3e9803be428360))

## [0.6.0](https://github.com/tibuntu/consensum/compare/v0.5.0...v0.6.0) (2026-06-19)


### Features

* **ci:** build ARM docker image ([cf28b45](https://github.com/tibuntu/consensum/commit/cf28b4569f2d5334941fd7916f8d739f777b2ad2))

## [0.5.0](https://github.com/tibuntu/consensum/compare/v0.4.1...v0.5.0) (2026-06-19)


### Features

* **documents:** add copy-to-clipboard button for plan markdown ([793d860](https://github.com/tibuntu/consensum/commit/793d860c9a0c3240842db5cb56f02523c4b115eb))


### Bug Fixes

* **deps:** pin better-call override to 1.3.6 for better-auth compat ([162dbad](https://github.com/tibuntu/consensum/commit/162dbad74159117ee4880e0a436b0a3fb0b0e67d))
* **deps:** update better-auth monorepo to v1.6.19 ([b8e8ad3](https://github.com/tibuntu/consensum/commit/b8e8ad3601a19406b546eb7c650d8d5b596d052d))
* **deps:** update dependency nodemailer to v9 ([92d4c49](https://github.com/tibuntu/consensum/commit/92d4c49956c8d0c5bfeea30deff3ac584a67e21f))

## [0.4.1](https://github.com/tibuntu/consensum/compare/v0.4.0...v0.4.1) (2026-06-15)


### Bug Fixes

* **docker:** bake matching Prisma engine so migrate works on read-only K8s FS ([4b3d0ec](https://github.com/tibuntu/consensum/commit/4b3d0ec7c1d73827054bd6f44faa70de136508e1))
* **docker:** ship prod-only distroless image to drop dev-dep CVEs ([0250868](https://github.com/tibuntu/consensum/commit/025086890cba041723966aeea239ff97d041f3f8))

## [0.4.0](https://github.com/tibuntu/consensum/compare/v0.3.1...v0.4.0) (2026-06-15)


### Features

* auto-proceed plan review via ExitPlanMode hook + installer ([bc05d9b](https://github.com/tibuntu/consensum/commit/bc05d9b55c3732a8b9f827633b00fe9c2232da85))
* rename product from Quorum AI to Consensum ([7737ff9](https://github.com/tibuntu/consensum/commit/7737ff9ed5feaf8a8d10f79d17a89f6ea1fa14c9))
* **ui:** merge theme buttons into a single cycling toggle ([cd2c9a8](https://github.com/tibuntu/consensum/commit/cd2c9a85fe5d5e3886e78bc8452e472ab8f31f61))


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.18 ([0fdb012](https://github.com/tibuntu/consensum/commit/0fdb012d666e64d684b0677141eca005bd55ae30))

## [0.3.1](https://github.com/tibuntu/QuorumAI/compare/v0.3.0...v0.3.1) (2026-06-14)


### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.16 ([8f29ff9](https://github.com/tibuntu/QuorumAI/commit/8f29ff9b2ce14d010a8287fee620e7dfe464b6ef))
* **deps:** update better-auth monorepo to v1.6.17 ([ce540e4](https://github.com/tibuntu/QuorumAI/commit/ce540e477247848cce0c2d4618db6958057129fc))
* **deps:** update nextjs monorepo to v16.2.9 ([572443c](https://github.com/tibuntu/QuorumAI/commit/572443cf5a7130be79d3612ec159103b5eabe5ee))

## [0.3.0](https://github.com/tibuntu/QuorumAI/compare/v0.2.0...v0.3.0) (2026-06-11)

### Features

* **UI polish** — a fresh 6-pillar visual audit took the app from 17/24 to 23/24: a token-driven dark theme for the CodeMirror editor, editor line-wrapping, violet-accented form controls, a legible dark-mode task-list checkbox, demotion of a duplicate leading H1, theme-aware presence colors, per-column version-diff headers, session-control tooltips, and a cursor→person legend.
* **Granular notification preferences** — the two global on/off switches are replaced by a per-type × per-channel matrix (comment / review / version / resolve × in-app / email / desktop); `resolve` stays non-emailable. Preferences live in a new `notificationPrefs` column (existing settings migrated automatically), and both server dispatch and desktop firing honor them per type.
* **Configurable approval quorums** — a document owner can require up to 10 approvals before a plan is marked Approved, set at creation or changed later via owner-only settings endpoints (web + machine API). The review panel shows "N of M approvals" progress, the feedback contract reports the threshold and current count, and document state recomputes immediately when the threshold changes.

### Bug Fixes

* **deps:** update better-auth monorepo to v1.6.15 ([bdc6565](https://github.com/tibuntu/QuorumAI/commit/bdc6565c4df1a5cf67e4b534cd956eb10347a3df))

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
