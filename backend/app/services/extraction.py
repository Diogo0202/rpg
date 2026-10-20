from __future__ import annotations

from app.models import ExtractionRequest, FieldKind, TemplateDraft, TemplateField
from app.services.prompt_security import normalize_untrusted_text


def create_review_draft(request: ExtractionRequest) -> dict[str, object]:
    """Cria apenas um rascunho auditável; o worker real nunca aprova regras sozinho."""
    # This worker accepts metadata only. It has no source text or model context.
    # Keep the legacy opaque source identifier contract, but bound and validate it.
    source_id = normalize_untrusted_text(
        request.source_id, field="source_id", max_chars=128, max_bytes=512
    ).strip()
    if not source_id:
        raise ValueError("source_id não pode ficar vazio")
    system_name = normalize_untrusted_text(
        request.suggested_system_name, field="suggested_system_name", max_chars=120, max_bytes=480
    ).strip()
    if len(system_name) < 3:
        raise ValueError("suggested_system_name precisa ter ao menos três caracteres")
    if len(request.page_references) > 30 or any(
        isinstance(page, bool) or not isinstance(page, int) or page < 1 or page > 100_000
        for page in request.page_references
    ):
        raise ValueError("page_references contém página inválida")
    draft = TemplateDraft(
        name=system_name,
        fields=[
            TemplateField(id="nome", label="Nome", kind=FieldKind.text, required=True),
            TemplateField(id="vida", label="Vida", kind=FieldKind.number),
            TemplateField(id="atributo", label="Atributo", kind=FieldKind.number),
            TemplateField(id="rolagem_base", label="Rolagem base", kind=FieldKind.roll, expression="1d20+atributo"),
        ],
    )
    return {
        "status": "needs_review",
        "source_id": source_id,
        "page_references": request.page_references,
        "template": draft.model_dump(mode="json"),
        "warnings": ["Rascunho gerado: o mestre precisa conferir campos, fórmulas e páginas de origem."],
    }
