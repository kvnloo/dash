import Base
import ./MODEL.bend as M

law missing_spec:
  for c: Bool
  for t: Bool
  {M.traceable(False{}, c, t) == False{} : Bool}

law missing_code:
  for t: Bool
  {M.traceable(True{}, False{}, t) == False{} : Bool}

law missing_test:
  {M.traceable(True{}, True{}, False{}) == False{} : Bool}

law complete_trace:
  {M.traceable(True{}, True{}, True{}) == True{} : Bool}
