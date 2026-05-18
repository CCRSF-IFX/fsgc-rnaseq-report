export function sampleIdsInCounts(samples, counts) {
  const firstRow = counts[0] || {};
  return samples.map((sample) => sample.sample_id).filter((id) => Object.prototype.hasOwnProperty.call(firstRow, id));
}

export function inferContrastsFromSamples(samples, config = {}, schema = {}) {
  const analysis = config.analysis || {};
  const columns = analysisMetadataColumns(samples, schema);
  const conditionColumn = analysis.conditionColumn || (columns.includes('condition') ? 'condition' : columns.find((column) => uniqueValues(samples, column).length >= 2));
  if (!conditionColumn) return [];

  const values = uniqueValues(samples, conditionColumn);
  if (values.length < 2) return [];

  const reference = analysis.referenceLevel && values.includes(analysis.referenceLevel)
    ? analysis.referenceLevel
    : (values.includes('control') ? 'control' : values[0]);

  return values
    .filter((value) => value !== reference)
    .map((value) => ({
      id: `${slug(value)}_vs_${slug(reference)}`,
      label: `${value} vs ${reference}`,
      column: conditionColumn,
      numerator: value,
      denominator: reference,
      generated: true,
      method: 'browser_welch',
    }));
}

export function computePcaFromCounts(counts, samples, config = {}) {
  const sampleIds = sampleIdsInCounts(samples, counts);
  if (sampleIds.length < 2) throw new Error('At least two count columns matching sample IDs are required to compute PCA.');

  const { matrix } = normalizedExpression(counts, sampleIds, config);
  const centered = centerFeatures(matrix);
  const covariance = sampleCovariance(centered);
  const eigens = jacobiEigen(covariance)
    .map((eigen, index) => ({ ...eigen, index }))
    .sort((a, b) => b.value - a.value);

  const total = eigens.reduce((sum, eigen) => sum + Math.max(eigen.value, 0), 0) || 1;
  const pcs = eigens.slice(0, Math.min(3, sampleIds.length));
  const variance = Object.fromEntries(pcs.map((eigen, i) => [`PC${i + 1}`, Math.max(eigen.value, 0) / total]));
  const pcaSamples = sampleIds.map((sampleId, sampleIndex) => {
    const row = { sample_id: sampleId };
    pcs.forEach((eigen, pcIndex) => {
      const scale = Math.sqrt(Math.max(eigen.value, 0));
      row[`PC${pcIndex + 1}`] = eigen.vector[sampleIndex] * scale;
    });
    return row;
  });

  return {
    source: 'computed_from_counts',
    transform: 'log2(CPM + 1)',
    variance_explained: variance,
    samples: pcaSamples,
  };
}

export function computeSampleDistanceFromCounts(counts, samples, config = {}) {
  const sampleIds = sampleIdsInCounts(samples, counts);
  if (sampleIds.length < 2) return null;

  const { matrix } = normalizedExpression(counts, sampleIds, config);
  const distances = sampleIds.map((_, i) => sampleIds.map((__, j) => euclidean(matrix[i], matrix[j])));
  return {
    source: 'computed_from_counts',
    metric: 'euclidean',
    transform: 'log2(CPM + 1)',
    sample_ids: sampleIds,
    matrix: distances,
  };
}

export function computeDifferentialExpression(counts, samples, contrast, config = {}) {
  const sampleIds = sampleIdsInCounts(samples, counts);
  const numeratorSamples = sampleIds.filter((id) => sampleValue(samples, id, contrast.column) === contrast.numerator);
  const denominatorSamples = sampleIds.filter((id) => sampleValue(samples, id, contrast.column) === contrast.denominator);
  if (numeratorSamples.length === 0 || denominatorSamples.length === 0) return [];

  const { librarySizes } = normalizedExpression(counts, sampleIds, config);
  const rows = counts.map((gene) => {
    const numeratorCpm = numeratorSamples.map((id) => cpm(gene[id], librarySizes[id]));
    const denominatorCpm = denominatorSamples.map((id) => cpm(gene[id], librarySizes[id]));
    const numeratorLog = numeratorCpm.map((value) => Math.log2(value + 1));
    const denominatorLog = denominatorCpm.map((value) => Math.log2(value + 1));
    const meanNumerator = mean(numeratorCpm);
    const meanDenominator = mean(denominatorCpm);
    const test = welchTTest(numeratorLog, denominatorLog);

    return {
      gene_id: gene.gene_id || '',
      gene_symbol: gene.gene_symbol || gene.gene_name || '',
      baseMean: mean(numeratorCpm.concat(denominatorCpm)),
      log2FoldChange: Math.log2((meanNumerator + 1) / (meanDenominator + 1)),
      lfcSE: test.se,
      statistic: test.t,
      pvalue: test.pvalue,
      padj: 1,
      mean_numerator: meanNumerator,
      mean_denominator: meanDenominator,
      method: 'browser Welch t-test on log2(CPM + 1)',
    };
  });

  const adjusted = benjaminiHochberg(rows.map((row) => row.pvalue));
  rows.forEach((row, i) => { row.padj = adjusted[i]; });
  return rows.sort((a, b) => Number(a.padj) - Number(b.padj));
}

function normalizedExpression(counts, sampleIds, config = {}) {
  const minTotal = Number(config.analysis?.minLibrarySize || 1);
  const librarySizes = Object.fromEntries(sampleIds.map((id) => [
    id,
    Math.max(minTotal, counts.reduce((sum, row) => sum + nonnegativeNumber(row[id]), 0)),
  ]));
  const featureRows = counts
    .filter((row) => sampleIds.some((id) => nonnegativeNumber(row[id]) > 0))
    .map((row) => sampleIds.map((id) => Math.log2(cpm(row[id], librarySizes[id]) + 1)));

  const matrix = sampleIds.map((_, sampleIndex) => featureRows.map((row) => row[sampleIndex]));
  return { matrix, librarySizes, sampleIds };
}

function centerFeatures(matrix) {
  if (matrix.length === 0) return [];
  const featureCount = matrix[0].length;
  const means = Array.from({ length: featureCount }, (_, featureIndex) => mean(matrix.map((row) => row[featureIndex])));
  return matrix.map((row) => row.map((value, featureIndex) => value - means[featureIndex]));
}

function sampleCovariance(matrix) {
  const sampleCount = matrix.length;
  const featureCount = matrix[0]?.length || 0;
  const denom = Math.max(1, featureCount - 1);
  return Array.from({ length: sampleCount }, (_, i) => (
    Array.from({ length: sampleCount }, (_, j) => {
      let sum = 0;
      for (let k = 0; k < featureCount; k += 1) sum += matrix[i][k] * matrix[j][k];
      return sum / denom;
    })
  ));
}

function jacobiEigen(input) {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v = identity(n);
  const maxIterations = Math.max(50, n * n * 20);
  const epsilon = 1e-12;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const value = Math.abs(a[i][j]);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < epsilon) break;

    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];

    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < n; r += 1) {
      if (r !== p && r !== q) {
        const arp = a[r][p];
        const arq = a[r][q];
        a[r][p] = c * arp - s * arq;
        a[p][r] = a[r][p];
        a[r][q] = s * arp + c * arq;
        a[q][r] = a[r][q];
      }
      const vrp = v[r][p];
      const vrq = v[r][q];
      v[r][p] = c * vrp - s * vrq;
      v[r][q] = s * vrp + c * vrq;
    }
  }

  return a.map((row, i) => ({
    value: row[i],
    vector: v.map((vectorRow) => vectorRow[i]),
  }));
}

function identity(n) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
}

function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) return { t: 0, se: 0, pvalue: 1 };
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = variance(a, meanA);
  const varB = variance(b, meanB);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  if (!Number.isFinite(se) || se === 0) return { t: 0, se: 0, pvalue: meanA === meanB ? 1 : 0 };
  const t = (meanA - meanB) / se;
  const dfNumerator = (varA / a.length + varB / b.length) ** 2;
  const dfDenominator = ((varA / a.length) ** 2) / (a.length - 1) + ((varB / b.length) ** 2) / (b.length - 1);
  const df = dfDenominator > 0 ? dfNumerator / dfDenominator : a.length + b.length - 2;
  const pvalue = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { t, se, pvalue: clamp(pvalue, 0, 1) };
}

function studentTCdf(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 0.5;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - ib / 2 : ib / 2;
}

function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(x, a, b)) / a;
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x, a, b) {
  const maxIterations = 100;
  const epsilon = 3e-7;
  const fpmin = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;

    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
  }
  return h;
}

function logGamma(z) {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.9999999999998099;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) x += coefficients[i] / (shifted + i + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function benjaminiHochberg(pvalues) {
  const sorted = pvalues
    .map((pvalue, index) => ({ pvalue: Number.isFinite(pvalue) ? pvalue : 1, index }))
    .sort((a, b) => b.pvalue - a.pvalue);
  const adjusted = Array(pvalues.length).fill(1);
  let previous = 1;
  sorted.forEach((entry, reverseRank) => {
    const rank = pvalues.length - reverseRank;
    previous = Math.min(previous, (entry.pvalue * pvalues.length) / rank);
    adjusted[entry.index] = clamp(previous, 0, 1);
  });
  return adjusted;
}

function analysisMetadataColumns(samples, schema = {}) {
  const keys = new Set();
  samples.forEach((sample) => Object.keys(sample).forEach((key) => {
    if (key !== 'sample_id') keys.add(key);
  }));
  return Array.from(keys)
    .filter((key) => {
      const type = schema?.[key]?.type;
      return !type || ['categorical', 'ordered'].includes(type);
    })
    .sort();
}

function uniqueValues(samples, column) {
  return Array.from(new Set(samples.map((sample) => sample[column]).filter((value) => value !== undefined && value !== null && value !== '')));
}

function sampleValue(samples, sampleId, column) {
  return samples.find((sample) => sample.sample_id === sampleId)?.[column];
}

function cpm(value, librarySize) {
  return (nonnegativeNumber(value) / Math.max(1, librarySize)) * 1e6;
}

function nonnegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values, valuesMean = mean(values)) {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) / (values.length - 1);
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'group';
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, value));
}
