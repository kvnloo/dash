# Owner laws, universally quantified over the actual MODEL.decide / MODEL.may_stop domain.
# Derived from the 2026-10-25 Dash feature ledger: agent reports claimed features done
# on unit tests, on another sha or without a device run; runs stopped on budget.
# No theorem here verifies a receipt, a device or a sha; see scripts/feature_status.py.
import Base
import ./MODEL.bend as M

law done_needs_all_evidence:
  {M.decide(M.BNone{}, True{}, True{}, M.JPassCandidate{}, M.PDelivered{}) == M.SDone{} : M.Status}

law no_journey_never_done:
  for s: Bool
  for c: Bool
  for p: M.Preview
  {M.decide(M.BNone{}, s, c, M.JNone{}, p) == M.SOpen{} : M.Status}

law failed_journey_never_done:
  for s: Bool
  for c: Bool
  for p: M.Preview
  {M.decide(M.BNone{}, s, c, M.JFail{}, p) == M.SOpen{} : M.Status}

law stale_sha_never_done:
  for s: Bool
  for c: Bool
  for p: M.Preview
  {M.decide(M.BNone{}, s, c, M.JPassOtherSha{}, p) == M.SOpen{} : M.Status}

law missing_preview_never_done:
  for s: Bool
  for c: Bool
  {M.decide(M.BNone{}, s, c, M.JPassCandidate{}, M.PNone{}) == M.SOpen{} : M.Status}

law missing_code_never_done:
  for s: Bool
  {M.decide(M.BNone{}, s, False{}, M.JPassCandidate{}, M.PDelivered{}) == M.SOpen{} : M.Status}

law unlinked_spec_never_done:
  {M.decide(M.BNone{}, False{}, True{}, M.JPassCandidate{}, M.PDelivered{}) == M.SOpen{} : M.Status}

law owner_blocker_blocks:
  for s: Bool
  for c: Bool
  for j: M.Journey
  for p: M.Preview
  {M.decide(M.BOwner{}, s, c, j, p) == M.SBlockedOwner{} : M.Status}

law external_blocker_blocks:
  for s: Bool
  for c: Bool
  for j: M.Journey
  for p: M.Preview
  {M.decide(M.BExternal{}, s, c, j, p) == M.SBlockedExternal{} : M.Status}

law blocker_without_reason_is_no_blocker:
  for s: Bool
  for c: Bool
  for j: M.Journey
  for p: M.Preview
  {M.decide(M.BNoReason{}, s, c, j, p) == M.evidence(s, c, j, p) : M.Status}

law blocker_without_reason_stays_open:
  for s: Bool
  for c: Bool
  for p: M.Preview
  {M.decide(M.BNoReason{}, s, c, M.JNone{}, p) == M.SOpen{} : M.Status}

law owner_stop_stops:
  for a: Bool
  for b: Bool
  {M.may_stop(a, b, True{}) == M.RStopOwner{} : M.Run}

law complete_scope_stops:
  for b: Bool
  {M.may_stop(True{}, b, False{}) == M.RStopComplete{} : M.Run}

law budget_alone_pauses_with_report:
  {M.may_stop(False{}, True{}, False{}) == M.RPauseReport{} : M.Run}

law open_work_continues:
  {M.may_stop(False{}, False{}, False{}) == M.RContinue{} : M.Run}
