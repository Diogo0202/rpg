from datetime import datetime, timezone

import pytest

from app.services.second_inquisition import (
    EventKind,
    VerificationBasis,
    VerifiedEvent,
    assess_threat,
)


def event(event_id: str, campaign_id: str) -> VerifiedEvent:
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    return VerifiedEvent(
        event_id=event_id,
        campaign_id=campaign_id,
        event_kind=EventKind.MASQUERADE_BREACH,
        occurred_at=now,
        area_id="centro",
        verification_basis=VerificationBasis.NARRATOR_CONFIRMATION,
        verified_at=now,
    )


def test_assessment_uses_only_the_requested_campaign_and_is_deterministic() -> None:
    assessment = assess_threat("campaign-a", [event("e1", "campaign-a")])
    assert assessment.campaign_id == "campaign-a"
    assert assessment.verified_event_count == 1
    assert assessment.score == 20


def test_assessment_rejects_mixed_campaign_input() -> None:
    with pytest.raises(ValueError, match="outra campanha"):
        assess_threat("campaign-a", [event("e1", "campaign-a"), event("e2", "campaign-b")])


def test_assessment_rejects_duplicate_event_ids() -> None:
    with pytest.raises(ValueError, match="duplicados"):
        assess_threat("campaign-a", [event("e1", "campaign-a"), event("e1", "campaign-a")])
