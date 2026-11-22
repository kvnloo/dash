# The repository adapter resolves the spec, implementation, and test links.
# This is a structural gate, not a device receipt or a proof of product behavior.
import Base

def traceable(spec: Bool, code: Bool, test: Bool) -> Bool:
  match spec:
    case False{}:
      False{}
    case True{}:
      match code:
        case False{}:
          False{}
        case True{}:
          test
