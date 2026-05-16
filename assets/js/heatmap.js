import { state, getSampleById, metadataColumns } from './state.js';
import { sampleIdsInCounts } from './analysis.js';

const HEATMAP_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#475569'];

export function setupExpressionHeatmapControls() {
  const annotationSelect = document.getElementById('heatmap-annotation-column');
  if (annotationSelect) {
    const columns = metadataColumns();
    annotationSelect.innerHTML = ['none'].concat(columns)
      .map((column) => `<option value="${heatmapEscapeHtml(column)}">${heatmapEscapeHtml(column === 'none' ? 'None' : column)}</option>`)
      .join('');
    if (columns.includes('condition')) annotationSelect.value = 'condition';
  }

  document.getElementById('heatmap-render')?.addEventListener('click', renderExpressionHeatmap);
  document.getElementById('heatmap-annotation-column')?.addEventListener('change', renderExpressionHeatmap);
  document.getElementById('heatmap-scale')?.addEventListener('change', renderExpressionHeatmap);
  document.getElementById('heatmap-cluster-rows')?.addEventListener('change', renderExpressionHeatmap);
  document.getElementById('heatmap-cluster-columns')?.addEventListener('change', renderExpressionHeatmap);
  renderExpressionHeatmap();
}

export function renderExpressionHeatmap() {
  const container = document.getElementById('expression-heatmap');
  if (!container || !globalThis.Plotly) return;

  const sampleIds = sampleIdsInCounts(state.samples, state.counts);
  if (sampleIds.length < 2) {
    container.innerHTML = '<p class="note">At least two count columns matching sample IDs are required.</p>';
    return;
  }

  const topN = heatmapClampedInteger(document.getElementById('heatmap-top-n')?.value, 5, 500, 50);
  const scale = document.getElementById('heatmap-scale')?.value || 'row';
  const clusterRows = Boolean(document.getElementById('heatmap-cluster-rows')?.checked);
  const clusterColumns = Boolean(document.getElementById('heatmap-cluster-columns')?.checked);
  const annotationColumn = document.getElementById('heatmap-annotation-column')?.value || 'none';

  const rows = heatmapExpressionRows(sampleIds)
    .filter((row) => row.values.some((value) => value > 0))
    .sort((a, b) => b.variance - a.variance)
    .slice(0, topN);

  if (rows.length === 0) {
    container.innerHTML = '<p class="note">No nonzero count rows were available for the heatmap.</p>';
    return;
  }

  const matrix = rows.map((row) => (scale === 'row' ? heatmapRowZScore(row.values) : row.values));
  const rowOrder = clusterRows && rows.length <= 250 ? heatmapClusterOrder(matrix) : matrix.map((_, index) => index);
  const columnVectors = sampleIds.map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
  const columnOrder = clusterColumns ? heatmapClusterOrder(columnVectors) : sampleIds.map((_, index) => index);

  const orderedX = columnOrder.map((index) => sampleIds[index]);
  const orderedY = rowOrder.map((index) => rows[index].label);
  const orderedZ = rowOrder.map((rowIndex) => columnOrder.map((columnIndex) => matrix[rowIndex][columnIndex]));
  const orderedText = rowOrder.map((rowIndex, rowPosition) => (
    columnOrder.map((columnIndex, columnPosition) => {
      const row = rows[rowIndex];
      const sampleId = sampleIds[columnIndex];
      const annotationText = annotationColumn === 'none' ? [] : [`${annotationColumn}: ${getSampleById(sampleId)?.[annotationColumn] ?? 'NA'}`];
      return [
        row.label,
        sampleId,
        `${scale === 'row' ? 'z' : 'logCPM'}=${heatmapFormatNumber(orderedZ[rowPosition]?.[columnPosition])}`,
      ].concat(annotationText).join('<br>');
    })
  ));

  renderHeatmapAnnotation(orderedX, annotationColumn);

  Plotly.react('expression-heatmap', [{
    x: orderedX,
    y: orderedY,
    z: orderedZ,
    text: orderedText,
    hoverinfo: 'text',
    type: 'heatmap',
    colorscale: scale === 'row' ? 'RdBu' : 'Viridis',
    reversescale: scale === 'row',
    zmid: scale === 'row' ? 0 : undefined,
  }], {
    title: `${rows.length} most variable genes`,
    margin: { l: 120, r: 30, b: 90, t: 55 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: annotationColumn === 'none' ? 'samples' : `samples colored by ${annotationColumn}`, automargin: true },
    yaxis: { automargin: true },
  }, { responsive: true });
}

function heatmapExpressionRows(sampleIds) {
  const librarySizes = Object.fromEntries(sampleIds.map((id) => [
    id,
    Math.max(1, state.counts.reduce((sum, row) => sum + heatmapNonnegativeNumber(row[id]), 0)),
  ]));

  return state.counts.map((row) => {
    const values = sampleIds.map((id) => Math.log2((heatmapNonnegativeNumber(row[id]) / librarySizes[id]) * 1e6 + 1));
    return {
      id: row.gene_id || row.gene_symbol || row.gene_name || '',
      label: row.gene_symbol || row.gene_name || row.gene_id || 'gene',
      values,
      variance: heatmapVariance(values),
    };
  });
}

function renderHeatmapAnnotation(sampleIds, annotationColumn) {
  const container = document.getElementById('heatmap-annotation-strip');
  if (!container) return;
  if (annotationColumn === 'none') {
    container.innerHTML = '';
    return;
  }

  const values = sampleIds.map((sampleId) => String(getSampleById(sampleId)?.[annotationColumn] ?? 'NA'));
  const levels = Array.from(new Set(values));
  const colors = Object.fromEntries(levels.map((level, index) => [level, HEATMAP_PALETTE[index % HEATMAP_PALETTE.length]]));
  const samples = sampleIds.map((sampleId, index) => `
    <span class="annotation-sample" title="${heatmapEscapeHtml(sampleId)}: ${heatmapEscapeHtml(values[index])}">
      <span style="background:${colors[values[index]]}"></span>${heatmapEscapeHtml(sampleId)}
    </span>`).join('');
  const legend = levels.map((level) => `
    <span class="annotation-legend-item"><span style="background:${colors[level]}"></span>${heatmapEscapeHtml(level)}</span>`).join('');
  container.innerHTML = `
    <div class="annotation-strip">
      <div class="annotation-label">${heatmapEscapeHtml(annotationColumn)}</div>
      <div class="annotation-samples">${samples}</div>
      <div class="annotation-legend">${legend}</div>
    </div>`;
}

function heatmapClusterOrder(vectors) {
  if (vectors.length <= 2) return vectors.map((_, index) => index);

  const clusters = vectors.map((vector, index) => ({ indices: [index], center: vector.slice(), size: 1 }));
  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const distance = heatmapEuclidean(clusters[i].center, clusters[j].center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const left = clusters[bestI];
    const right = clusters[bestJ];
    const merged = {
      indices: heatmapMergeOrder(left.indices, right.indices, vectors),
      center: left.center.map((value, index) => ((value * left.size) + (right.center[index] * right.size)) / (left.size + right.size)),
      size: left.size + right.size,
    };
    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1, merged);
  }
  return clusters[0].indices;
}

function heatmapMergeOrder(left, right, vectors) {
  const leftEdge = vectors[left[left.length - 1]];
  const rightEdge = vectors[right[0]];
  const flippedRightEdge = vectors[right[right.length - 1]];
  return heatmapEuclidean(leftEdge, rightEdge) <= heatmapEuclidean(leftEdge, flippedRightEdge)
    ? left.concat(right)
    : left.concat(right.slice().reverse());
}

function heatmapRowZScore(values) {
  const avg = heatmapMean(values);
  const sd = Math.sqrt(heatmapVariance(values)) || 1;
  return values.map((value) => (value - avg) / sd);
}

function heatmapVariance(values) {
  if (values.length < 2) return 0;
  const avg = heatmapMean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function heatmapMean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function heatmapEuclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function heatmapNonnegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function heatmapClampedInteger(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function heatmapFormatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toPrecision(4) : 'NA';
}

function heatmapEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
