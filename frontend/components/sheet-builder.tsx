"use client";

import { AiSheetRequest } from "./ai-assistance-panel";
import { OneRingCharacterBuilder } from "./one-ring-character-builder";
import { PortraitPicker } from "./portrait-picker";
import { SheetCreationWizard } from "./sheet-creation-wizard";
import { SheetVersionHistory } from "./sheet-version-history";
import { SheetPreview } from "./sheet-builder/sheet-preview";
import { TemplateEditor } from "./sheet-builder/template-editor";
import { useSheetBuilder, type SheetBuilderState } from "./sheet-builder/use-sheet-builder";

type Props = { campaignId: string; viewerId: string; canManageTemplates: boolean; canEditSheets: boolean };

/** Escolha de modelo e ficha, retrato, gravação e exclusão. */
function SheetPickerCard({ builder, campaignId, viewerId, canManageTemplates, canEditSheets }: Props & { builder: SheetBuilderState }) {
  const { templates, sheets, templateId, sheetId, sheetName, portraitPath, busy, confirmDelete, setConfirmDelete } = builder;
  const canDelete = Boolean(sheetId) && canManageTemplates;
  return <article className="sheet-template-card">
    <p className="eyebrow">FICHAS DA CAMPANHA</p>
    <h2>Modelos e personagens</h2>
    <div className="sheet-field-grid">
      <label>Modelo
        <select value={templateId} onChange={(event) => builder.chooseTemplate(event.target.value)}>
          <option value="">{canManageTemplates ? "Novo modelo" : "Selecione um modelo"}</option>
          {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
        </select>
      </label>
      <label>Ficha existente
        <select value={sheetId} onChange={(event) => builder.chooseSheet(event.target.value)}>
          <option value="">Nova ficha</option>
          {sheets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    {templates.length === 0 && !canManageTemplates ? <p className="sheet-feedback">O mestre ainda não publicou um modelo nesta campanha.</p> : null}
    <label className="sheet-name">Nome do personagem
      <input value={sheetName} maxLength={120} onChange={(event) => builder.changeCharacterName(event.target.value)} placeholder="Nome da ficha" />
    </label>
    {templateId && canEditSheets && <PortraitPicker campaignId={campaignId} uploaderId={viewerId} value={portraitPath} name={sheetName}
      required={!sheetId} disabled={busy} onChange={(path) => { builder.setPortraitPath(path); builder.setFeedback(sheetId ? "Novo retrato enviado. Salve a ficha para aplicá-lo." : ""); }} />}
    <div className="actions">
      <button className="primary" type="button" onClick={() => void builder.saveSheet()} disabled={busy || !templateId || !canEditSheets}>Salvar ficha</button>
      <button className="quiet" type="button" onClick={() => { builder.chooseTemplate(templateId); builder.setMode("guided"); }}>Nova ficha</button>
      {canDelete && !confirmDelete ? <button className="quiet" type="button" onClick={() => setConfirmDelete(true)}>Excluir ficha</button> : null}
    </div>
    {canDelete && confirmDelete ? <div className="sheet-feedback" role="alertdialog" aria-label="Confirmar exclusão da ficha">
      <p>Excluir “{sheetName || "esta ficha"}” apaga a ficha e todo o histórico de versões. Não é possível desfazer.</p>
      <div className="actions">
        <button className="primary" type="button" onClick={builder.deleteSheet} disabled={busy}>Confirmar exclusão</button>
        <button className="quiet" type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
      </div>
    </div> : null}
  </article>;
}

export function SheetBuilder(props: Props) {
  const { campaignId, viewerId, canManageTemplates, canEditSheets } = props;
  const builder = useSheetBuilder(props);
  const { template, templateId, sheetId, busy, mode } = builder;
  const oneRingV3 = template.system_key === "one-ring" && template.rules_profile_version === 3 && Boolean(templateId);
  const ownsSheet = builder.sheets.find((item) => item.id === sheetId)?.owner_id === viewerId;

  function guidedCreation() {
    if (oneRingV3) return <>
      <label>Modelo aprovado<select value={templateId} disabled={busy} onChange={(event) => builder.chooseTemplate(event.target.value)}>{builder.templates.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
      <OneRingCharacterBuilder key={`${campaignId}-${templateId}`} accountId={viewerId} campaignId={campaignId} templateId={templateId} initialValues={builder.values} busy={busy} canSave={canEditSheets} onSave={builder.saveSheet} />
    </>;
    return <SheetCreationWizard
      key={templateId || "no-template"}
      campaignId={campaignId}
      templates={builder.templates} templateId={templateId} template={template} values={builder.values}
      name={builder.sheetName} calculated={builder.calculated} busy={busy} canCreate={canEditSheets} canGrantResources={canManageTemplates}
      loading={builder.loading} loadError={builder.loadError} feedback={builder.feedback} calculationError={templateId ? builder.calculationError : ""}
      onChooseTemplate={builder.chooseTemplate} onNameChange={builder.changeCharacterName} onValueChange={builder.setValue}
      onSave={() => builder.saveSheet()} onOpenEditor={canManageTemplates ? () => builder.setMode("editor") : undefined}
      viewerId={viewerId} portraitPath={builder.portraitPath} onPortraitChange={builder.setPortraitPath}
    />;
  }

  return (
    <section className="content" data-system-theme={template.system_key === "demon-the-fallen" ? "demon-the-fallen" : undefined}>
      <nav className="actions" aria-label="Modo das fichas">
        <button className={mode === "guided" ? "primary" : "quiet"} type="button" disabled={busy} aria-pressed={mode === "guided"} onClick={builder.startCreation}>Criar personagem</button>
        <button className={mode === "editor" ? "primary" : "quiet"} type="button" disabled={busy} aria-pressed={mode === "editor"} onClick={() => builder.setMode("editor")}>Fichas e modelos</button>
      </nav>
      {mode === "guided" && !sheetId ? guidedCreation() : <fieldset disabled={busy} style={{ border: 0, margin: "18px 0 0", padding: 0, minWidth: 0 }}><div className="sheet-layout">
        <div className="sheet-builder-column">
          <SheetPickerCard {...props} builder={builder} />
          {sheetId ? <SheetVersionHistory key={sheetId} sheetId={sheetId} sheetVersion={builder.sheetVersion} template={template} viewerId={viewerId}
            canRestore={canEditSheets} busy={busy} onRestored={builder.applyRestoredSheet} /> : null}
          <article className="sheet-intro">
            <div>
              <p className="eyebrow">OFICINA DE FICHAS / {templateId ? "MODELO SALVO" : "RASCUNHO"}</p>
              <h2>Monte a ficha da sua mesa.</h2>
            </div>
            <p>Os campos ficam em blocos independentes. Fórmulas são recalculadas pela API ao editar a ficha.</p>
          </article>
          {canManageTemplates && !sheetId ? <TemplateEditor builder={builder} /> : null}
        </div>
        <SheetPreview builder={builder} campaignId={campaignId} viewerId={viewerId} />
      </div></fieldset>}
      {sheetId && templateId && canEditSheets && ownsSheet && <AiSheetRequest key={sheetId} campaignId={campaignId} templateId={templateId} targetId={sheetId} />}
    </section>
  );
}
