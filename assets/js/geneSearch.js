import { state } from './state.js';
import { renderTable } from './tables.js';

export function searchGenes(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const annotationHits = state.geneAnnotation.filter((g) => Object.values(g).some((v) => String(v).toLowerCase().includes(q)));
  const countHits = state.counts.filter((g) => String(g.gene_id).toLowerCase().includes(q) || String(g.gene_symbol).toLowerCase().includes(q));
  const merged = new Map();
  annotationHits.forEach((g) => merged.set(g.gene_id, { ...g, source: 'annotation' }));
  countHits.forEach((g) => merged.set(g.gene_id, { ...(merged.get(g.gene_id) || {}), gene_id: g.gene_id, gene_symbol: g.gene_symbol, source: 'counts' }));
  return Array.from(merged.values());
}

export function renderGeneSearch() {
  const query = document.getElementById('gene-search-input')?.value || '';
  const hits = searchGenes(query);
  renderTable('gene-search-results', hits, { limit: 100, exportName: 'gene-search.csv' });
}
