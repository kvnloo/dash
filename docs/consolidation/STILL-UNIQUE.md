# STILL-UNIQUE branches: commits not in staging

Against origin/staging 597c0dd568d3 (2026-11-23T07:57Z). One line per commit whose patch is not in staging.
State: `adds` = replays cleanly and changes staging; `conflict` = conflicts with staging; `present` = replays to no change. Shared commits repeat under each branch.

## Open PR heads kept or awaiting a decision

### archive/wt-dash-z0bridge-79-20261107-b7a2d2fe (bb2ba723fe66, 2026-11-07, +1/-1965)

- bb2ba723fe [adds] Archive WIP from <path> before worktree cleanup

### chatgpt/cov-10 (aeed8256e895, 2026-11-02, +9/-683)

- a4d61c6673 [conflict] test(army): port the RC3 tester-army coverage suite onto the integ harness
- cff434f6dc [conflict] test(army): fix test-script defects in the RC3 coverage specs; register every test in features.json
- dab113aa71 [conflict] test(army): fix four remaining spec defects found by the second full run
- 3483062f45 [conflict] test(army): the Bots tab is now Hosts (turbo-lane #hosts); update the nav specs
- 05c9991cdd [conflict] fix(chat): linkify source paths and open authenticated file previews (COV-G10)
- c17adb0412 [conflict] test(army): describe the wired bare-link acceptance contract

### chatgpt/fix-613-wheel (9607474878bc, 2026-11-06, +47/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging

### chatgpt/fix2-613-close-race (24ecb8b512ae, 2026-11-06, +64/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory

### dependabot/github_actions/actions/cache-6 (94faeecb16ec, 2026-11-07, +1/-317)

- 94faeecb16 [adds] chore(deps): bump actions/cache from 4 to 6

### dependabot/github_actions/actions/labeler-7 (abd562e3fc32, 2026-11-07, +1/-951)

- abd562e3fc [adds] chore(deps): bump actions/labeler from 5 to 7

### dependabot/github_actions/actions/stale-11 (d5d6e7c66e6a, 2026-11-07, +1/-951)

- d5d6e7c66e [adds] chore(deps): bump actions/stale from 9 to 11

### dependabot/github_actions/actions/upload-artifact-7 (0b183fa74fd8, 2026-11-07, +1/-317)

- 0b183fa74f [adds] chore(deps): bump actions/upload-artifact from 4 to 7

### dependabot/github_actions/ossf/scorecard-action-2.5.0 (6b803b5a06fe, 2026-11-07, +1/-951)

- 6b803b5a06 [adds] chore(deps): bump ossf/scorecard-action from 2.4.2 to 2.5.0

### feat/ux-polish-omp-tern-20261025 (50935306ee6b, 2026-11-13, +2/-1741)

- ebe5735c93 [conflict] feat(chat): apply source-backed OMP and Tern UX polish
- 50935306ee [conflict] fix(chat): preserve truthful queued and compact tool feedback

### feat/z0live-overlay-orb-20261102 (1094de25d3ac, 2026-11-02, +15/-422)

- cc3ae08196 [conflict] feat(slice-0): z0live SSE events endpoint + JS listener
- 359cca403c [conflict] feat(slices-1-2-3): dash-voice-orb native module — ForegroundService, overlay, Skia orb
- 78470025dc [adds] fix(build): dash-dex needs explicit react-android dependency
- d5376ad31c [conflict] fix(build): dash-dex also needs compileOnly :expo for ReactActivityDelegateWrapper
- c225036e61 [conflict] fix(build): remove ReactActivityDelegateWrapper from DashPadActivity
- d93c87a40b [conflict] Revert "fix(build): remove ReactActivityDelegateWrapper from DashPadActivity"
- 4546a2c089 [conflict] Revert "fix(build): dash-dex also needs compileOnly :expo for ReactActivityDelegateWrapper"
- 068269c7a2 [present] Revert "fix(build): dash-dex needs explicit react-android dependency"
- 2132689707 [conflict] fix(slice-0): /z0live/events sends full orb snapshots, adds user/working phases
- 7fc3844096 [conflict] fix(dash-voice-orb): make the module buildable like its siblings, specialUse service
- d02ead6bf8 [conflict] feat(dash-voice-orb): native SSE watcher service + draggable overlay orb
- 09004c8170 [conflict] feat(z0live-orb): JS arms the native orb service and serves it fresh tokens
- afa35715ca [adds] build(native): require the dash-voice-orb classes in the APK inclusion gate
- 7544e38cfe [conflict] test(army): z0live events SSE journey + z0live-orb-events feature
- 1094de25d3 [conflict] fix(dash-voice-orb): AsyncFunction return@AsyncFunction needs explicit null

### fix/chat-information-density-20261022 (a2dc84aedf12, 2026-10-22, +3/-1792)

- 655eb0c91a [conflict] fix(tool-format): keep command identity for ACP plain-text terminal calls
- 15c0f7ffb7 [conflict] fix(chat): show each tool call's target, state and failure line inline
- a2dc84aedf [adds] test(chat): rendered density proof on Expo web at 390 and 412 px

### fix/hosts-tree-hierarchy-main-20261105 (0b0b7ffe16fd, 2026-11-07, +6/-317)

- 1b3b66af92 [conflict] fix(hosts): one level per kind: host > harness > profile > chat
- 51f4f43620 [adds] test(army): expand a computer host and read back host > harness > profile > chat
- 9cfe5237f0 [conflict] test(army): find the Codex chat row by its visible title
- 81372b451c [conflict] test(army): read tree levels in on-screen order
- f88d803a82 [conflict] fix(hosts): singular counts for one, and Grok/fx harness labels
- 0b0b7ffe16 [conflict] test(hosts): typed fixtures with self, placeholder hosts and TEST-NET addresses

### integ/rc3-roadmap-resume-20261027 (5c88c6707d6d, 2026-11-07, +106/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- a01af5fcbd [adds] fix(dash): select chat owner for endpoint recovery
- 9be2239013 [adds] fix(dash): retry bridge in place before failover and restore chat owner
- 55ffbc282b [adds] test(failover): cover chat-owner recovery endpoint selection (#648)
- 9b5e350b33 [conflict] fix(chat): restore reader distance when a web row shrink clamps an upward wheel to Latest
- 0a05fc9b2d [adds] fix(chat): hand off row geometry in memory instead of route params
- 069a7cce27 [conflict] fix(web): exclude legacy window geometry from Chat URL linking
- 583fdf11eb [conflict] fix(chat): validate legacy window origins and release transient handoff
- 0c23562115 [adds] test(army): exercise row window URL and legacy reload recovery
- f3cbb80c6a [conflict] test(o15): register chat-window linking regression journeys
- eb1ab830d1 [conflict] fix(chat): isolate each row-open handoff from earlier modal cleanup
- 2f75642ef2 [conflict] test(army): follow #649 full-screen Chat restore after reload

### integrate/coverage-20261028 (430e6863a16d, 2026-10-28, +52/-491)

- a4d61c6673 [conflict] test(army): port the RC3 tester-army coverage suite onto the integ harness
- cff434f6dc [conflict] test(army): fix test-script defects in the RC3 coverage specs; register every test in features.json
- dab113aa71 [conflict] test(army): fix four remaining spec defects found by the second full run
- 3483062f45 [conflict] test(army): the Bots tab is now Hosts (turbo-lane #hosts); update the nav specs
- 85cf098c71 [conflict] fix(app): wire themed destructive confirmations at the root
- 827e2dc58a [conflict] fix(chats): wire RC3 row menu and prune vanished index rows
- 67a59cc1ac [adds] fix(bridge): allow ACP cancellation to settle before teardown
- b80f8e96ff [conflict] test(army): drive the themed confirm instead of window.confirm (COV-G02 landed)
- 6a5a016fa2 [conflict] fix(chat): expose Hermes live surface in new-chat window options
- 316eccb16e [conflict] fix(chat): clamp prompt rail preview above composer dock
- cfcf3aa25e [conflict] fix(composer): mount primary/chips and notices, restore mic hold and stream rate
- 8b820c3d4e [conflict] style(chat): keep compact rail preview actions readable
- 7b401f7c85 [conflict] fix(hermes): preserve newer turns and truncate paged ws history
- 060ce90f6f [adds] fix(tiles): handle keyboard through gesture detector wrappers
- 04c8aa19aa [adds] fix(settings): clear bridge notices before disconnecting on forget
- a09eaa0a5e [adds] fix(debug): replace bundled mock tailnet address with documentation IP
- b80bbf9b98 [conflict] Wire chat target chooser, quick-scroll and bridge reconnect lifecycle (COV-G08)
- 0dcc831dd5 [conflict] fix(delivery): wire durable outbox, receipts and same-identity retry
- 05c9991cdd [conflict] fix(chat): linkify source paths and open authenticated file previews (COV-G10)
- 0bc8d389fe [conflict] Handle native unknown foreground state and drain socket deltas (COV-G08)
- 634f2b0ebc [conflict] test(army): themed-confirm picks the dialog that holds the confirm buttons
- 45c729e3ec [conflict] test(army): count delivery replies inside the transcript
- 5e45a363e6 [conflict] test(army): the #415 five-option row menu replaced the three-option labels (send-longpress, in-app feedback)
- 19210aa46f [conflict] fix(app): the reconnect lifecycle's first 'waiting' pass must not publish offline
- 74b0dc8c1e [conflict] test(army): follow the lane's intended behaviour changes (outbox, #506, #516, C19, STT reason)
- 855ff9952c [conflict] fix(bridge): cut long Hermes messages in the /hermes/activity snapshot (COV-G11 follow-up)
- 816c1993ed [conflict] fix(annotate): keep the top nav (S Pen pill) tappable while annotating
- db45345d16 [adds] fix(trace): a two-finger pinch on the timeline is never taken as a scrub long-press
- c3bfb3d8e3 [conflict] feat(composer): bedtime capture gate (#374/#417) and overnight queue (#375/#413)
- a840979b04 [adds] test(army): mesh-roster waits for the reloaded app to boot before tapping Chats
- 4638511bf3 [conflict] test(army): tok/s chip journey checks the empty rate slot in the page, on the reply's first frame
- 2fe9513450 [conflict] fix(chat): Latest and wheel-up follow the owner reliably on web
- d8b6bc2261 [conflict] test(army): trace drag and 07.15 follow journey no longer race the clock
- fc2bbdf2dd [adds] test(army): annotation upload waits start once the no-words confirmation is up
- da33237ff2 [conflict] test(army): annotation upload waits get the suite's 30 s upload budget
- d2b18642e0 [conflict] test(army): fix the misplaced paren in the annotation upload waits (da33237f)
- 430e6863a1 [conflict] test(army): annotation Send clicks do not wait for navigations while the capture runs

### integrate/turbo-lane-20261028 (2f75642ef293, 2026-11-06, +101/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- a01af5fcbd [adds] fix(dash): select chat owner for endpoint recovery
- 9be2239013 [adds] fix(dash): retry bridge in place before failover and restore chat owner
- 55ffbc282b [adds] test(failover): cover chat-owner recovery endpoint selection (#648)
- 9b5e350b33 [conflict] fix(chat): restore reader distance when a web row shrink clamps an upward wheel to Latest
- 0a05fc9b2d [adds] fix(chat): hand off row geometry in memory instead of route params
- 069a7cce27 [conflict] fix(web): exclude legacy window geometry from Chat URL linking
- 583fdf11eb [conflict] fix(chat): validate legacy window origins and release transient handoff
- 0c23562115 [adds] test(army): exercise row window URL and legacy reload recovery
- f3cbb80c6a [conflict] test(o15): register chat-window linking regression journeys
- eb1ab830d1 [conflict] fix(chat): isolate each row-open handoff from earlier modal cleanup
- 2f75642ef2 [conflict] test(army): follow #649 full-screen Chat restore after reload

### lane/compose-613-20261105 (944b6c442a19, 2026-11-06, +41/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress

### lane/compose-613-642-643-645-harness-20261106 (5ac1d02ca143, 2026-11-06, +59/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load

### overnight/critical-path-20260910 (8e96ec00ce8b, 2026-10-27, +6/-2053)

- f9eb92f3f2 [conflict] feat: render AODL network in Orchestra pane
- 1f80a73d78 [conflict] feat: hydrate Orchestra from live roster
- 135f66a5ab [conflict] feat: grok-bot animation lib from synergy.ai → bot-chat (Reanimated4, transforms/opacity, <300ms, ReduceMotion.System)

### sol/trace-intent-20261021 (9fb1d7f1046d, 2026-10-21, +4/-1805)

- 460ed87c2e [conflict] feat(trace): add private intent evidence feed and artifact review cards
- bc79f827c3 [conflict] fix(trace): preserve embedded owner asks and bounded attachment evidence
- 77a8c6fd8b [conflict] fix(trace): expand proof images and fence stale artifact reads
- 9fb1d7f104 [conflict] fix(trace): expose metrics expansion state to web accessibility

### spec/dash-feature-ledger (6b2908ed4c71, 2026-11-15, +5/-1736)

- 3702c3ea85 [conflict] fix(spec): reject malformed receipt revision identifiers
- 01c1e0d4db [conflict] fix(preview): require confirmed adb launch before delivery
- ae3e4221d4 [conflict] fix(preview): reject empty feature handoffs
- 6b2908ed4c [conflict] fix(preview): deduplicate feature handoff selection

### sus100/sus100-dash-release-04 (9f13155bd190, 2026-11-02, +2/-491)

- 4ac1494ed3 [adds] fix(roster): unify registered Linux phone guests with Android hosts

## STILL-UNIQUE branches

### backup/eui-cards-unsquashed-20261105 (41c225fe822a, 2026-11-05, +10/-350)

- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 13a6b56e76 [conflict] feat(genui): ephemeral-ui repo cards as an openui-lang EphemeralCard catalog component
- 7695e9161b [conflict] test(army): ephemeral-ui-cards feature journeys; label kit sample data honestly
- 04c60439fd [conflict] docs(genui): tell agents about openui-lang and EphemeralCard
- 41c225fe82 [conflict] feat(genui): vendor synthetic trace and intent data for the ephemeral-ui cards

### chatgpt/turbo-12-subagent-strip-green (4bca6e3ed159, 2026-10-28, +2/-739)

- cba5addc1e [adds] fix(hermes): hide delegated children from chats and completed workers from mounted Orchestra
- 4bca6e3ed1 [conflict] test(army): match native Hermes parent rather than reused fixture roster session

### chatgpt/turbo-13-live-chip-army (cff9aa17554a, 2026-10-28, +10/-735)

- 70df467821 [conflict] feat(turbo): web-only Metro identity and reload seams
- 4278dcb3ea [conflict] feat(turbo): render live web chip and accessible long-press menu
- eabb8344c7 [conflict] test(turbo): army Metro stub and six O15 live-preview journeys
- 76dd7e576c [adds] test(turbo): temporary sameBuild always-true mutation (expect army red)
- 599467a5e5 [conflict] test(turbo): keep mutation compile-clean for army red evidence
- b535f4494c [present] test(turbo): restore real sameBuild after CI mutation red
- a35a926b10 [present] test(turbo): stabilize 3-minute build-age fixture away from boundary
- b0fb49d503 [conflict] fix(turbo): scope initial foreground idle gate to web army

### fix/army-main-mic-wayland (9be0618de29d, 2026-11-05, +3/-397)

- 1c40866a04 [conflict] test(army): wait for SQLite writer lock and report stderr
- 44849d903a [conflict] test(army): set busy timeout on full-message writer

### fix/bridge-hermes-list-refresh (d0f4161216ad, 2026-10-26, +2/-1428)

- 46dcf20e9d [adds] test(bridge): pin nonblocking native Hermes profile refresh
- d0f4161216 [conflict] fix(bridge): refresh Hermes profiles from native state without CLI children

### fix/share-pattern-syntax (c792ba34c7c6, 2026-11-02, +10/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 25ec7e5253 [adds] turbo: lane slice d711b34..2a7d17b (add-only flow modules: brainstorm-mode, ink-coalescer, turn-fuse, visual-pane, ink-envelope, flow-latency receipt)
- ce3d10fb01 [conflict] test: explicit 30 s timeout for large-payload row-budget and agentsview head tests
- 374f06a4f6 [conflict] test: move row-budget timeout const out of the import list
- 39dbfefad6 [conflict] test: chat-index-scale ratios take best of 4 interleaved runs (full-suite load flake)
- 4bc128ed0f [conflict] test: load-tolerant bounds for chat-index scale ratio (8x) and busy-scan RPC timeout (5 s)
- c792ba34c7 [conflict] fix(share): replace \p{Cntrl} with hex range in safeName (PatternSyntaxException near index 3)

### hermes/hosts-3-utilization (d7ccc9f39fc0, 2026-10-28, +1/-785)

- d7ccc9f39f [conflict] feat(hosts): persist sampled utilization and show 24h coverage

### incomplete/cursor/aodl-ui-surface-e30f (ed74bd67aeaf, 2026-09-13, +17/-2072)

- a800012478 [adds] docs: continuous R-phase insights (AgentFlow dual, three calculi)
- a5bed70e31 [conflict] docs: fold wave-2 insights; catalog Readings draft
- acaf75b3db [conflict] docs: wave-3 partial — AgentFlow name collision, craid π_v static leg
- be52aeb090 [conflict] docs: wave-3 — Hermes dry-run slice, rMPST hole, AgentFlow code NONE
- bada6ecadf [conflict] docs: S-layer readings — blackboard/stigmergy are stateStore not swarm
- 8726432b25 [conflict] docs: audit tools vs IR; StateFuse merge-is-not-verify
- b111072b7e [conflict] docs: close S-layer wave — kernel SHM is governance not a kind
- d25d17ad09 [conflict] docs: deep pass — π_v CLI, Hermes dry-run, catalog kit
- 69ea8fc8c3 [conflict] docs: close deep-read wave — 10 full-paper notes
- 717351e3e8 [conflict] docs: close deep-read wave 2 — ten cousin papers
- 564e5221d2 [conflict] docs: thesis seed — intent residual, codecs, Kardashev Γ_t
- ebfcf04993 [conflict] docs: evidence chain plus shared-model thesis companion
- 69cc453dca [conflict] docs: mirror frontier-kb inbox packet (cursor 403)
- a64b30f8d4 [conflict] feat: mount @kvnloo/aodl-ui IntentSurface on the chat composer
- ed74bd67ae [conflict] rename: mount Ripple from @kvnloo/ripple on chat

### integ/turbo-c30-c13-20261103 (4e00e8273ab5, 2026-11-03, +1/-417)


### lane/compose-dash4r-0604 (9e0928b6b234, 2026-11-04, +9/-384)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events

### lane/compose-dash4r-0610 (4e8e371e844d, 2026-11-04, +12/-348)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events

### qualify/turbo-20261025-memory-context-lane (596beb43a7e8, 2026-10-25, +1/-1601)


### reaped/army-core-20261029-20261113-e77b95 (2db2280cd802, 2026-11-13, +1/-482)

- 2db2280cd8 [conflict] worktree-reap snapshot of <path>

### reaped/ayo/R23-20261115-a7b875 (6dcd40722b96, 2026-11-15, +6/-1741)

- b9d934f672 [conflict] test(e2e): add isolated MBP Playwright army and framework benchmarks
- 80e5b7a3e2 [conflict] test(e2e): wait for an actual roster refresh in ACP lifecycle regression
- 0beacde9fb [conflict] test(e2e): accept WorkspaceHeader a11y names (Create new chat, Upstream approvals) from #167
- e69419b174 [conflict] fix(e2e): retain army recordings only for failures
- 3b2d437493 [adds] test(e2e): prove army recording retention with real browser artifacts
- 6dcd40722b [present] worktree-reap snapshot of <path>

### reaped/baseline-20261113-a1e5b8 (1a48d98bc99a, 2026-11-13, +1/-1881)

- 1a48d98bc9 [adds] worktree-reap snapshot of <path>

### reaped/bridge/context-metadata-20261022-20261113-ca2fee (0fecda59aa86, 2026-11-13, +3/-1849)

- e5d37273fb [conflict] feat(bridge): additive read-only provider and parent lineage in the exact-session context snapshot
- 0fecda59aa [present] worktree-reap snapshot of <path>

### reaped/chatgpt/dash-120-20261113-36f94d (5f9bbb9ddb3d, 2026-11-13, +7/-1741)

- 9ee332d6cd [adds] test(composer): render row options and exercise exclusive hold/tap gesture callbacks (#120)
- 1aaca1ff61 [conflict] test(composer): use TSX-safe generic arrows in RN mocks (#120)
- 5f9bbb9ddb [present] worktree-reap snapshot of <path>

### reaped/chore/dead-code-20261107-20261113-ffc57d (e32575c8d588, 2026-11-13, +3/-317)

- 9d3c576963 [conflict] chore: delete dead code (verified) — deps+files, lock pending regen
- 8c666d9644 [conflict] chore: restore dead code deleted in PR #657 — needed for army/O15 gate tests
- e32575c8d5 [adds] worktree-reap snapshot of <path>

### reaped/composer-before-20261021-20261113-b9d5e0 (ffb4bfddbc57, 2026-11-13, +1/-1969)

- ffb4bfddbc [adds] worktree-reap snapshot of <path>

### reaped/dash-e2e-test-20261113-87b86a (d64c81cf7cbf, 2026-11-13, +6/-1426)

- d64c81cf7c [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-613-20261113-c31d4a (e67cda47d7f6, 2026-11-13, +42/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- e67cda47d7 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-630-afill-20261113-636b18 (44b53f9f6076, 2026-11-13, +15/-329)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 44b53f9f60 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-630-locfix-20261113-6089e6 (245196033a0e, 2026-11-13, +11/-397)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 245196033a [present] worktree-reap snapshot of <path>

### reaped/dash-lane-630-on-36de-20261113-50e1c7 (033df24ea955, 2026-11-13, +19/-350)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- 033df24ea9 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-636fix5-20261113-ee0939 (2ead041e1e0e, 2026-11-13, +8/-350)

- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- 2ead041e1e [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-641-20261113-c3f2ae (468478fd34a9, 2026-11-13, +8/-350)

- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- 468478fd34 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-642-20261113-6bd2c8 (0725126c6569, 2026-11-13, +37/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- 0725126c65 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-643-20261113-ec6244 (14c2812dfef9, 2026-11-13, +36/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 14c2812dfe [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-644fix5-20261113-40241a (3a5918c14ed9, 2026-11-13, +46/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 3a5918c14e [present] worktree-reap snapshot of <path>

### reaped/dash-lane-648-20261113-ab49f0 (fb086a93bc9e, 2026-11-13, +92/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- a01af5fcbd [adds] fix(dash): select chat owner for endpoint recovery
- 9be2239013 [adds] fix(dash): retry bridge in place before failover and restore chat owner
- 55ffbc282b [adds] test(failover): cover chat-owner recovery endpoint selection (#648)
- fb086a93bc [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-649-20261113-22caa0 (e98b6790e862, 2026-11-13, +102/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- a01af5fcbd [adds] fix(dash): select chat owner for endpoint recovery
- 9be2239013 [adds] fix(dash): retry bridge in place before failover and restore chat owner
- 55ffbc282b [adds] test(failover): cover chat-owner recovery endpoint selection (#648)
- 9b5e350b33 [conflict] fix(chat): restore reader distance when a web row shrink clamps an upward wheel to Latest
- 0a05fc9b2d [adds] fix(chat): hand off row geometry in memory instead of route params
- 069a7cce27 [conflict] fix(web): exclude legacy window geometry from Chat URL linking
- 583fdf11eb [conflict] fix(chat): validate legacy window origins and release transient handoff
- 0c23562115 [adds] test(army): exercise row window URL and legacy reload recovery
- f3cbb80c6a [conflict] test(o15): register chat-window linking regression journeys
- eb1ab830d1 [conflict] fix(chat): isolate each row-open handoff from earlier modal cleanup
- 2f75642ef2 [conflict] test(army): follow #649 full-screen Chat restore after reload
- e98b6790e8 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-702bf79c-20261113-9b9d1d (bd000deedc5e, 2026-11-13, +3/-1144)

- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- bd000deedc [present] worktree-reap snapshot of <path>

### reaped/dash-lane-apk-52a64e11-20261113-a9d817 (0245ddbcab7c, 2026-11-13, +81/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 0245ddbcab [present] worktree-reap snapshot of <path>

### reaped/dash-lane-apk-6acff6dd-20261113-3c883c (c10c2d53d8ef, 2026-11-13, +82/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- c10c2d53d8 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-apkcheck-20261113-7acece (49250f562fb6, 2026-11-13, +88/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- 49250f562f [present] worktree-reap snapshot of <path>

### reaped/dash-lane-base-2bedab2-20261113-429a93 (29eb8e403148, 2026-11-13, +5/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 29eb8e4031 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-base-bae07a2-20261113-5fe484 (aaa8dd7e0968, 2026-11-13, +1/-1479)

- aaa8dd7e09 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-c634-20261113-77fd13 (11ccdc4136f2, 2026-11-13, +4/-391)

- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 11ccdc4136 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand10-20261113-98fac6 (d0423d4b8384, 2026-11-13, +1/-1549)

- d0423d4b83 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand12-20261113-2a53c1 (8917b97b9255, 2026-11-13, +17/-1473)

- 8917b97b92 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand13-20261113-a64820 (50ba7656518d, 2026-11-13, +1/-1483)

- 50ba765651 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand14-20261113-31f764 (437c7f8e49e9, 2026-11-13, +1/-1479)

- 437c7f8e49 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand5-20261113-5dd365 (b9fa6650af47, 2026-11-13, +26/-1571)

- 6c52ac4f73 [adds] test: cover live OMP hydration and prevent cross-cwd history fallback (#26)
- 11f047641a [conflict] test: keep new hydration regression suite strict-TypeScript (#26)
- 4ff121356d [conflict] fix(omp): keep live transcript lookup in its selected workspace (#26)
- b9fa6650af [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand6-20261113-9a6f13 (6de9c6f0bfe6, 2026-11-13, +1/-1613)

- 6de9c6f0bf [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand7-20261113-3ff038 (d813cbf8d5bc, 2026-11-13, +12/-1589)

- 6c52ac4f73 [adds] test: cover live OMP hydration and prevent cross-cwd history fallback (#26)
- 11f047641a [conflict] test: keep new hydration regression suite strict-TypeScript (#26)
- 4ff121356d [conflict] fix(omp): keep live transcript lookup in its selected workspace (#26)
- d813cbf8d5 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand8-20261113-877f85 (0c2b03886fba, 2026-11-13, +1/-1578)

- 0c2b03886f [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-cand9-20261113-f97f2a (3ea254914921, 2026-11-13, +1/-1562)

- 3ea2549149 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-ciapt-1105-20261113-87bba6 (d4585ebce8a1, 2026-11-13, +33/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- d4585ebce8 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-1105-20261113-4e1c01 (f1489d659d28, 2026-11-13, +13/-329)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- f1489d659d [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-20261113-84b91b (895bd18a02b6, 2026-11-13, +1/-1362)

- 895bd18a02 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-584-593-20261105-20261113-a540bb (8080c591f95a, 2026-11-13, +31/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- 8080c591f9 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-617-20261105-20261113-b7ded1 (5ea010bf73c5, 2026-11-13, +34/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 4ac1494ed3 [adds] fix(roster): unify registered Linux phone guests with Android hosts
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- 5ea010bf73 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-636fix3-20261113-ebc4d8 (adfc69c74db1, 2026-11-13, +4/-350)

- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- adfc69c74d [present] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-636fix4-20261113-75b30e (0ef3b8e0f7f6, 2026-11-13, +7/-350)

- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 0ef3b8e0f7 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-702bf-20261113-47b779 (99c572b3742f, 2026-11-13, +5/-397)

- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- 99c572b374 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-c029acf-630dd6e-20261113-6d9c6b (32d2d323f7df, 2026-11-13, +2/-1235)

- 32d2d323f7 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-no630-1105-20261113-dd1652 (899ebe9465b5, 2026-11-13, +1/-327)

- 899ebe9465 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-compose-no630-20261113-e6c15a (88e2e8a1b654, 2026-11-13, +2/-350)

- 88e2e8a1b6 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-dexcycle-20261113-0b1830 (6ee7d90defec, 2026-11-13, +87/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 6ee7d90def [present] worktree-reap snapshot of <path>

### reaped/dash-lane-e2e-army-20261113-d64e3b (e7748665876a, 2026-11-13, +5/-1741)

- b9d934f672 [conflict] test(e2e): add isolated MBP Playwright army and framework benchmarks
- 80e5b7a3e2 [conflict] test(e2e): wait for an actual roster refresh in ACP lifecycle regression
- 0beacde9fb [conflict] test(e2e): accept WorkspaceHeader a11y names (Create new chat, Upstream approvals) from #167
- 601209ce26 [conflict] test(e2e): close context card via its modal backdrop when turbo renders it as a Modal
- e774866587 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-fix-5df7325-20261113-392b72 (4dc44f8ab6cd, 2026-11-13, +1/-1324)

- 4dc44f8ab6 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-fix2c30-1103-20261113-5c7be1 (1ddcb3449209, 2026-11-13, +1/-413)

- 1ddcb34492 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-fix630-1105-20261113-d11454 (bcbe4202771a, 2026-11-13, +9/-397)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- bcbe420277 [present] worktree-reap snapshot of <path>

### reaped/dash-lane-gates-5bef946-20261113-26a4d9 (a227231dc0b4, 2026-11-13, +1/-1308)

- a227231dc0 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-integ-52a64e11-20261113-47bb79 (40d9705466bb, 2026-11-13, +86/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 40d9705466 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-p645-20261113-0a777f (83ea57248e75, 2026-11-13, +48/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 83ea57248e [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-pr351-20261113-c0e004 (920669eeb680, 2026-11-13, +1/-1317)

- 920669eeb6 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-pr641-1105-20261113-522f5d (59d6bb1c760a, 2026-11-13, +9/-1144)

- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- 38b41e492c [conflict] fix(dash): retain OMP pane cwd across restored session failover
- cf10a6c0af [adds] test(dash): assert OMP pane-specific cwd in native ACP loads
- 1a71a786d8 [conflict] test(dash): split ACP call records by newline
- ffea47ae55 [conflict] fix(live): keep unowned OMP pane collisions fail-closed
- 06492b55cf [conflict] test(live): select explicitly owned pane in cwd restore regression
- 59d6bb1c76 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-sttwarm-20261113-47a41a (d37751928793, 2026-11-13, +87/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- d377519287 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-turbo01b-20261113-d1bc3e (0dd309009dec, 2026-11-13, +1/-1498)

- 0dd309009d [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-turbocomp-20261113-609c2b (48e0bb1ab848, 2026-11-13, +2/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- 48e0bb1ab8 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u10-20261113-17cdf6 (2fed2f0d7fdf, 2026-11-13, +74/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- 2fed2f0d7f [present] worktree-reap snapshot of <path>

### reaped/dash-lane-u11-644fix4-20261113-87f62e (cd78c7eb2148, 2026-11-13, +76/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- cd78c7eb21 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u12-644fix5-20261113-b7ab67 (d1cdf49a5fda, 2026-11-13, +78/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- d1cdf49a5f [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u13-644-20261113-03a92d (8b70e75d71e2, 2026-11-13, +47/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 8b70e75d71 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u14-646-20261113-7069b3 (0f66e010f63b, 2026-11-13, +81/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 0f66e010f6 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u4-no644-20261113-fb0920 (c00ee679bbec, 2026-11-13, +59/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- c00ee679bb [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u6-644fix2-20261113-abfc42 (eb8ea18420b7, 2026-11-13, +70/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- eb8ea18420 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u642-644b-20261113-3b83b7 (8e334e23025d, 2026-11-13, +69/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 8e334e2302 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u644-20261113-7f35d9 (88a0f9694129, 2026-11-13, +47/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 88a0f96941 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u7-harness-20261113-c91736 (2b3a0ad6dfdf, 2026-11-13, +71/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 3839819a89 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- 2b3a0ad6df [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u8-harness-20261113-3c76af (6525e142e63e, 2026-11-13, +60/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- 6525e142e6 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-u9-644fix3-20261113-f7477a (11e575755947, 2026-11-13, +72/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- 11e5757559 [adds] worktree-reap snapshot of <path>

### reaped/dash-lane-wheel-20261113-6bcb80 (1ced78f8722a, 2026-11-13, +94/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 657b0a4710 [adds] fix(dex): push a fresh Chat route from Ctrl+K quick switch
- b2d93114a8 [conflict] test(army): require full Chat route after quick switch during desk close
- 0f6287d8cb [conflict] test(army): assert new chat transcript rather than hidden Main subtree
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- 9a01014d0c [conflict] fix(dex): drop project(':expo') dep to break Gradle task cycle
- 67f8f16c3d [adds] fix(android): gate native inclusion on dex descriptors only
- a01af5fcbd [adds] fix(dash): select chat owner for endpoint recovery
- 9be2239013 [adds] fix(dash): retry bridge in place before failover and restore chat owner
- 55ffbc282b [adds] test(failover): cover chat-owner recovery endpoint selection (#648)
- 9b5e350b33 [conflict] fix(chat): restore reader distance when a web row shrink clamps an upward wheel to Latest
- 1ced78f872 [adds] worktree-reap snapshot of <path>

### reaped/dash-orch-leak-20261113-2563a4 (fc32daba60fc, 2026-11-13, +1/-1385)

- fc32daba60 [adds] worktree-reap snapshot of <path>

### reaped/dash-orch-leak-dev-20261113-80f4bb (c7a16d01202c, 2026-11-13, +1/-1385)

- c7a16d0120 [conflict] worktree-reap snapshot of <path>

### reaped/dash-rc3-e2e-2c948dc-20261113-8dae7a (c30b069284f5, 2026-11-13, +1/-978)

- c30b069284 [adds] worktree-reap snapshot of <path>

### reaped/dash-turbo-qualify-latest-gates-20261025T1135-20261113-37719d (f67e73e130cf, 2026-11-13, +1/-1549)

- f67e73e130 [adds] worktree-reap snapshot of <path>

### reaped/density-dial-20261113-cfcb53 (7b588f007adc, 2026-11-13, +4/-1805)

- 4b16ead1a8 [conflict] wip(density): preserve interrupted two-axis controls and Zero tuck
- 7b588f007a [conflict] worktree-reap snapshot of <path>

### reaped/e2e/mbp-army-20261025-20261113-87d629 (7158e4a27c19, 2026-11-13, +4/-1741)

- b9d934f672 [conflict] test(e2e): add isolated MBP Playwright army and framework benchmarks
- 80e5b7a3e2 [conflict] test(e2e): wait for an actual roster refresh in ACP lifecycle regression
- 0beacde9fb [conflict] test(e2e): accept WorkspaceHeader a11y names (Create new chat, Upstream approvals) from #167
- 7158e4a27c [present] worktree-reap snapshot of <path>

### reaped/explore/glass-wallpaper-20261113-87d77a (139052ef6fc4, 2026-11-13, +2/-1426)

- cba49a25db [conflict] feat(glass): opt-in Dash Glass variant over the Android wallpaper (spike)
- 139052ef6f [adds] worktree-reap snapshot of <path>

### reaped/feat/agent-surface-20261022-20261113-10a492 (c62f72ea4ac4, 2026-11-13, +2/-1792)

- 9b8e1de821 [conflict] feat: add scoped same-chat agent surface with render receipts
- c62f72ea4a [present] worktree-reap snapshot of <path>

### reaped/feat/ephemeral-ui-cards-20261105-20261113-0c5f55 (1c7c2f701f65, 2026-11-13, +1/-316)

- 1c7c2f701f [adds] worktree-reap snapshot of <path>

### reaped/feat/libfx-live-surface-20261113-2fd894 (374093526236, 2026-11-13, +1/-1985)

- 3740935262 [adds] worktree-reap snapshot of <path>

### reaped/feat/spen-voice-20261025-20261113-5aa8d8 (32a5b2803ce1, 2026-11-13, +25/-1741)

- ca24952f67 [conflict] feat(stylus): observe side-button edges; preserve normal selection and attach circled regions
- 645c38e63f [conflict] fix(voice): release queued final replies on unmute and after noise turns
- 53d9eb8e39 [conflict] fix(stylus): attach reply action to native selectable TextViews
- 37f2b8f6e2 [adds] test(stylus): add offloaded combined client qualification lane
- 4110d3dfad [conflict] fix(build): exclude workstation dependency symlinks from native cache
- 6c0f8bd2ae [conflict] test(stylus): cover retained ink and text extraction for rendered web proofs
- 6b7bafc99e [conflict] fix(ink): retain live stroke through pen-up until committed canvas renders
- f51ed0b2af [conflict] fix(stylus): release button edge on background and restore callbacks on destroy
- df68db938c [conflict] fix(stylus): type optional event adapter and scope observation lifetime
- da597c8d57 [conflict] test(stylus): run focused regressions first and fetch rendered receipts
- 16b755c71e [conflict] fix(annotate): reserve circle attachment slots and reject stale-screen capture
- 88de7853fb [conflict] fix(voice): speak exact composer and circled-region replies in the root-owned call
- 86de281d19 [conflict] test(build): complete draft-storage mock; fetch APK even when JS gates fail
- 55a0b945d4 [conflict] fix(stylus): quote only visible lines on the foreground native screen
- a1ace03ee4 [conflict] test(ink): serve pinned CanvasKit locally in isolated browser proof
- 6e352189d1 [conflict] test(annotate): drive real pen circle into a quoted image draft
- 75926a421f [conflict] test(ink): allow cold admitted-worker bundling before browser assertions
- da5c04717b [conflict] fix(annotate): keep mode pill and composer clear of the ink tray
- e5763745db [conflict] test(annotate): scope circle and mode assertions to the visible chat
- a247b8b5c0 [conflict] test(annotate): bind combined source gates to persistent rendered qualification
- a893b532f1 [conflict] fix(build): invoke SDK apksigner through admitted worker bash
- 6c758a3a9e [conflict] test(annotate): model upload preflight without treating it as image bytes
- 7e02eac309 [conflict] fix(annotate): capture circled text before attachment chips reflow the dock
- f167589de8 [conflict] fix(annotate): reject captures retargeted within a reused chat route
- 32a5b2803c [adds] worktree-reap snapshot of <path>

### reaped/feat/trace-native-20261113-23ad92 (63aad780af0e, 2026-11-13, +1/-1918)

- 63aad780af [conflict] worktree-reap snapshot of <path>

### reaped/feat/ux-polish-omp-tern-20261025-20261113-6cf426 (f9af2ec893b5, 2026-11-13, +2/-1741)

- ebe5735c93 [conflict] feat(chat): apply source-backed OMP and Tern UX polish
- f9af2ec893 [present] worktree-reap snapshot of <path>

### reaped/feat/voice-orb-live-20261113-173b84 (264f80408121, 2026-11-13, +1/-1848)

- 264f804081 [adds] worktree-reap snapshot of <path>

### reaped/fix/army-roster-304-20261113-6a6146 (acc7bf7dee3e, 2026-11-13, +7/-1741)

- b9d934f672 [conflict] test(e2e): add isolated MBP Playwright army and framework benchmarks
- 80e5b7a3e2 [conflict] test(e2e): wait for an actual roster refresh in ACP lifecycle regression
- 0beacde9fb [conflict] test(e2e): accept WorkspaceHeader a11y names (Create new chat, Upstream approvals) from #167
- 601209ce26 [conflict] test(e2e): close context card via its modal backdrop when turbo renders it as a Modal
- b4bd274253 [present] test(e2e): accept 304 from conditional roster poll in ACP lifecycle regression
- de4437af51 [adds] test(e2e): bound roster.finished() so a cached 304 cannot hang the ACP lifecycle regression
- acc7bf7dee [present] worktree-reap snapshot of <path>

### reaped/fix/automatic-stylus-20261113-a02085 (e403b0acc2c2, 2026-11-13, +1/-1798)

- e403b0acc2 [conflict] worktree-reap snapshot of <path>

### reaped/fix/bridge-gui-source-20261102-20261113-293f31 (37cadcd488f0, 2026-11-13, +2/-956)

- 1e577218da [conflict] fix(bridge): add gui to HERMES_CHAT_SOURCES so dashboard sessions pass visible() and knownTarget()
- 37cadcd488 [present] worktree-reap snapshot of <path>

### reaped/fix/cache-directory-persistence-20261113-339ee5 (2aec330e3e5d, 2026-11-13, +1/-1545)

- 2aec330e3e [adds] worktree-reap snapshot of <path>

### reaped/fix/cache-directory-stable-20261113-be984a (3b4bc3abcb12, 2026-11-13, +1/-1736)

- 3b4bc3abcb [adds] worktree-reap snapshot of <path>

### reaped/fix/chat-information-density-20261022-20261113-c3222c (820f8a9d9b21, 2026-11-13, +4/-1792)

- 655eb0c91a [conflict] fix(tool-format): keep command identity for ACP plain-text terminal calls
- 15c0f7ffb7 [conflict] fix(chat): show each tool call's target, state and failure line inline
- a2dc84aedf [adds] test(chat): rendered density proof on Expo web at 390 and 412 px
- 820f8a9d9b [present] worktree-reap snapshot of <path>

### reaped/fix/composer-voice-navigation-20261021-20261113-c03b2d (6045b9f849ec, 2026-11-13, +1/-1962)

- 6045b9f849 [adds] worktree-reap snapshot of <path>

### reaped/fix/core-history-refresh-20261029-20261113-719e66 (381daf384261, 2026-11-13, +2/-481)

- ec9f8482b0 [conflict] fix: preserve phone turns and native ACP continuation
- 381daf3842 [present] worktree-reap snapshot of <path>

### reaped/fix/dex-gradle-deps-20261113-79991e (f8c72f85c406, 2026-11-13, +82/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 980dda5636 [conflict] feat(dex): desk mode — multi-pane DeX / wide-window dashboard (#554)
- 89d1798f3f [conflict] fix(dex): rail tabs expose aria-selected; desk docs; override spec waits for phone tabs
- 23c419b356 [conflict] fix(dex): detect One UI 9 launcher DeX (S25 Ultra) from desktop windowing; live phone-queue shape
- fd919e1a0f [conflict] fix(dex): desk layout radios expose aria-checked; keyboard spec returns from the full chat with Ctrl+3
- 4877cdf0d2 [present] test(dex): split the desk override journey (URL vs Settings) and return to Orchestra via its tab state
- 9a035d558e [present] test(dex): right-click row menu asserted through the action sheet like send-longpress
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 7d29edb5c1 [conflict] fix(compose-613): ref the desk row frame and pass focused to desk Orchestra pane
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 944b6c442a [adds] test(dex): right-click asserts the anchored chat-row-actions-menu like send-longpress
- 7e1ac280c6 [adds] fix(history): refresh same-id older and prompt-rail pages from bridge source
- a1c6cff8ec [adds] fix(history): revoke older-page visit when chat window loses focus
- faadfe60bf [adds] test(army): verify reopened native prompt reads changed same-id source
- 21259ddf2a [adds] test(army): register reopened native source journey in O15 inventory
- 5f71196d3e [adds] fix(chat): keep reader's upward wheel ahead of background layout
- f273282e30 [adds] test(chat): cover wheel ownership during phone transcript paging
- 90ab69988c [adds] fix(chat): keep reader's upward wheel ahead of background layout
- a0d32ef4bd [adds] fix(chat): keep reader's upward wheel ahead of background layout
- d46e872ed3 [conflict] test(chat): cover wheel ownership during phone transcript paging
- 9607474878 [adds] test(chat): cover wheel ownership during phone transcript paging
- 993cf7f5d0 [conflict] fix(history): scope page ownership to each focused chat visit
- 6453e7e338 [conflict] fix(history): retain newest-page cursor while refreshing native source rows
- 45906a3dad [conflict] fix(history): refresh native sources and isolate each focused visit
- 34a64281f5 [conflict] fix(history): recover cursor if a concurrent transcript refresh wins
- 602e56a893 [conflict] test(army): reproduce reopened native rail at 390px
- 3593b3288c [conflict] fix(history): reconcile full native source window and reject stale expansions
- 5ac1d02ca1 [conflict] fix(army): retry seed-trace-live DB locks; accept either restored pane for first cwd load
- a1cc4cbfb1 [conflict] fix(history): preserve newest-page cursor and scope expansions to request source
- b43dafa016 [conflict] fix(history): keep reopened native source cursor until same-id rail pages refresh
- 34af134ce4 [conflict] fix(bridge): stop caching older history pages; native rows change under the same cursor
- 84b8a49393 [adds] fix(chat): scope delayed window pop to its owning route
- 4f17e746ac [adds] fix(chat): make window close idempotent and ignore unfocused hardware Back
- faaaa5edf9 [adds] test(chat): prove stale close cannot pop the focused chat
- 7a8f27c36e [adds] test(dex): exercise stale window close across quick switch with real bridge
- 24ecb8b512 [adds] test(dex): register route-owned close in O15 army inventory
- 6acff6ddda [adds] fix(dex): declare react-android and expo deps for DashPadActivity
- f8c72f85c4 [present] worktree-reap snapshot of <path>

### reaped/fix/endpoint-ownership-20261029-20261113-66d630 (0b6b06f9c6c2, 2026-11-13, +1/-480)

- 0b6b06f9c6 [conflict] worktree-reap snapshot of <path>

### reaped/fix/heavy-test-timeouts-2bedab2-20261113-4d2acc (11c6105ebf25, 2026-11-13, +7/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 3d80853783 [conflict] test: explicit 30 s timeout for large-payload row-budget and agentsview head tests
- 1378be0db0 [conflict] test: move row-budget timeout const out of the import list
- 11c6105ebf [present] worktree-reap snapshot of <path>

### reaped/fix/hello-admission-watchdog-20261029-20261113-74cfe0 (b40604764e26, 2026-11-13, +1/-482)

- b40604764e [conflict] worktree-reap snapshot of <path>

### reaped/fix/hide-status-bar-20261025-20261113-9bcc0d (3f4970a912df, 2026-11-13, +1/-1741)

- 3f4970a912 [adds] worktree-reap snapshot of <path>

### reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699 (f19f7109b32f, 2026-11-13, +10/-397)

- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- b3e506fae5 [conflict] fix(hosts): one level per kind: host > harness > profile > chat
- 4661d722ed [adds] test(army): expand a computer host and read back host > harness > profile > chat
- 16d73b9d13 [conflict] test(army): find the Codex chat row by its visible title
- 94c2229d4a [conflict] test(army): read tree levels in on-screen order
- fe03bfbbed [conflict] fix(hosts): singular counts for one, and Grok/fx harness labels
- f19f7109b3 [present] worktree-reap snapshot of <path>

### reaped/fix/hosts-tree-hierarchy-main-20261105-20261113-fecfd9 (00ce21576565, 2026-11-13, +7/-326)

- ae074a0c43 [conflict] fix(hosts): one level per kind: host > harness > profile > chat
- e7facab7e3 [adds] test(army): expand a computer host and read back host > harness > profile > chat
- 7e7ca63016 [conflict] test(army): find the Codex chat row by its visible title
- 8592a81e58 [conflict] test(army): read tree levels in on-screen order
- fd777e4707 [conflict] fix(hosts): singular counts for one, and Grok/fx harness labels
- 00ce215765 [present] worktree-reap snapshot of <path>

### reaped/fix/legacy-recovery-20261029-20261113-32068a (15925797a986, 2026-11-13, +1/-478)

- 15925797a9 [conflict] worktree-reap snapshot of <path>

### reaped/fix/memory-leak-20261025-20261113-f9fe24 (f277a40a1134, 2026-11-13, +1/-1740)

- f277a40a11 [adds] worktree-reap snapshot of <path>

### reaped/fix/orb-smooth-20261113-f4f5ac (9ee92837e6f5, 2026-11-13, +1/-1799)

- 9ee92837e6 [conflict] worktree-reap snapshot of <path>

### reaped/fix/subagent-indicator-20261025-20261113-d8469e (061bcaa3b84f, 2026-11-13, +3/-1741)

- 49e7f501a4 [conflict] test(chat): isolate native draft mocks and qualify restored workers
- 061bcaa3b8 [present] worktree-reap snapshot of <path>

### reaped/fix/summary-transport-20261113-657a58 (62a9cf9de23a, 2026-11-13, +2/-1805)

- 34420f97fd [conflict] fix: route smol summaries through bounded Hermes Codex OAuth
- 62a9cf9de2 [adds] worktree-reap snapshot of <path>

### reaped/fix/terminal-retention-w05-20261029-20261113-f0a46f (f5447c62faa4, 2026-11-13, +1/-482)

- f5447c62fa [conflict] worktree-reap snapshot of <path>

### reaped/fix/triage-running-north-star-20261028-20261113-1a9c83 (edd77c0632f5, 2026-11-13, +1/-465)

- edd77c0632 [conflict] worktree-reap snapshot of <path>

### reaped/fix/voice-controls-20261022-20261113-205f32 (8664b4f9955a, 2026-11-13, +3/-1746)

- eb114e4a84 [conflict] perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- e293a2f089 [conflict] test(faces): verify native-view gaze after Fabric fix
- 8664b4f995 [present] worktree-reap snapshot of <path>

### reaped/fix/worklet-easing-20261113-4875e5 (c434a2696014, 2026-11-13, +1/-1852)

- c434a26960 [adds] worktree-reap snapshot of <path>

### reaped/fix/workspace-navigation-recovery-20261113-3b003d (d574bc32bb7d, 2026-11-13, +1/-1793)

- d574bc32bb [adds] worktree-reap snapshot of <path>

### reaped/history-ownership-20261029-20261113-22a1b5 (160d21b23814, 2026-11-13, +1/-480)

- 160d21b238 [conflict] worktree-reap snapshot of <path>

### reaped/integ/turbo-c30-c13-20261103-20261113-8c00dd (5c5bcbf60a44, 2026-11-13, +2/-417)

- 5c5bcbf60a [adds] worktree-reap snapshot of <path>

### reaped/integrate/botface-fabric-hotfix-20261022-20261113-edd944 (fb257d8648e5, 2026-11-13, +3/-1746)

- eb114e4a84 [conflict] perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- e293a2f089 [conflict] test(faces): verify native-view gaze after Fabric fix
- fb257d8648 [present] worktree-reap snapshot of <path>

### reaped/integrate/dash-20261020-work-20261113-4075e3 (b550abd0d618, 2026-11-13, +1/-1881)

- b550abd0d6 [adds] worktree-reap snapshot of <path>

### reaped/integrate/lab-press-ownership-20261021-20261113-490310 (0bdd8aa30327, 2026-11-13, +1/-1856)

- 0bdd8aa303 [adds] worktree-reap snapshot of <path>

### reaped/integrate/motion-speed-pass2-rollout-20261021-20261113-056183 (e100dde4bb5c, 2026-11-13, +1/-1853)

- e100dde4bb [adds] worktree-reap snapshot of <path>

### reaped/lab-polish-before-20261113-b029bb (03143b3e4cdb, 2026-11-13, +1/-1871)

- 03143b3e4c [conflict] worktree-reap snapshot of <path>

### reaped/lane-w4-1927-20261113-b92c0f (f614fca0e2a5, 2026-11-13, +1/-1109)

- f614fca0e2 [adds] worktree-reap snapshot of <path>

### reaped/lane-w5-2130-20261113-59973f (6b6c19b3a2cd, 2026-11-13, +1/-1030)

- 6b6c19b3a2 [adds] worktree-reap snapshot of <path>

### reaped/lane/compose-637-on-04122b3e-20261105-20261113-1605c0 (35d2e34536ff, 2026-11-13, +20/-327)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- 35d2e34536 [adds] worktree-reap snapshot of <path>

### reaped/lane/compose-642-643-20261106-20261113-f2217c (8dca70d05be0, 2026-11-13, +42/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- 9ff03f8137 [adds] ci(army): cache apt debs and retry; 60 min job budget (mirror stalls cancelled df87bcbe/da2e19f0 armies)
- fdcffe47f1 [adds] fix(omp): retain pane-owned cwd and reject ambiguous restores on turbo lane
- a3a387cf7b [adds] test(omp): port #641 pane cwd and ACP session/load regression
- 4eab2e3706 [conflict] fix(composer): deliver the first web Send press after opening a chat
- ca305c7cbf [adds] test(army): pin exact-once first send from archived Claude chat
- 57b086a4f0 [adds] test(army): inventory archived chat first-send regression
- 81514cd9d2 [conflict] fix(army): make native SQLite writer retry locks and report stderr
- bf7e4b3e30 [conflict] fix(omp): keep unselected collision ambiguous across roster refreshes
- 8dca70d05b [adds] worktree-reap snapshot of <path>

### reaped/lane/compose-w2-1800-20261113-089e92 (c750f01a0123, 2026-11-13, +1/-1335)

- c750f01a01 [adds] worktree-reap snapshot of <path>

### reaped/lane/compose-wave-630-636-637-20261104-20261113-97ccf7 (b4e5cd465962, 2026-11-13, +11/-329)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- b4e5cd4659 [adds] worktree-reap snapshot of <path>

### reaped/lane/fix-208-live-correlation-20261113-b8f467 (aae4fabdad76, 2026-11-13, +1/-1331)

- aae4fabdad [adds] worktree-reap snapshot of <path>

### reaped/lane/fix-send-anchors-20261105-20261113-f50e3f (aee9075415fd, 2026-11-13, +32/-327)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- df87bcbed9 [adds] fix(laws): re-anchor send S1-S4 Chats long-press and pick to the anchored row menu (#630)
- aee9075415 [present] worktree-reap snapshot of <path>

### reaped/lane/gate-222b-20261113-473542 (5abd8e68a460, 2026-11-13, +1/-1325)

- 5abd8e68a4 [adds] worktree-reap snapshot of <path>

### reaped/lane/native-c09-c18-20261113-b6d5cf (4ea79d4e75b8, 2026-11-13, +12/-397)

- 9de608423e [conflict] TURBO-C09: route live WebRTC output to Android loudspeaker
- 52387fe3a4 [conflict] feat(android): port DashStylus S Pen entry and native receipts (TURBO-C18)
- 9e9a3ffeba [conflict] fix(android): clear stale DashStylus Gradle receipts before native build
- 669cae62ad [conflict] fix(android): preserve motion dispatch and detach observer while backgrounded
- 3faa5d47c0 [conflict] fix(android): guarantee window callback restoration if event emitter fails
- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- 4ea79d4e75 [adds] worktree-reap snapshot of <path>

### reaped/lane/pr634-test-20261113-237001 (0d5f86cdda2c, 2026-11-13, +2/-397)

- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 0d5f86cdda [adds] worktree-reap snapshot of <path>

### reaped/lane/wire-634-20261105-20261113-7668b2 (fd1f1d227bc5, 2026-11-13, +24/-327)

- b4944fd00d [conflict] fix(feedback): preserve named conversation title on first steer
- f3cd0c782b [adds] fix(feedback): retain Dash feedback thread identity and safe empty-note fallback
- 5e0d783508 [adds] test(army): cover Orchestra cold-open and secondmate feedback flows
- fa6ba3ba1f [adds] test(army): register Dash #29 self-development feedback journey
- 9598386fca [adds] feat(bridge): derive status-only subagents from transcript tool events
- 1d00dff165 [conflict] test(army): target accessible feedback menu and scoped Settings action
- 89b2ec0cf0 [conflict] fix(feedback): anchor chat row actions and expose web switch state (#29)
- bd178185ab [conflict] fix(chats): deliver web row holds through Pressable and preserve pager swipe cancellation
- c91dd06cd1 [conflict] test(army): assert the opened Dash feedback window, not the ambiguous row+heading text
- 8292948c79 [conflict] fix(feedback): use StyleSheet.absoluteFill for row-menu backdrop (RN 0.86 has no absoluteFillObject)
- 1b6f584b60 [conflict] test(army): assert the visible feedback transcript reply, not the hidden row preview
- 2e2aebbd5d [conflict] fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- 2306acbcbc [conflict] Revert "fix(main): keep attached dock mounted behind chat to preserve transcript scroll"
- e30d515180 [adds] fix(main): suspend hidden chat subscriptions and search while transcript owns focus
- 91a95306e5 [conflict] test(army): match real older-history URL in background-scroll journey
- 5d3c43766f [conflict] test(army): assert transcript instead of windowed-only chat-window after Open attached chat
- cb4793007f [conflict] feat(workers): serve transcript-derived subagents on /chat/workers and show them for Claude/Codex/OMP chats (DF-046, #634)
- be28f4644d [conflict] fix(workers): keep Hermes worker polling on every target host; transcript workers stay local-only
- fd1f1d227b [adds] worktree-reap snapshot of <path>

### reaped/native-consumer-ownership-20261029-20261113-718542 (a06a512a6a74, 2026-11-13, +1/-478)

- a06a512a6a [conflict] worktree-reap snapshot of <path>

### reaped/notice/elemental-ui-20261113-79ac5e (39f6d02a75ff, 2026-11-13, +6/-397)

- 517da93342 [adds] feat(flow): parse trace dumps into per-turn stage-pair samples
- e2442f2c8a [adds] Add NOTICE for elemental-ui assets
- 39f6d02a75 [present] worktree-reap snapshot of <path>

### reaped/omp/d41-page-controls-20261113-ad36dd (e58a41313697, 2026-11-13, +5/-1792)

- 9a482d3ea7 [adds] test(d41): capture WIP registry replacement ownership regression
- fa29c50c73 [conflict] feat(d41): qualify focused page registry and expose Orchestra controls
- 72ee26a206 [conflict] test(d41): supply required host identity in control fixtures
- 4692e4e94b [conflict] test(d41): target the owned fixture action button directly
- e58a413136 [present] worktree-reap snapshot of <path>

### reaped/omp/fix-botface-ui-thread-20261113-f5c1ad (b550a7a7d6db, 2026-11-13, +2/-1746)

- eb114e4a84 [conflict] perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- b550a7a7d6 [present] worktree-reap snapshot of <path>

### reaped/program/composer-20261022-20261113-0fdee4 (1deb6c539277, 2026-11-13, +5/-1793)

- 0cba27d38c [conflict] feat(input): port attached dock and agent controls onto full-width composer
- b9679827d1 [conflict] feat(composer): scope approval badge to the attached session and show honest token speed
- cba6fc1326 [conflict] test(composer): prove controls, dock and send target in the rendered app
- 8a7790048c [conflict] test(composer): prove approval prompts are session-scoped and never decide
- 1deb6c5392 [present] worktree-reap snapshot of <path>

### reaped/program/trace-20261022-20261113-2b3676 (7f6843cb07a9, 2026-11-13, +9/-1793)

- fbb7e9a141 [conflict] feat(trace): add private intent evidence feed and artifact review cards
- c69a216c5b [conflict] fix(trace): preserve embedded owner asks and bounded attachment evidence
- 382f5dfa31 [conflict] fix(trace): expand proof images and fence stale artifact reads
- ea8bad03f5 [conflict] fix(trace): expose metrics expansion state to web accessibility
- 2e9d3123cf [conflict] feat(trace): show only live bridge events with explicit unavailable states
- 45092f391a [conflict] feat(trace): lead details with request, goal and per-check acceptance; row-local actions
- 7748ebc54b [conflict] fix(trace): entry card reflects pairing before Trace first loads; proof checks image artifacts
- 3c9ff7dd13 [conflict] fix(trace): goal reads unknown when no request was recorded
- 7f6843cb07 [present] worktree-reap snapshot of <path>

### reaped/proto/agent-trace-20261020-20261113-b289b6 (552a202b8ee2, 2026-11-13, +5/-1971)

- 552a202b8e [adds] worktree-reap snapshot of <path>

### reaped/qualify/lane-20261025-w1-20261113-5d41e4 (62246fbedecc, 2026-11-13, +12/-1717)

- 62246fbede [adds] worktree-reap snapshot of <path>

### reaped/qualify/lane-20261025-w2-20261113-1f3d28 (257a02edd8f6, 2026-11-13, +1/-1713)

- 257a02edd8 [adds] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-bridge-usage-20261113-16119c (9f02c48a314c, 2026-11-13, +3/-1839)

- 39f40abf13 [conflict] feat(bridge): compose read-only usage metadata without compaction
- 9f02c48a31 [present] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-bridge-voice-contract-20261113-76065b (cb80835ecf01, 2026-11-13, +4/-1839)

- 39f40abf13 [conflict] feat(bridge): compose read-only usage metadata without compaction
- 294fc82fef [conflict] test(bridge): assert native voice legacy identity denial contract
- cb80835ecf [present] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-memory-20261113-e34b3f (24e06cbce370, 2026-11-13, +1/-1740)

- 24e06cbce3 [adds] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-memory-context-20261113-1a6cb6 (07044d40312a, 2026-11-13, +1/-1730)

- 07044d4031 [adds] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-memory-context-fixture-20261113-024a60 (b35c5c3e067a, 2026-11-13, +1/-1729)

- b35c5c3e06 [adds] worktree-reap snapshot of <path>

### reaped/qualify/turbo-20261025-memory-context-lane-20261113-d0ec32 (be61273360c6, 2026-11-13, +2/-1601)

- be61273360 [adds] worktree-reap snapshot of <path>

### reaped/rc3-roadmap-resume-apk-20261113-a84706 (d015c1d10950, 2026-11-13, +1/-954)

- d015c1d109 [adds] worktree-reap snapshot of <path>

### reaped/release/dash-main-squash-20261027-20261113-930765 (dac7173e7210, 2026-11-13, +2/-2071)

- 64bb3f16e7 [conflict] Dash: turbo line to main (squash of integ/travel-turbo-20261027 @ 46cd598)
- dac7173e72 [present] worktree-reap snapshot of <path>

### reaped/roster-actionability-20261029-20261113-5962dd (d74f374e0d7d, 2026-11-13, +1/-480)

- d74f374e0d [conflict] worktree-reap snapshot of <path>

### reaped/sol/agent-popup-20261021-20261113-0e9e72 (23c1bc863343, 2026-11-13, +2/-1805)

- f217dbefac [conflict] feat(input): add agent controls and authenticated recent-model evidence
- 23c1bc8633 [adds] worktree-reap snapshot of <path>

### reaped/sol/attached-dock-20261021-20261113-ae9420 (00cf7f03ef9f, 2026-11-13, +4/-1805)

- 3aa128a5f1 [conflict] fix(input): preserve system dictation and prevent external voice handoff
- d7306b4e24 [conflict] feat(input): keep session composer attached across navigation with compact peek
- 8b6beee49e [conflict] feat(input): add agent controls and authenticated recent-model evidence
- 00cf7f03ef [adds] worktree-reap snapshot of <path>

### reaped/sol/bot-faces-20261021-20261113-9d1709 (710b68b0ff7c, 2026-11-13, +3/-1805)

- 2948940aac [conflict] wip(bots): preserve interrupted deterministic face implementation
- 710b68b0ff [conflict] worktree-reap snapshot of <path>

### reaped/sol/dash-steer-rollout-20261021-20261113-6a0114 (76ee5313a6ac, 2026-11-13, +1/-1878)

- 76ee5313a6 [adds] worktree-reap snapshot of <path>

### reaped/sol/merge-queued-20261021-20261113-627cb3 (ad2ece71ecf0, 2026-11-13, +1/-1868)

- ad2ece71ec [adds] worktree-reap snapshot of <path>

### reaped/sol/mic-dictation-20261021-20261113-846425 (ea52214d0566, 2026-11-13, +2/-1805)

- ea22554f68 [conflict] fix(input): preserve system dictation and prevent external voice handoff
- ea52214d05 [adds] worktree-reap snapshot of <path>

### reaped/sol/model-roles-20261021-20261113-bf499f (0d5bdd14e4c6, 2026-11-13, +1/-1913)

- 0d5bdd14e4 [adds] worktree-reap snapshot of <path>

### reaped/sol/trace-intent-20261021-20261113-4b1018 (01bb48adfa80, 2026-11-13, +5/-1805)

- 460ed87c2e [conflict] feat(trace): add private intent evidence feed and artifact review cards
- bc79f827c3 [conflict] fix(trace): preserve embedded owner asks and bounded attachment evidence
- 77a8c6fd8b [conflict] fix(trace): expand proof images and fence stale artifact reads
- 9fb1d7f104 [conflict] fix(trace): expose metrics expansion state to web accessibility
- 01bb48adfa [adds] worktree-reap snapshot of <path>

### reaped/turbo/cand-turbo02-20261025-20261113-779b3e (8fcd08d322c0, 2026-11-13, +1/-1465)

- 8fcd08d322 [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-2a7d17b-app-20261113-7bf620 (713eb25861c8, 2026-11-13, +10/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 25ec7e5253 [adds] turbo: lane slice d711b34..2a7d17b (add-only flow modules: brainstorm-mode, ink-coalescer, turn-fuse, visual-pane, ink-envelope, flow-latency receipt)
- ce3d10fb01 [conflict] test: explicit 30 s timeout for large-payload row-budget and agentsview head tests
- 374f06a4f6 [conflict] test: move row-budget timeout const out of the import list
- 39dbfefad6 [conflict] test: chat-index-scale ratios take best of 4 interleaved runs (full-suite load flake)
- 4bc128ed0f [conflict] test: load-tolerant bounds for chat-index scale ratio (8x) and busy-scan RPC timeout (5 s)
- 713eb25861 [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-72672e4-app-20261113-119b19 (d172664f4516, 2026-11-13, +1/-1461)

- d172664f45 [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-78a2fdb-20261113-7d8362 (70e1bbd7cbb0, 2026-11-13, +4/-1263)

- 87fdc2dd16 [conflict] test(integ): retarget connection-pill a11y source assertion to the turbo banner
- 3d67cedba9 [conflict] test(integ): lost-turn parts live on the checkpointed message after turbo's settled-reply cache release
- 70e1bbd7cb [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-78a2fdb-app-20261113-6b944b (8433991f5c2e, 2026-11-13, +1/-1462)

- 8433991f5c [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-d711b34-app-20261113-1401ab (8ebd81e28328, 2026-11-13, +3/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 8ebd81e283 [adds] worktree-reap snapshot of <path>

### reaped/turbo/candidate-e0175a5-app-20261113-afe6b5 (22f31174414d, 2026-11-13, +1/-1460)

- 22f3117441 [adds] worktree-reap snapshot of <path>

### reaped/turbo/dash-live-20261021-20261113-a3e1a9 (306deef66f6c, 2026-11-13, +2/-1805)

- 306deef66f [adds] worktree-reap snapshot of <path>

### reaped/turbo/dash-live-20261025-20261113-41dcf2 (c5e41ce24993, 2026-11-13, +10/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 25ec7e5253 [adds] turbo: lane slice d711b34..2a7d17b (add-only flow modules: brainstorm-mode, ink-coalescer, turn-fuse, visual-pane, ink-envelope, flow-latency receipt)
- ce3d10fb01 [conflict] test: explicit 30 s timeout for large-payload row-budget and agentsview head tests
- 374f06a4f6 [conflict] test: move row-budget timeout const out of the import list
- 39dbfefad6 [conflict] test: chat-index-scale ratios take best of 4 interleaved runs (full-suite load flake)
- 4bc128ed0f [conflict] test: load-tolerant bounds for chat-index scale ratio (8x) and busy-scan RPC timeout (5 s)
- c5e41ce249 [adds] worktree-reap snapshot of <path>

### reaped/turbo/fix-tests-f21db40-20261113-51a302 (21be4a658987, 2026-11-13, +5/-1426)

- c7d757dbf5 [conflict] turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 store mock, #388/#383 ui-control v1); keep turbo notices target in hardened notification-link parser
- f21db403cb [conflict] turbo: lane slice d8af0e7..d711b34 (PRs #423-#452, add-only modules/tests)
- 2bedab2bbc [conflict] test: keep BottomActionSheet's react-native exports in selection-quote's process-wide mock
- 21be4a6589 [adds] worktree-reap snapshot of <path>

### reaped/worker/dash-pages-20261113-89975d (033a5cfc4c63, 2026-11-13, +1/-2032)

- 033a5cfc4c [adds] worktree-reap snapshot of <path>

### reaped/wt/compose-1230-20261113-000f21 (2276d246adcf, 2026-11-13, +1/-1144)

- 2276d246ad [adds] worktree-reap snapshot of <path>

### wip/salvage/20261027/dash-lane-compose-c029acf-630dd6e-20261105 (72672e4f768b, 2026-10-25, +1/-1235)


### wip/salvage/20261027/dash-specs-20261105 (97921a4edf66, 2026-10-27, +1/-1741)

- 97921a4edf [adds] salvage: abandoned work from <path> (spec/formal-specs-20261025)

### wip/stt-bisect-allbridge-1105 (a8b77dab0bd6, 2026-11-05, +1/-325)

- a8b77dab0b [conflict] bisect: 0ae86005 with all bridge/shared files reverted to d9762906 (STT probe)

### wip/stt-bisect-client-1105 (6232b8134b3a, 2026-11-05, +1/-325)

- 6232b8134b [adds] bisect: 0ae86005 with client reverted to d9762906 (STT probe)

### wip/stt-bisect-index-1105 (69b29399e93b, 2026-11-05, +1/-325)

- 69b29399e9 [conflict] bisect: 0ae86005 with index reverted to d9762906 (STT probe)

### wip/stt-bisect-parse-1105 (08176cc216d9, 2026-11-05, +1/-325)

- 08176cc216 [adds] bisect: 0ae86005 without parseClientMessage model hunks (STT probe)
