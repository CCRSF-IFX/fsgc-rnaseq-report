import { state, getSampleById } from './state.js';
import { qcRowsWithStatus } from './qc.js';

function plotLayout(title) {
  return { title, margin: { l: 60, r: 30, b: 60, t: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white' };
}

const PCA_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];
const PCA_SYMBOLS = ['circle', 'square', 'diamond', 'cross', 'x', 'triangle-up', 'triangle-down', 'star'];
const PCA_SYMBOLS_3D = ['circle', 'square', 'diamond', 'cross', 'x', 'circle-open', 'square-open', 'diamond-open'];
const VOLCANO_DISPLAY_CAP = 50;
const DE_CATEGORIES = [
  { id: 'upregulated', label: 'upregulated', color: '#dc2626', opacity: 0.82 },
  { id: 'downregulated', label: 'downregulated', color: '#2563eb', opacity: 0.82 },
  { id: 'padj_only', label: 'padj only', color: '#7c3aed', opacity: 0.72 },
  { id: 'not_significant', label: 'not significant', color: '#94a3b8', opacity: 0.34 },
];

export function renderPCA(colorBy = 'condition', pair = 'PC1,PC2', shapeBy = 'none', projection = '2d') {
  const points = state.pca.samples || [];
  const pcKeys = pcaComponentKeys(points);
  const is3d = projection === '3d' && pcKeys.length >= 3;
  const [pairX, pairY] = pair.split(',');
  const xKey = is3d ? pcKeys[0] : (pcKeys.includes(pairX) ? pairX : pcKeys[0] || 'PC1');
  const yKey = is3d ? pcKeys[1] : (pcKeys.includes(pairY) ? pairY : pcKeys[1] || 'PC2');
  const zKey = is3d ? pcKeys[2] : null;
  const colorColumn = colorBy || '';
  const colorLevels = uniqueValues(points.map((point) => pcaGroupValue(point.sample_id, colorColumn)));
  const hasShape = shapeBy && shapeBy !== 'none';
  const shapeLevels = hasShape ? uniqueValues(points.map((point) => sampleMetadata(point.sample_id, shapeBy))) : [''];
  const colorMap = new Map(colorLevels.map((level, index) => [level, PCA_COLORS[index % PCA_COLORS.length]]));
  const symbols = is3d ? PCA_SYMBOLS_3D : PCA_SYMBOLS;
  const symbolMap = new Map(shapeLevels.map((level, index) => [level, symbols[index % symbols.length]]));
  const traces = colorLevels.map((colorLevel, index) => {
    const subset = points.filter((point) => pcaGroupValue(point.sample_id, colorColumn) === colorLevel);
    const trace = {
      x: subset.map((p) => p[xKey]),
      y: subset.map((p) => p[yKey]),
      text: subset.map((p) => pcaHoverText(p, colorColumn, shapeBy)),
      name: colorLevel,
      mode: 'markers',
      type: is3d ? 'scatter3d' : 'scatter',
      legendgroup: 'pca-color',
      legendgrouptitle: index === 0 ? { text: colorColumn || 'Samples' } : undefined,
      marker: {
        size: is3d ? 6 : 13,
        opacity: 0.85,
        color: colorMap.get(colorLevel),
        symbol: hasShape ? subset.map((p) => symbolMap.get(sampleMetadata(p.sample_id, shapeBy))) : 'circle',
        line: { width: 0.5, color: '#ffffff' },
      },
    };
    if (is3d) trace.z = subset.map((p) => p[zKey]);
    return trace;
  });

  if (hasShape) {
    shapeLevels.forEach((shapeLevel, index) => {
      const trace = {
        x: [null],
        y: [null],
        text: [shapeLevel],
        name: shapeLevel,
        mode: 'markers',
        type: is3d ? 'scatter3d' : 'scatter',
        hoverinfo: 'skip',
        legendgroup: 'pca-shape',
        legendgrouptitle: index === 0 ? { text: shapeBy } : undefined,
        marker: {
          size: is3d ? 6 : 13,
          opacity: 0.85,
          color: '#334155',
          symbol: symbolMap.get(shapeLevel),
          line: { width: 0.5, color: '#ffffff' },
        },
      };
      if (is3d) trace.z = [null];
      traces.push(trace);
    });
  }

  const variance = state.pca.variance_explained || {};
  const layout = {
    ...plotLayout(is3d ? 'PCA 3D' : 'PCA'),
    legend: { tracegroupgap: hasShape ? 10 : 0, itemclick: false, itemdoubleclick: false },
  };
  if (is3d) {
    layout.scene = {
      xaxis: { title: `${xKey} (${pct(variance[xKey])})` },
      yaxis: { title: `${yKey} (${pct(variance[yKey])})` },
      zaxis: { title: `${zKey} (${pct(variance[zKey])})` },
    };
  } else {
    layout.xaxis = { title: `${xKey} (${pct(variance[xKey])})` };
    layout.yaxis = { title: `${yKey} (${pct(variance[yKey])})` };
  }
  Plotly.react('pca-plot', traces, layout, { responsive: true });
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
  if (!plots) return;
  const specs = [
    { id: 'reads-plot', key: 'total_reads', title: 'Total reads (PF)', yaxis: { title: 'reads' } },
    { id: 'mapping-plot', key: 'mapping_rate', title: 'Mapped reads (trimmed)', yaxis: { tickformat: '.0%', range: [0, 1] } },
    { id: 'q30-plot', key: 'q30_bases_rate', title: 'PF bases >= Q30', yaxis: { tickformat: '.0%', range: [0, 1] } },
    { id: 'rrna-plot', key: 'rrna_rate', title: 'Ribosomal bases', yaxis: { tickformat: '.1%' } },
    { id: 'duplication-plot', key: 'duplication_rate', title: 'Duplicate mapped reads', yaxis: { tickformat: '.0%', range: [0, 1] } },
  ].filter((spec) => rows.some((row) => Number.isFinite(Number(row[spec.key]))));

  if (specs.length === 0) {
    plots.innerHTML = '<p class="note">No numeric QC metrics available for plotting.</p>';
    return;
  }

  plots.innerHTML = specs.map((spec) => `<div id="${spec.id}" class="plot"></div>`).join('');
  specs.forEach((spec) => {
    Plotly.react(spec.id, [{
      x: rows.map((r) => r.sample_id),
      y: rows.map((r) => Number(r[spec.key])),
      type: 'bar',
    }], { ...plotLayout(spec.title), yaxis: spec.yaxis }, { responsive: true });
  });
}

export function renderVolcano(rows, padj = 0.05, lfc = 1) {
  const yCap = volcanoDisplayCap(rows, padj);
  const points = rows.map((row) => volcanoPoint(row, padj, lfc, yCap)).filter(Boolean);
  const cappedCount = points.filter((point) => point.capped).length;
  const traces = DE_CATEGORIES.flatMap((category) => {
    const categoryPoints = points.filter((point) => point.category === category.id);
    const uncapped = categoryPoints.filter((point) => !point.capped);
    const capped = categoryPoints.filter((point) => point.capped);
    return [
      volcanoTrace(uncapped, category, false, uncapped.length > 0),
      volcanoTrace(capped, category, true, uncapped.length === 0 && capped.length > 0),
    ].filter(Boolean);
  });
  const layout = plotLayout('Volcano plot');
  Plotly.react('volcano-plot', traces, {
    ...layout,
    xaxis: { title: 'log2 fold change' },
    yaxis: { title: '-log10 adjusted p-value', range: [0, yCap * 1.08] },
    legend: { tracegroupgap: 4 },
    shapes: [
      { type: 'line', x0: -lfc, x1: -lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: lfc, x1: lfc, y0: 0, y1: 1, yref: 'paper', line: { color: '#94a3b8', dash: 'dot' } },
      { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -Math.log10(plotPValue(padj)), y1: -Math.log10(plotPValue(padj)), line: { color: '#94a3b8', dash: 'dot' } },
    ],
    annotations: cappedCount ? [{
      xref: 'paper',
      yref: 'paper',
      x: 0.01,
      y: 0.99,
      xanchor: 'left',
      yanchor: 'top',
      align: 'left',
      showarrow: false,
      font: { size: 12, color: '#475569' },
      bgcolor: 'rgba(255,255,255,0.82)',
      bordercolor: '#cbd5e1',
      borderpad: 4,
      text: `${cappedCount} point${cappedCount === 1 ? '' : 's'} capped at -log10(padj)=${formatNumber(yCap)}`,
    }] : [],
  }, { responsive: true });
}

export function renderMA(rows, padj = 0.05, lfc = 1) {
  const points = rows.map((row) => maPoint(row, padj, lfc)).filter(Boolean);
  const traces = DE_CATEGORIES.map((category) => maTrace(points.filter((point) => point.category === category.id), category)).filter(Boolean);
  Plotly.react('ma-plot', traces, {
    ...plotLayout('MA plot'),
    xaxis: { title: 'baseMean', type: 'log' },
    yaxis: { title: 'log2 fold change' },
    legend: { tracegroupgap: 4 },
  }, { responsive: true });
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
  const termLabels = top.map((row) => row.term_name || row.term_id || 'term');
  const wrappedLabels = termLabels.map((label) => wrapPlotLabel(label, 32));
  const termKeys = top.map((row, index) => `${row.term_id || 'term'}_${index}`);
  const layout = plotLayout('Top enriched terms');
  Plotly.react('enrichment-plot', [{
    x: top.map((r) => -Math.log10(plotPValue(r.padj))),
    y: termKeys,
    type: 'bar',
    orientation: 'h',
    customdata: top.map((r, index) => [termLabels[index], r.term_id || '', r.genes || '']),
    hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Genes: %{customdata[2]}<br>-log10 adjusted p-value: %{x:.3g}<extra></extra>',
  }], {
    ...layout,
    margin: { ...layout.margin, l: enrichmentLeftMargin(wrappedLabels), r: 30 },
    xaxis: { title: '-log10 adjusted p-value', automargin: true },
    yaxis: {
      automargin: true,
      tickmode: 'array',
      tickvals: termKeys,
      ticktext: wrappedLabels,
      categoryorder: 'array',
      categoryarray: termKeys,
    },
  }, { responsive: true });
}

function volcanoDisplayCap(rows, padj) {
  const thresholdY = -Math.log10(plotPValue(padj));
  const rawMax = Math.max(...rows.map((row) => -Math.log10(plotPValue(row.padj))).filter(Number.isFinite), 0);
  const minimumCap = Math.max(10, Math.ceil(thresholdY + 1));
  if (rawMax > VOLCANO_DISPLAY_CAP) return Math.max(VOLCANO_DISPLAY_CAP, minimumCap);
  return Math.max(minimumCap, Math.ceil(rawMax + 1));
}

function volcanoPoint(row, padj, lfc, yCap) {
  const log2fc = Number(row.log2FoldChange);
  const rawY = -Math.log10(plotPValue(row.padj));
  if (!Number.isFinite(log2fc) || !Number.isFinite(rawY)) return null;
  const category = deCategory(row, padj, lfc);
  const capped = rawY > yCap;
  return { row, category, log2fc, rawY, y: capped ? yCap : rawY, capped };
}

function volcanoTrace(points, category, capped, showLegend) {
  if (!points.length) return null;
  return {
    x: points.map((point) => point.log2fc),
    y: points.map((point) => point.y),
    text: points.map((point) => deHoverText(point.row, category.label, point.capped, point.rawY)),
    name: category.label,
    mode: 'markers',
    type: 'scattergl',
    legendgroup: category.id,
    showlegend: showLegend,
    marker: {
      color: category.color,
      opacity: category.opacity,
      size: capped ? 9 : 6,
      symbol: capped ? 'triangle-up' : 'circle',
      line: { width: capped ? 0.8 : 0, color: '#0f172a' },
    },
    hovertemplate: '%{text}<extra></extra>',
  };
}

function maPoint(row, padj, lfc) {
  const baseMean = Number(row.baseMean);
  const log2fc = Number(row.log2FoldChange);
  if (!Number.isFinite(baseMean) || baseMean <= 0 || !Number.isFinite(log2fc)) return null;
  return { row, category: deCategory(row, padj, lfc), baseMean, log2fc };
}

function maTrace(points, category) {
  if (!points.length) return null;
  return {
    x: points.map((point) => point.baseMean),
    y: points.map((point) => point.log2fc),
    text: points.map((point) => deHoverText(point.row, category.label)),
    name: category.label,
    mode: 'markers',
    type: 'scattergl',
    legendgroup: category.id,
    marker: {
      color: category.color,
      opacity: category.opacity,
      size: category.id === 'not_significant' ? 5 : 7,
    },
    hovertemplate: '%{text}<extra></extra>',
  };
}

function deCategory(row, padj, lfc) {
  const adjustedP = Number(row.padj);
  const log2fc = Number(row.log2FoldChange);
  const passesP = Number.isFinite(adjustedP) && adjustedP <= padj;
  if (!passesP || !Number.isFinite(log2fc)) return 'not_significant';
  if (log2fc >= lfc) return 'upregulated';
  if (log2fc <= -lfc) return 'downregulated';
  return 'padj_only';
}

function deHoverText(row, category, capped = false, rawY = null) {
  const label = row.gene_symbol || row.gene_id || 'gene';
  const fields = [
    `<b>${escapePlotText(label)}</b>`,
    `class: ${escapePlotText(category)}`,
    `gene_id: ${escapePlotText(row.gene_id || 'NA')}`,
    `baseMean: ${formatNumber(row.baseMean)}`,
    `log2FC: ${formatNumber(row.log2FoldChange)}`,
    `pvalue: ${formatPValue(row.pvalue)}`,
    `padj: ${formatPValue(row.padj)}`,
  ];
  if (capped && rawY !== null) fields.push(`shown capped; true -log10(padj): ${formatNumber(rawY)}`);
  return fields.join('<br>');
}

function pct(value) {
  return value === undefined ? '' : `${(value * 100).toFixed(1)}%`;
}

function sampleMetadata(sampleId, column) {
  return String(getSampleById(sampleId)?.[column] ?? 'NA');
}

function pcaGroupValue(sampleId, column) {
  return column ? sampleMetadata(sampleId, column) : 'All samples';
}

function pcaHoverText(point, colorBy, shapeBy) {
  const sample = getSampleById(point.sample_id) || {};
  const fields = Object.entries(sample)
    .filter(([key]) => key !== 'sample_id')
    .map(([key, value]) => `${key}: ${value}`);
  const emphasized = colorBy ? [`${colorBy}: ${sampleMetadata(point.sample_id, colorBy)}`] : [];
  if (shapeBy && shapeBy !== 'none') emphasized.push(`${shapeBy}: ${sampleMetadata(point.sample_id, shapeBy)}`);
  return [point.sample_id].concat(Array.from(new Set(emphasized.concat(fields)))).join('<br>');
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => String(value ?? 'NA'))));
}

function pcaComponentKeys(points) {
  const keys = new Set();
  points.forEach((point) => {
    Object.keys(point).forEach((key) => {
      if (/^PC\d+$/.test(key) && Number.isFinite(Number(point[key]))) keys.add(key);
    });
  });
  return Array.from(keys)
    .filter((key) => points.every((point) => Number.isFinite(Number(point[key]))))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

function wrapPlotLabel(label, maxLineLength = 32) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    if (!line) {
      line = word;
    } else if ((line.length + word.length + 1) <= maxLineLength) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines.join('<br>') : String(label);
}

function enrichmentLeftMargin(labels) {
  const lineLengths = labels.flatMap((label) => String(label).split('<br>').map((line) => line.length));
  const maxLength = Math.max(12, ...lineLengths);
  return Math.min(320, Math.max(150, maxLength * 7 + 34));
}

function plotPValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(n, 1e-300) : 1;
}

function formatPValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return escapePlotText(value || 'NA');
  if (n === 0) return '0';
  if (Math.abs(n) < 0.001) return n.toExponential(2);
  return n.toPrecision(3);
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return escapePlotText(value || 'NA');
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toExponential(2);
  return n.toFixed(Math.abs(n) >= 10 ? 1 : 3).replace(/\.?0+$/, '');
}

function escapePlotText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
