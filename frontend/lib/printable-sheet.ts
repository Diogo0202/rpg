import type { SheetBackup } from "./sheet-backup";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function printableSheetHtml(backup: SheetBackup): string {
  const rows = backup.template.fields.map((field) => {
    const value = backup.values[field.id];
    const shown = Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);
    return `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(shown)}</td></tr>`;
  }).join("");
  const effects = backup.effects.map((effect) => `<li>${escapeHtml(effect.label)} (${effect.delta >= 0 ? "+" : ""}${effect.delta})${effect.enabled ? "" : " [inativo]"}</li>`).join("");
  const inventory = (backup.inventory ?? []).map((item) => `<tr><th>${escapeHtml(item.name)}</th><td>${escapeHtml(item.category)} · quantidade ${item.quantity} · custo ${item.resource_cost} · dano +${item.damage_bonus} · proteção ${item.protection}<br>${escapeHtml(item.notes)}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'"><title>${escapeHtml(backup.name)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#181818}h1{margin-bottom:.2rem}p{color:#444}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:.55rem}th{width:30%}@media print{body{margin:0 auto}}</style><h1>${escapeHtml(backup.name)}</h1><p>${escapeHtml(backup.template.name)} · versão ${backup.template.version}</p><table>${rows}</table><h2>Equipamento</h2><table>${inventory || "<tr><td>Nenhum item</td></tr>"}</table><h2>Efeitos</h2><ul>${effects || "<li>Nenhum efeito</li>"}</ul></html>`;
}
