# Feature completion: may a feature be called Done, and may an autonomous run stop?
# The operational decision is scripts/feature_status.py (decide_status, may_stop),
# which reads spec/features.yaml and a directory of receipt JSON files.
# Observation of the inputs (receipt authenticity, device identity, sha) is not
# proven here; the CLI fails closed on anything it cannot classify.
import Base

# Device journey receipt for this feature, relative to the candidate sha.
type Journey is Data:
  JNone{}
  JFail{}
  JPassOtherSha{}
  JPassCandidate{}

# Owner preview receipt for the candidate sha.
type Preview is Data:
  PNone{}
  PDelivered{}

# Explicit blocker. BNoReason is a blocker claim without a reason: it is not a blocker.
type Blocker is Data:
  BNone{}
  BNoReason{}
  BOwner{}
  BExternal{}

type Status is Data:
  SOpen{}
  SDone{}
  SBlockedOwner{}
  SBlockedExternal{}

def check_spec(spec_linked: Bool) -> Status:
  match spec_linked:
    case True{}:
      SDone{}
    case False{}:
      SOpen{}

def check_code(code_present: Bool, spec_linked: Bool) -> Status:
  match code_present:
    case True{}:
      check_spec(spec_linked)
    case False{}:
      SOpen{}

def check_preview(preview: Preview, code_present: Bool, spec_linked: Bool) -> Status:
  match preview:
    case PNone{}:
      SOpen{}
    case PDelivered{}:
      check_code(code_present, spec_linked)

def evidence(spec_linked: Bool, code_present: Bool, journey: Journey, preview: Preview) -> Status:
  match journey:
    case JNone{}:
      SOpen{}
    case JFail{}:
      SOpen{}
    case JPassOtherSha{}:
      SOpen{}
    case JPassCandidate{}:
      check_preview(preview, code_present, spec_linked)

# An explicit blocker with a reason wins over evidence (never a false Done).
def decide(blocked: Blocker, spec_linked: Bool, code_present: Bool, journey: Journey, preview: Preview) -> Status:
  match blocked:
    case BNone{}:
      evidence(spec_linked, code_present, journey, preview)
    case BNoReason{}:
      evidence(spec_linked, code_present, journey, preview)
    case BOwner{}:
      SBlockedOwner{}
    case BExternal{}:
      SBlockedExternal{}

# Run stop rule. No early stop: budget exhaustion alone is a pause with a report, and a
# scope that is settled only because some feature is externally blocked is also a pause
# with a report (the owner reviews the external blockers); only Done/owner-blocked completes.
type Run is Data:
  RContinue{}
  RPauseReport{}
  RStopComplete{}
  RStopOwner{}

def check_budget(budget_exhausted: Bool) -> Run:
  match budget_exhausted:
    case True{}:
      RPauseReport{}
    case False{}:
      RContinue{}

def check_external(any_external_blocked: Bool) -> Run:
  match any_external_blocked:
    case True{}:
      RPauseReport{}
    case False{}:
      RStopComplete{}

def check_scope(all_done_or_blocked: Bool, any_external_blocked: Bool, budget_exhausted: Bool) -> Run:
  match all_done_or_blocked:
    case True{}:
      check_external(any_external_blocked)
    case False{}:
      check_budget(budget_exhausted)

def may_stop(all_done_or_blocked: Bool, any_external_blocked: Bool, budget_exhausted: Bool, owner_stop: Bool) -> Run:
  match owner_stop:
    case True{}:
      RStopOwner{}
    case False{}:
      check_scope(all_done_or_blocked, any_external_blocked, budget_exhausted)

# Exhaustive Python/Bend parity uses these lossless codes.
def status_code(s: Status) -> Nat:
  match s:
    case SOpen{}:
      0n
    case SDone{}:
      1n
    case SBlockedOwner{}:
      2n
    case SBlockedExternal{}:
      3n

def run_code(r: Run) -> Nat:
  match r:
    case RContinue{}:
      0n
    case RPauseReport{}:
      1n
    case RStopComplete{}:
      2n
    case RStopOwner{}:
      3n
