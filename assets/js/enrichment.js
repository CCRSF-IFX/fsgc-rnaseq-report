import { state } from './state.js';
import { loadEnrichmentForContrast } from './dataLoader.js';
import { renderEnrichment } from './plots.js';
import { renderTable } from './tables.js';

export async function renderCurrentEnrichment() {
  const select = document.getElementById('enrichment-contrast-select');
  const contrast = state.contrasts.find((c) => c.id === select?.value) || state.contrasts[0];
  if (!contrast) return;
  const rows = await loadEnrichmentForContrast(contrast);
  renderEnrichment(rows);
  renderTable('enrichment-table', rows, { limit: 100, exportName: `${contrast.id}.enrichment.csv` });
}
