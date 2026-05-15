import { state } from './state.js';
import { loadDeForContrast } from './dataLoader.js';
import { renderTable } from './tables.js';
import { renderVolcano, renderMA } from './plots.js';

export function populateContrastSelectors() {
  for (const id of ['contrast-select', 'enrichment-contrast-select']) {
    const select = document.getElementById(id);
    if (!select) continue;
    select.innerHTML = state.contrasts.map((c) => `<option value="${c.id}">${c.label || c.id}</option>`).join('');
  }
}

export async function renderCurrentContrast() {
  const select = document.getElementById('contrast-select');
  const contrast = state.contrasts.find((c) => c.id === select?.value) || state.contrasts[0];
  if (!contrast) return;
  const rows = await loadDeForContrast(contrast);
  const padj = Number(document.getElementById('padj-threshold')?.value || 0.05);
  const lfc = Number(document.getElementById('lfc-threshold')?.value || 1);
  renderVolcano(rows, padj, lfc);
  renderMA(rows, padj, lfc);
  const filtered = rows.filter((r) => Number(r.padj) <= padj && Math.abs(Number(r.log2FoldChange)) >= lfc);
  renderTable('de-table', filtered, { limit: 200, exportName: `${contrast.id}.filtered.csv` });
}
