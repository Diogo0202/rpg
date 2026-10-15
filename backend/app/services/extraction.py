from __future__ import annotations

from app.models import ExtractionRequest, FieldKind, TemplateDraft, TemplateField


def create_review_draft(request: ExtractionRequest) -> dict[str, object]:
    """Cria apenas um rascunho auditável; o worker real nunca aprova regras sozinho."""
    draft = TemplateDraft(
        name=request.suggested_system_name,
        fields=[
            TemplateField(id="nome", label="Nome", kind=FieldKind.text, required=True),
            TemplateField(id="vida", label="Vida", kind=FieldKind.number),
            TemplateField(id="atributo", label="Atributo", kind=FieldKind.number),
            TemplateField(id="rolagem_base", label="Rolagem base", kind=FieldKind.roll, expression="1d20+atributo"),
        ],
    )
    return {
        "status": "needs_review",
        "source_id": request.source_id,
        "page_references": request.page_references,
        "template": draft.model_dump(mode="json"),
        "warnings": ["Rascunho gerado: o mestre precisa conferir campos, fórmulas e páginas de origem."],
    }
