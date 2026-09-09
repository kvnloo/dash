GOAL         Chat, Composer, and the turn store stream deltas without putting tokens in the chats store.
SCOPE        Chat screens, Composer, store/app.ts turn pipeline, store/text.ts. Worktree `.worktrees/chat-core` branch `svc/chat-core`.
CONTEXT      .cursor/skills/verify-dash/features/chat.md
ACCEPTANCE   Streaming text goes through store/text.ts; debug scenario chat-omp still opens
VERIFY       bun test for any store helpers you add; optional debug web 8099 scenario chat-omp
TIMEBOX      60m
FORBIDDEN    no pairing, no roster
REPORT       status, branch, head SHA, what you ran
STANDING     orchestrate/dash/preferences.md
