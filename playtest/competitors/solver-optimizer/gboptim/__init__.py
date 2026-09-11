"""gboptim -- support package for the Geometry Battle V1.1 optimization solver.

Modules
-------
astlib     DSL node builders + structural limits (nodes / depth / constants)
evaluator  an independent AST evaluator replicating platform semantics
geometry   obstacle signed distance + first-contact (trajectory termination)
fit        exact rational (fractions.Fraction) interpolation and refinement
scoring    obstacle-aware candidate screening and scoring
search     the time-budgeted candidate search itself
"""

__all__ = ["astlib", "evaluator", "geometry", "fit", "scoring", "search"]
