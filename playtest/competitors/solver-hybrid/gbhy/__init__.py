"""Hybrid Tactical-First Anytime Optimizer -- implementation modules.

    world   input parsing and the shooter-frame board
    dsl     AST construction, measurement and the legality screen
    geom    trajectory scanning (obstacles, arena boundary, hits)
    fit     exact rational interpolation through chosen targets
    cand    candidate families per stage
    search  the anytime staged orchestrator
"""

__all__ = ["world", "dsl", "geom", "fit", "cand", "search"]
