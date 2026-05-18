import { state } from './state.js';
import { loadDeForContrast } from './dataLoader.js';
import { renderTable } from './tables.js';
import { renderVolcano, renderMA, numericPValue } from './plots.js';

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
  const showAll = Boolean(document.getElementById('de-show-all-genes')?.checked);
  renderVolcano(rows, padj, lfc);
  renderMA(rows, padj, lfc);
  const degRows = rows.filter((row) => isDeg(row, padj, lfc));
  const tableRows = (showAll ? rows : degRows).map((row) => ({
    significance: deTableCategory(row, padj, lfc),
    ...row,
  }));
  const tableStatus = document.getElementById('de-table-status');
  if (tableStatus) {
    tableStatus.textContent = showAll
      ? `Showing all ${rows.length.toLocaleString()} genes. Use the significance column to filter volcano categories.`
      : `Showing ${degRows.length.toLocaleString()} DEG rows passing padj <= ${padj} and |log2FC| >= ${lfc}. Turn on "Show all genes" for the full DE result.`;
  }
  renderTable('de-table', tableRows, { exportName: `${contrast.id}.${showAll ? 'all' : 'deg'}.csv` });
}

function isDeg(row, padj, lfc) {
  return numericPValue(row.padj) <= padj && Math.abs(Number(row.log2FoldChange)) >= lfc;
}

function deTableCategory(row, padj, lfc) {
  const adjustedP = numericPValue(row.padj);
  const log2fc = Number(row.log2FoldChange);
  if (!Number.isFinite(adjustedP) || adjustedP > padj || !Number.isFinite(log2fc)) return 'not significant';
  if (log2fc >= lfc) return 'upregulated';
  if (log2fc <= -lfc) return 'downregulated';
  return 'padj only';
}
