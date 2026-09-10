"""Repository layer — thin, typed access over the :class:`Database` adapter.

SQL lives here; orchestration lives in services; pure rules live in domain.
All queries are parameterized ($1, $2, ...) — no string interpolation.
"""
