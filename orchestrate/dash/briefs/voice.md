GOAL         Spoken turns record on device, transcribe on the laptop, and speak the reply.
SCOPE        VoiceScreen, vad, speak, voice-session, voice_* events. Worktree `.worktrees/voice` branch `svc/voice`.
CONTEXT      .cursor/skills/verify-dash/features/voice.md
ACCEPTANCE   Voice screen opens from expand; unit tests around session machine stay green
VERIFY       Feature map voice.md. Live mic needs the phone. Do not fake WAV decode on Android.
TIMEBOX      60m
FORBIDDEN    no pairing, no AppNav
REPORT       status, branch, head SHA, what you ran
STANDING     orchestrate/dash/preferences.md
