"""LLM enrichment: the work that genuinely cannot be computed.

The scorer is deterministic SQL and stays that way. This module exists for the
two jobs SQL cannot do, both of which are reading comprehension rather than
arithmetic:

  1. Eligibility prose. Code 25, "Others (see text field)", is attached to
     49,223 of 83,394 records -- the single most common code in the catalogue.
     For those, the applicant-type array says nothing and the real rules sit in
     a paragraph of English. Deciding whether "community-based organisations
     with a demonstrated history of serving rural populations" includes a given
     nonprofit is comprehension, not pattern matching.

  2. Vocabulary. The lexical scorer matches words. A youth charity whose focus
     area is "after school" scores zero against a grant that says "out-of-school
     time programming", because those strings share no stem. That gap is real
     and no amount of SQL closes it.

Three rules govern every call:

  * Never on the request path. Enrichment runs as a queued job. A user pressing
    "scan" waits on a 400 ms SQL query, not on a model.
  * Never trusted with arithmetic. The model returns structured judgements --
    which codes apply, which concepts are equivalent -- and SQL does the
    scoring. A model asked for a score returns a plausible number with no
    derivation behind it.
  * Never repeated for free. Results are keyed by a hash of the exact input
    text and stored. The same eligibility paragraph appears across hundreds of
    opportunities from one agency, and paying to read it each time is waste.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

#: Version the prompt and schema together. A change to either means cached
#: results were produced under different rules and must not be reused; without
#: this a prompt fix silently applies only to records enriched after it.
ENRICHMENT_VERSION = 1

#: Hard cap on prose sent to the model. Eligibility sections are usually a few
#: hundred words; anything far beyond that is a full notice pasted into the
#: wrong field, and paying to read 40 KB of boilerplate buys nothing.
MAX_PROSE_CHARS = 6000


class EligibilityReading(BaseModel):
    """What the model concluded from an eligibility paragraph."""

    applicant_codes: list[str] = Field(
        default_factory=list,
        description="Standard applicant-type codes the prose actually implies.",
    )
    excluded_codes: list[str] = Field(
        default_factory=list,
        description="Codes the prose explicitly rules out.",
    )
    required_attributes: list[str] = Field(
        default_factory=list,
        description="Concrete conditions an applicant must meet, one per item.",
    )
    geographic_restriction: list[str] = Field(
        default_factory=list,
        description="Two-letter state codes, if the prose limits by geography.",
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="0 when the prose is ambiguous, 1 when it is explicit.",
    )
    summary: str = Field(
        max_length=400,
        description="One or two plain sentences a non-expert can act on.",
    )


class ConceptExpansion(BaseModel):
    """Alternative phrasings for an organisation's focus areas."""

    terms: list[str] = Field(
        default_factory=list,
        description="Phrases that funders use for the same work.",
    )


@dataclass(slots=True)
class EnrichmentResult:
    reading: EligibilityReading
    cached: bool
    input_hash: str


def _hash(*parts: str) -> str:
    """Stable cache key over the exact inputs and the prompt version."""
    h = hashlib.sha256()
    h.update(str(ENRICHMENT_VERSION).encode())
    for part in parts:
        h.update(b"\x00")
        h.update(part.encode("utf-8", "replace"))
    return h.hexdigest()


_ELIGIBILITY_PROMPT = """\
You read eligibility sections from United States federal grant notices and \
convert them into structured facts.

You will be given the eligibility text from one notice, and the list of \
standard applicant-type codes.

Rules:
- Report only what the text states. Do not infer from the grant's subject \
matter, the agency, or what would be reasonable.
- If the text is vague, say so through a low confidence score rather than by \
guessing a specific answer.
- An applicant type the text does not mention is neither included nor \
excluded. Leave it out of both lists.
- Geographic restrictions must come from the text. Federal grants are national \
by default.
- The summary is read by someone deciding whether to spend a week writing an \
application. Tell them plainly who can apply.
"""

_EXPANSION_PROMPT = """\
You know the vocabulary of United States grant funding.

Given the focus areas an organisation uses to describe its work, list the \
phrases that funders use for the same work in their notices.

Rules:
- Return phrases that would plausibly appear in a real federal grant notice.
- Stay close in meaning. "After school" and "out-of-school time" are the same \
work; "after school" and "education policy" are not.
- Prefer the funder's register over the applicant's. Organisations say "kids", \
notices say "youth" and "school-age children".
- Return between 5 and 20 phrases. More than that dilutes a search rather than \
widening it.
"""


class GrantEnrichmentAgent:
    """Wraps the model. Constructed lazily; never touched on a read path."""

    #: Matches ``grant_service.MODULE_ID``. Enrichment feeds Grant
    #: Intelligence, so its spend belongs under that module in every rollup.
    MODULE_ID = "grant_intelligence"

    def __init__(self, *, settings: Any, db: Any, metering: Any = None) -> None:
        self._settings = settings
        self._db = db
        self._metering = metering
        self._eligibility_agent = None
        self._expansion_agent = None

    async def _meter(self, operation: str, result: Any, started: float) -> None:
        """Record what a model call consumed.

        ``tenant_id`` is None on purpose. Enrichment reads prose for the shared
        opportunity catalogue: every tenant benefits from the same enriched
        record, and the job has no tenant context to borrow. Billing this to
        whichever tenant triggered the batch would put shared infrastructure
        cost on one customer's usage page.

        Token counts come from the provider's own usage report. Where the
        provider does not supply them they stay None, which the ledger records
        as unknown rather than as zero.
        """
        if self._metering is None:
            return
        prompt = completion = None
        try:
            usage = result.usage()
            # pydantic-ai renamed these between versions; read both rather than
            # pin a version, since guessing wrong here silently zeroes cost.
            prompt = getattr(usage, "input_tokens", None)
            if prompt is None:
                prompt = getattr(usage, "request_tokens", None)
            completion = getattr(usage, "output_tokens", None)
            if completion is None:
                completion = getattr(usage, "response_tokens", None)
        except Exception:
            # An unreadable usage object must not lose the row entirely: the
            # call still happened and still cost money.
            log.warning("enrichment.usage_unreadable op=%s", operation, exc_info=True)

        await self._metering.record(
            tenant_id=None,
            module_id=self.MODULE_ID,
            operation=operation,
            model=self._model_name(),
            prompt_tokens=prompt,
            completion_tokens=completion,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    async def _meter_failure(self, operation: str, started: float, exc: Exception) -> None:
        """A failed call still consumed budget, so it goes to the same ledger.

        Recording failures elsewhere, or not at all, would make every rollup
        report a 100% success rate by construction -- the exact defect found in
        the legacy admin dashboard.
        """
        if self._metering is None:
            return
        await self._metering.record(
            tenant_id=None,
            module_id=self.MODULE_ID,
            operation=operation,
            model=self._model_name(),
            latency_ms=int((time.monotonic() - started) * 1000),
            succeeded=False,
            error=str(exc),
        )

    def _model_name(self) -> str:
        llm = self._settings.llm
        return f"{llm.provider}:{llm.model}"

    def _build_model(self):
        """Construct the model with the key this platform is configured with.

        pydantic-ai falls back to OPENAI_API_KEY in the environment, which this
        deployment does not set -- the key lives in settings as
        ZEUS_OPENAI_API_KEY and can be overridden from the admin dashboard.
        Passing it explicitly means enrichment uses the same credential as
        every other model call, and a dashboard change takes effect without a
        redeploy.
        """
        llm = self._settings.llm
        provider = (llm.provider or "openai").lower()
        # Keys are named per provider, so read the one matching the configured
        # provider rather than a generic field that does not exist.
        key = getattr(llm, f"{provider}_api_key", None)
        secret = key.get_secret_value() if key is not None else None

        if not secret:
            raise RuntimeError(
                f"No API key configured for LLM provider '{provider}'. "
                "Set it in the environment or the admin dashboard."
            )

        if provider == "openai":
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider

            return OpenAIChatModel(llm.model, provider=OpenAIProvider(api_key=secret))

        if provider == "anthropic":
            from pydantic_ai.models.anthropic import AnthropicModel
            from pydantic_ai.providers.anthropic import AnthropicProvider

            return AnthropicModel(llm.model, provider=AnthropicProvider(api_key=secret))

        # Anything else: hand pydantic-ai the "provider:model" string and let
        # it resolve. It will read that provider's own environment variable,
        # which is the documented behaviour for providers we have not wired
        # explicitly.
        return self._model_name()

    def _build(self, output_type: type[BaseModel], prompt: str):
        # Imported here so a deployment that never enriches does not need
        # pydantic-ai installed, and a missing optional dependency cannot break
        # startup for every other route.
        from pydantic_ai import Agent

        return Agent(
            self._build_model(),
            output_type=output_type,
            system_prompt=prompt,
            # One retry. A schema violation is usually a transient formatting
            # slip; repeated failures mean the prompt or model is wrong, and
            # retrying five times just multiplies the bill for the same answer.
            retries=1,
        )

    async def read_eligibility(
        self, *, text: str, codes: list[dict[str, Any]], opportunity_id: str | None = None
    ) -> EnrichmentResult:
        """Turn an eligibility paragraph into structured facts.

        Cached on the exact text, not on the opportunity: one agency reuses the
        same paragraph across hundreds of notices, and the second reading of
        identical text is guaranteed to be redundant.
        """
        text = (text or "").strip()[:MAX_PROSE_CHARS]
        if not text:
            raise ValueError("no eligibility text to read")

        key = _hash(text)
        cached = await self._get_cached(key)
        if cached is not None:
            return EnrichmentResult(
                reading=EligibilityReading(**cached), cached=True, input_hash=key
            )

        if self._eligibility_agent is None:
            self._eligibility_agent = self._build(EligibilityReading, _ELIGIBILITY_PROMPT)

        code_table = "\n".join(
            f"  {c['code']}: {c['description']}" for c in codes
        )
        started = time.monotonic()
        try:
            result = await self._eligibility_agent.run(
                f"Applicant-type codes:\n{code_table}\n\nEligibility text:\n{text}"
            )
        except Exception as exc:
            await self._meter_failure("read_eligibility", started, exc)
            raise
        await self._meter("read_eligibility", result, started)
        reading: EligibilityReading = result.output

        # Guard the model's output against the reference data. A hallucinated
        # code would be written into an array that the scorer treats as fact,
        # and a wrong code there means someone is told they can apply for
        # something they cannot.
        valid = {c["code"] for c in codes}
        dropped = [c for c in reading.applicant_codes if c not in valid]
        if dropped:
            log.warning("enrichment.invalid_codes dropped=%s id=%s", dropped, opportunity_id)
            reading.applicant_codes = [c for c in reading.applicant_codes if c in valid]
        reading.excluded_codes = [c for c in reading.excluded_codes if c in valid]

        await self._store(key, reading, opportunity_id)
        return EnrichmentResult(reading=reading, cached=False, input_hash=key)

    async def expand_concepts(self, focus_areas: list[str]) -> list[str]:
        """Widen focus areas into the vocabulary funders actually use."""
        if not focus_areas:
            return []
        key = _hash("expansion", json.dumps(sorted(focus_areas)))
        cached = await self._get_cached(key)
        if cached is not None:
            return list(cached.get("terms", []))

        if self._expansion_agent is None:
            self._expansion_agent = self._build(ConceptExpansion, _EXPANSION_PROMPT)

        started = time.monotonic()
        try:
            result = await self._expansion_agent.run(
                "Focus areas:\n" + "\n".join(f"- {a}" for a in focus_areas)
            )
        except Exception as exc:
            await self._meter_failure("expand_concepts", started, exc)
            raise
        await self._meter("expand_concepts", result, started)
        terms = [t.strip() for t in result.output.terms if t.strip()][:20]
        await self._store_raw(key, {"terms": terms})
        return terms

    # --- cache ---------------------------------------------------------------

    async def _get_cached(self, key: str) -> dict[str, Any] | None:
        row = await self._db.fetch_one(
            "SELECT payload FROM platform.enrichment_cache "
            "WHERE input_hash = $1 AND version = $2",
            key,
            ENRICHMENT_VERSION,
        )
        if row is None:
            return None
        payload = row["payload"]
        return json.loads(payload) if isinstance(payload, str) else payload

    async def _store(
        self, key: str, reading: EligibilityReading, opportunity_id: str | None
    ) -> None:
        await self._store_raw(key, reading.model_dump(), opportunity_id)

    async def _store_raw(
        self, key: str, payload: dict[str, Any], opportunity_id: str | None = None
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.enrichment_cache
                (input_hash, version, payload, opportunity_id, model)
            VALUES ($1, $2, $3::jsonb, $4::uuid, $5)
            ON CONFLICT (input_hash, version) DO UPDATE SET
                payload = EXCLUDED.payload, created_at = now()
            """,
            key,
            ENRICHMENT_VERSION,
            json.dumps(payload),
            opportunity_id,
            self._model_name(),
        )
