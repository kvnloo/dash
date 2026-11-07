# All proofs implement the exact, owner-reviewed LAWS.bend signatures.
# Do not weaken LAWS to make --verdict pass.
import Base
import ./MODEL.bend as M
import ./LAWS.bend as Laws

def Laws.done_needs_all_evidence():
  {==}

def Laws.no_journey_never_done(s, c, p):
  {==}

def Laws.failed_journey_never_done(s, c, p):
  {==}

def Laws.stale_sha_never_done(s, c, p):
  {==}

def Laws.missing_preview_never_done(s, c):
  {==}

def Laws.missing_code_never_done(s):
  {==}

def Laws.unlinked_spec_never_done():
  {==}

def Laws.owner_blocker_blocks(s, c, j, p):
  {==}

def Laws.external_blocker_blocks(s, c, j, p):
  {==}

def Laws.blocker_without_reason_is_no_blocker(s, c, j, p):
  {==}

def Laws.blocker_without_reason_stays_open(s, c, p):
  {==}

def Laws.owner_stop_stops(a, e, b):
  {==}

def Laws.complete_scope_stops(b):
  {==}

def Laws.external_blocked_scope_pauses_with_report(b):
  {==}

def Laws.budget_alone_pauses_with_report(e):
  {==}

def Laws.open_work_continues(e):
  {==}
