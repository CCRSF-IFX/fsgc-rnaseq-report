import { state, getSampleById } from './state.js';
import { qcRowsWithStatus } from './qc.js';

function plotLayout(title) {
  return { title, margin: { l: 60, r: 30, b: 60, t: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white' };
}

const PCA_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];
const PCA_SYMBOLS = ['circle', 'square', 'diamond', 'cross', 'x', 'triangle-up', 'triangle-down', 'star'];

export function renderPCA(colorBy = 'condition', pair = 'PC1,PC2', shapeBy = 'none') {
  const [xKey, yKey] = pair.split(',');
  const points = state.pca.samples || [];
  const colorLevels = uniqueValues(points.map((point) => sampleMetadata(point.sample_id, colorBy)));
  const hasShape = shapeBy && shapeBy !== 'none';
  const shapeLevels = hasShape ? uniqueValues(points.map((point) => sampleMetadata(point.sample_id, shapeBy))) : [''];
  const colorMap = new Map(colorLevels.map((level, index) => [level, PCA_COLORS[index % PCA_COLORS.length]]));
  const symbolMap = new Map(shapeLevels.map((level, index) => [level, PCA_SYMBOLS[index % PCA_SYMBOLS.length]]));
  const traces = colorLevels.map((colorLevel, index) => {
    const subset = points.filter((point) => sampleMetadata(point.sample_id, colorBy) === colorLevel);
    return {
      x: subset.map((p) => p[xKey]),
      y: subset.map((p) => p[yKey]),
      text: subset.map((p) => pcaHoverText(p, colorBy, shapeBy)),
      name: colorLevel,
      mode: 'markers',
      type: 'scatter',
      legendgroup: 'pca-color',
      legendgrouptitle: index === 0 ? { text: colorBy } : undefined,
      marker: {
        size: 13,
        opacity: 0.85,
        color: colorMap.get(colorLevel),
        symbol: hasShape ? subset.map((p) => symbolMap.get(sampleMetadata(p.sample_id, shapeBy))) : 'circle',
        line: { width: 0.5, color: '#ffffff' },
      },
    };
  });

  if (hasShape) {
    shapeLevels.forEach((shapeLevel, index) => {
      traces.push({
        x: [null],
        y: [null],
        text: [shapeLevel],
        name: shapeLevel,
        mode: 'markers',
        type: 'scatter',
        hoverinfo: 'skip',
        legendgroup: 'pca-shape',
        legendgrouptitle: index === 0 ? { text: shapeBy } : undefined,
        marker: {
          size: 13,
          opacity: 0.85,
          color: '#334155',
          symbol: symbolMap.get(shapeLevel),
          line: { width: 0.5, color: '#ffffff' },
        },
      });
    });
  }

  const variance = state.pca.variance_explained || {};
  Plotly.react('pca-plot', traces, {
    ...plotLayout('PCA'),
    legend: { tracegroupgap: hasShape ? 10 : 0, itemclick: false, itemdoubleclick: false },
    xaxis: { title: `${xKey} (${pct(variance[xKey])})` },
    yaxis: { title: `${yKey} (${pct(variance[yKey])})` },
  }, { responsive: true });
  renderScree();
}

export function renderScree() {
  const variance = state.pca.variance_explained || {};
  const pcs = Object.keys(variance);
  Plotly.react('scree-plot', [{ x: pcs, y: pcs.map((pc) => variance[pc] * 100), type: 'bar' }], { ...plotLayout('Variance explained'), yaxis: { title: '%' } }, { responsive: true });
}

export function renderDistanceHeatmap() {
  if (!state.distance) return;
  Plotly.react('distance-heatmap', [{
    x: state.distance.sample_ids,
    y: state.distance.sample_ids,
    z: state.distance.matrix,
    type: 'heatmap',
    colorscale: 'Viridis',
  }], plotLayout('Sample distance matrix'), { responsive: true });
}

export function renderQCPlots() {
  const rows = qcRowsWithStatus();
  const plots = document.getElementById('qc-plots');
  if (plots) plots.innerHTML = '<div id="reads-plot" class="plot"></div><div id="mapping-plot" class="plot"></div>';
  Plotly.react('reads-plot', [{ x: rows.map((r) => r.sample_id), y: rows.map((r) => r.total_reads), type: 'bar' }], plotLayout('Total reads'), { responsive: true });
  Plotly.react('mapping-plot', [{ x: rows.map((r) => r.sample_id), y: rows.map((r) => r.mapping_rate), type: 'bar' }], { ...plotLayout('Mapping rate'), yaxis: { tickformat: '.0%' } }, { responsive: true });
}

export function renderVolcano(rows, padj = 0.05, lfc = 1) {
  const x = rows.map((r) => Number(r.log2FoldChange));
  const y = rows.map((r) => -Math.log10(plotPValue(r.padj)));
  const significant = rows.map((r) => Number(r.padj) <= padj && Math.abs(Number(r.log2FoldChange)) >= lfc ? 'significant' : 'not significant');
  Plotly.react('volcano-plot', [{
    x, y, text: rows.map((r) => `${r.gene_symbol || r.gene_id}<br>padj=${r.padj}`), mode: 'markers', type: 'scatter', marker: { size: 8, opacity: 0.75 }, transforms: [{ type: 'groupby', groups: significant }]
  }], {
    ...plotLayout('Volcano plot'),
    xaxis: { title: 'log2 fold change' },
    yaxis: { title: '-log10 adjusted p-value' },
    shapes: [
      { type: 'line', x0: -lfc, x1: -lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: lfc, x1: lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -Math.log10(plotPValue(padj)), y1: -Math.log10(plotPValue(padj)), line: { color: '#94a3b8', dash: 'dot' } },
    ],
  }, { responsive: true });
}

export function renderMA(rows, padj = 0.05, lfc = 1) {
  const significant = rows.map((r) => Number(r.padj) <= padj && Math.abs(Number(r.log2FoldChange)) >= lfc ? 'significant' : 'not significant');
  Plotly.react('ma-plot', [{
    x: rows.map((r) => Number(r.baseMean)), y: rows.map((r) => Number(r.log2FoldChange)), mode: 'markers', type: 'scatter', marker: { size: 8, opacity: 0.75 }, text: rows.map((r) => r.gene_symbol || r.gene_id), transforms: [{ type: 'groupby', groups: significant }]
  }], { ...plotLayout('MA plot'), xaxis: { title: 'baseMean', type: 'log' }, yaxis: { title: 'log2 fold change' } }, { responsive: true });
}

export function renderGeneCounts(geneQuery) {
  const row = state.counts.find((r) => String(r.gene_symbol).toLowerCase() === geneQuery.toLowerCase() || String(r.gene_id).toLowerCase() === geneQuery.toLowerCase());
  if (!row) {
    document.getElementById('gene-count-plot').innerHTML = `<p class="note">No counts found for ${geneQuery}.</p>`;
    return;
  }
  const sampleIds = state.samples.map((s) => s.sample_id);
  Plotly.react('gene-count-plot', [{ x: sampleIds, y: sampleIds.map((id) => Number(row[id])), type: 'bar', text: sampleIds.map((id) => getSampleById(id)?.condition || '') }], plotLayout(`${row.gene_symbol || row.gene_id} normalized counts`), { responsive: true });
}

export function renderEnrichment(rows) {
  const top = rows.slice().sort((a, b) => Number(a.padj) - Number(b.padj)).slice(0, 15).reverse();
  Plotly.react('enrichment-plot', [{
    x: top.map((r) => -Math.log10(plotPValue(r.padj))),
    y: top.map((r) => r.term_name),
    type: 'bar',
    orientation: 'h',
    text: top.map((r) => `${r.term_id}<br>${r.genes}`),
  }], { ...plotLayout('Top enriched terms'), xaxis: { title: '-log10 adjusted p-value' } }, { responsive: true });
}

function pct(value) {
  return value === undefined ? '' : `${(value * 100).toFixed(1)}%`;
}

function sampleMetadata(sampleId, column) {
  return String(getSampleById(sampleId)?.[column] ?? 'NA');
}

function pcaHoverText(point, colorBy, shapeBy) {
  const sample = getSampleById(point.sample_id) || {};
  const fields = Object.entries(sample)
    .filter(([key]) => key !== 'sample_id')
    .map(([key, value]) => `${key}: ${value}`);
  const emphasized = [`${colorBy}: ${sampleMetadata(point.sample_id, colorBy)}`];
  if (shapeBy && shapeBy !== 'none') emphasized.push(`${shapeBy}: ${sampleMetadata(point.sample_id, shapeBy)}`);
  return [point.sample_id].concat(Array.from(new Set(emphasized.concat(fields)))).join('<br>');
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => String(value ?? 'NA'))));
}

function plotPValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(n, 1e-300) : 1;
}
