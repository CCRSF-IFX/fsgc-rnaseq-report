import { state, logAnalysis, createProgressReporter, runWithProgressPulse } from './state.js';
import { loadDeForContrast, loadGeneAnnotation, parseCsv, parseEnrichmentCsv } from './dataLoader.js';
import { ensureRPackages } from './packageManager.js';
import { renderCurrentEnrichment, storeGseaResult } from './enrichment.js';
import { evalR } from './webrManager.js';
import { markAnalysisCacheDirty } from './analysisCache.js';

let fgseaControlsWired = false;
const FGSEA_CURVE_DEFAULT_PRESET = 'top20';
const FGSEA_CURVE_MAX_PER_DIRECTION = 500;
const FGSEA_CURVE_PRESETS = {
  top20: { up: 10, down: 10 },
  top40: { up: 20, down: 20 },
};
const FGSEA_CURVE_POINT_LIMIT = 800;
const FGSEA_CURVE_SEPARATOR = '\n__RNASEQ_REPORT_FGSEA_CURVES__\n';
const FGSEA_HIT_SEPARATOR = '\n__RNASEQ_REPORT_FGSEA_HITS__\n';

export function setupFgseaControls() {
  if (fgseaControlsWired) return;
  fgseaControlsWired = true;
  document.getElementById('gsea-run')?.addEventListener('click', runFgseaAnalysis);
  document.getElementById('gsea-curve-limit')?.addEventListener('change', syncFgseaCurveControls);
  syncFgseaCurveControls();
}

export async function runFgseaAnalysis() {
  const contrastSelect = document.getElementById('enrichment-contrast-select');
  const contrast = state.contrasts.find((item) => item.id === contrastSelect?.value) || state.contrasts[0];
  const status = document.getElementById('gsea-status');
  const runButton = document.getElementById('gsea-run');
  const runButtonLabel = runButton?.textContent || 'Run fgsea';
  const progress = createProgressReporter('fgsea', 5);
  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = 'Running fgsea...';
    runButton.setAttribute('aria-busy', 'true');
  }

  try {
    if (!contrast) throw new Error('Run or select a DE contrast before fgsea.');
    fgseaSetStatus(status, 'Loading uploaded GMT pathway files...');
    await progress.step('Loading uploaded GMT pathway files', 1);
    const gmtSources = await loadGmtSources();

    fgseaSetStatus(status, 'Loading ranked DE result...');
    await progress.step('Loading ranked DE result', 2);
    const deRows = await loadDeForContrast(contrast);
    if (!deRows.length) throw new Error('No DE rows are available. Run DESeq2 first for uploaded data.');

    const minSize = fgseaPositiveInteger(document.getElementById('gsea-min-size')?.value, 1, 10);
    const maxSize = fgseaPositiveInteger(document.getElementById('gsea-max-size')?.value, minSize, 500);
    const curveSetting = fgseaCurveSettingValue();

    fgseaSetStatus(status, 'Loading fgsea package in webR. First run can take a few minutes.');
    await progress.step('Loading fgsea package in webR', 3);
    await ensureRPackages(fgseaPackageSet(), { load: ['fgsea'] });

    const runMessage = `Running fgsea in webR for ${deRows.length} ranked genes`;
    fgseaSetStatus(status, `${runMessage}. Keep this tab open.`);
    await progress.step(runMessage, 4);
    const completed = [];
    for (let index = 0; index < gmtSources.length; index += 1) {
      const source = gmtSources[index];
      const sourceMessage = gmtSources.length > 1
        ? `${runMessage} (${index + 1}/${gmtSources.length}: ${source.source_label})`
        : `${runMessage} (${source.source_label})`;
      fgseaSetStatus(status, `${sourceMessage}. Keep this tab open.`);
      const analysis = await runWithProgressPulse(
        progress,
        `${sourceMessage}; still working`,
        () => fgseaRunInWebR(deRows, source.gmtText, source.source_label, minSize, maxSize, curveSetting),
        {
          intervalMs: 10000,
          onPulse: (message) => fgseaSetStatus(status, `${message}. Keep this tab open.`),
        },
      );
      const rows = analysis.rows || [];
      if (!rows.length) throw new Error(`fgsea returned no pathways for ${source.source_label}. Check gene identifiers and pathway gene sets.`);
      const resultId = fgseaResultId(contrast.id, source, minSize, maxSize, curveSetting);
      const result = storeGseaResult({
        result_id: resultId,
        contrast_id: contrast.id,
        label: `${contrast.label || contrast.id} - ${source.source_label}`,
        source_kind: source.source_kind,
        source_id: source.source_id,
        source_label: source.source_label,
        reference: source.source_label,
        min_size: minSize,
        max_size: maxSize,
        curve_limit: curveSetting.id,
        curve_up_limit: curveSetting.up,
        curve_down_limit: curveSetting.down,
        created_at: new Date().toISOString(),
        enrichment_curves: analysis.enrichment_curves || [],
        rows: rows.map((row) => ({
          ...row,
          reference: row.reference || source.source_label,
          pathway_source: source.source_label,
        })),
      });
      completed.push(result);
      markAnalysisCacheDirty(`fgsea ${contrast.label || contrast.id} ${source.source_label}`);
    }

    await progress.step('Rendering enrichment plot and table', 5);
    const lastResult = completed[completed.length - 1];
    await renderCurrentEnrichment({ resultId: lastResult?.result_id });
    const totalPathways = completed.reduce((sum, result) => sum + result.rows.length, 0);
    const sourceLabel = completed.length === 1 ? completed[0].source_label : `${completed.length} GMT files`;
    const totalCurves = completed.reduce((sum, result) => sum + (result.enrichment_curves || []).length, 0);
    const message = `fgsea complete for ${contrast.label || contrast.id}: ${totalPathways} pathway rows and ${totalCurves} pathway plot${totalCurves === 1 ? '' : 's'} across ${sourceLabel}.`;
    fgseaSetStatus(status, message);
    await progress.done(`${totalPathways} pathway rows`);
    logAnalysis(message);
  } catch (error) {
    fgseaSetStatus(status, `fgsea failed: ${error.message}`);
    await progress.fail(`failed: ${error.message}`);
    logAnalysis(`fgsea failed: ${error.message}`);
  } finally {
    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = runButtonLabel;
      runButton.removeAttribute('aria-busy');
    }
  }
}

function fgseaPackageSet() {
  return state.config?.webr?.modules?.fgsea?.packages || ['fgsea'];
}

async function loadGmtSources() {
  const uploaded = Array.from(document.getElementById('gsea-gmt-file')?.files || []);
  if (!uploaded.length) throw new Error('Upload one or more GMT files before running fgsea.');
  return Promise.all(uploaded.map(async (file) => ({
    source_kind: 'uploaded',
    source_id: `${file.name}-${file.size}-${file.lastModified}`,
    source_label: file.name,
    gmtText: await file.text(),
  })));
}

function fgseaResultId(contrastId, source, minSize, maxSize, curveSetting) {
  return [
    contrastId,
    source.source_kind,
    source.source_id || source.source_label,
    `min${minSize}`,
    `max${maxSize}`,
    `plots${fgseaCurveSettingId(curveSetting)}`,
  ].map(fgseaSlug).filter(Boolean).join('__');
}

function fgseaSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gsea';
}

async function fgseaRunInWebR(deRows, gmtText, reference, minSize, maxSize, curveSetting = fgseaDefaultCurveSetting()) {
  await loadGeneAnnotation(false);
  const statsCsv = fgseaStatsCsv(deRows);
  const curveConfig = fgseaNormalizeCurveSetting(curveSetting);
  const code = `
suppressPackageStartupMessages(library(fgsea))
fgsea_param <- BiocParallel::SerialParam(progressbar = FALSE)
BiocParallel::register(fgsea_param, default = TRUE)
stats_text <- ${fgseaRString(statsCsv)}
gmt_text <- ${fgseaRString(gmtText)}
reference_name <- ${fgseaRString(reference)}
min_size <- ${Number(minSize)}
max_size <- ${Number(maxSize)}
curve_up_limit <- ${curveConfig.up}
curve_down_limit <- ${curveConfig.down}
curve_point_limit <- ${FGSEA_CURVE_POINT_LIMIT}

de <- read.csv(text = stats_text, check.names = FALSE, stringsAsFactors = FALSE, na.strings = c("", "NA", "NaN"))
empty_gene <- function(value) {
  value <- trimws(as.character(value))
  is.na(value) | !nzchar(value) | toupper(value) %in% c("NA", "N/A", "NULL", "NONE")
}
gene_id <- if ("gene_id" %in% names(de)) trimws(as.character(de$gene_id)) else rep(NA_character_, nrow(de))
gene_symbol <- if ("gene_symbol" %in% names(de)) trimws(as.character(de$gene_symbol)) else rep(NA_character_, nrow(de))
genes <- gene_symbol
use_id <- empty_gene(genes)
genes[use_id] <- gene_id[use_id]
stat <- suppressWarnings(as.numeric(de$statistic))
if (!any(is.finite(stat)) && "log2FoldChange" %in% names(de)) {
  lfc <- suppressWarnings(as.numeric(de$log2FoldChange))
  pvalue <- suppressWarnings(as.numeric(de$pvalue))
  if (!any(is.finite(pvalue) & pvalue >= 0) && "padj" %in% names(de)) {
    pvalue <- suppressWarnings(as.numeric(de$padj))
  }
  positive_pvalue <- pvalue[is.finite(pvalue) & pvalue > 0]
  pvalue_floor <- if (length(positive_pvalue)) min(positive_pvalue) * 0.1 else .Machine$double.xmin
  pvalue_floor <- max(.Machine$double.xmin, pvalue_floor)
  pvalue[is.finite(pvalue) & pvalue == 0] <- pvalue_floor
  pvalue[!is.finite(pvalue) | pvalue < 0] <- NA_real_
  pvalue[pvalue > 1] <- 1
  stat <- sign(lfc) * -log10(pvalue)
}
keep <- !empty_gene(genes) & is.finite(stat)
genes <- genes[keep]
stat <- stat[keep]
if (length(stat) < 2) stop("Need at least two ranked genes for fgsea.")
ord <- order(abs(stat), decreasing = TRUE)
genes <- genes[ord]
stat <- stat[ord]
dedup <- !duplicated(genes)
stats <- stat[dedup]
names(stats) <- genes[dedup]
stats <- sort(stats, decreasing = TRUE)

parse_gmt <- function(text) {
  lines <- strsplit(text, "\\n", fixed = TRUE)[[1]]
  lines <- lines[nzchar(trimws(lines))]
  pathways <- lapply(lines, function(line) {
    parts <- strsplit(line, "\\t", fixed = TRUE)[[1]]
    genes <- trimws(parts[-c(1, 2)])
    unique(genes[nzchar(genes)])
  })
  names(pathways) <- vapply(lines, function(line) strsplit(line, "\\t", fixed = TRUE)[[1]][1], character(1))
  pathways
}

csv_text <- function(df) paste(capture.output(write.csv(df, row.names = FALSE, na = "")), collapse = "\\n")

empty_curve_df <- function() data.frame(
  term_id = character(),
  rank = integer(),
  runningScore = numeric(),
  totalRanks = integer(),
  enrichmentScore = numeric(),
  NES = numeric(),
  padj = numeric(),
  size = integer(),
  stringsAsFactors = FALSE,
  check.names = FALSE
)

empty_hit_df <- function() data.frame(
  term_id = character(),
  rank = integer(),
  gene = character(),
  stat = numeric(),
  stringsAsFactors = FALSE,
  check.names = FALSE
)

running_curve <- function(pathway_genes, stats, max_points = 800L) {
  hits <- sort(unique(which(names(stats) %in% pathway_genes)))
  n <- length(stats)
  nh <- length(hits)
  if (!nh || nh >= n) return(NULL)

  weights <- abs(stats[hits])
  weight_sum <- sum(weights)
  if (!is.finite(weight_sum) || weight_sum <= 0) {
    weights <- rep(1 / nh, nh)
  } else {
    weights <- weights / weight_sum
  }

  running_steps <- rep(-1 / (n - nh), n)
  running_steps[hits] <- weights
  running <- cumsum(running_steps)
  base_idx <- unique(round(seq(1, n, length.out = min(max_points, n))))
  hit_neighbors <- unique(c(hits, pmax(1L, hits - 1L), pmin(n, hits + 1L)))
  idx <- sort(unique(c(1L, base_idx, hit_neighbors, which.max(abs(running)), n)))

  list(
    points = data.frame(rank = idx, runningScore = running[idx]),
    hits = data.frame(rank = hits, gene = names(stats)[hits], stat = unname(stats[hits])),
    totalRanks = n
  )
}

curve_order <- function(df) {
  if (!nrow(df)) return(df)
  df[order(df$padj, -abs(df$NES), df$pathway), , drop = FALSE]
}

top_curve_rows <- function(fg, up_limit = 10L, down_limit = 10L) {
  if (!nrow(fg)) return(fg)
  up_limit <- suppressWarnings(as.integer(up_limit))
  down_limit <- suppressWarnings(as.integer(down_limit))
  if (!is.finite(up_limit)) up_limit <- 10L
  if (!is.finite(down_limit)) down_limit <- 10L
  up_limit <- max(0L, up_limit)
  down_limit <- max(0L, down_limit)
  nes <- suppressWarnings(as.numeric(fg$NES))
  up <- curve_order(fg[is.finite(nes) & nes > 0, , drop = FALSE])
  down <- curve_order(fg[is.finite(nes) & nes < 0, , drop = FALSE])
  up <- up[seq_len(min(nrow(up), up_limit)), , drop = FALSE]
  down <- down[seq_len(min(nrow(down), down_limit)), , drop = FALSE]
  selected <- rbind(down, up)
  if (nrow(selected)) return(selected)
  fallback_limit <- max(1L, up_limit + down_limit)
  fg[seq_len(min(nrow(fg), fallback_limit)), , drop = FALSE]
}

curve_tables <- function(fg, pathways, stats, up_limit = 10L, down_limit = 10L, max_points = 800L) {
  curve_rows <- list()
  hit_rows <- list()
  if (!nrow(fg)) return(list(curves = empty_curve_df(), hits = empty_hit_df()))

  top_fg <- top_curve_rows(fg, up_limit, down_limit)
  for (i in seq_len(nrow(top_fg))) {
    pathway_name <- top_fg$pathway[[i]]
    curve <- running_curve(pathways[[pathway_name]], stats, max_points)
    if (is.null(curve)) next

    curve_rows[[length(curve_rows) + 1]] <- data.frame(
      term_id = pathway_name,
      rank = curve$points$rank,
      runningScore = curve$points$runningScore,
      totalRanks = curve$totalRanks,
      enrichmentScore = top_fg$ES[[i]],
      NES = top_fg$NES[[i]],
      padj = top_fg$padj[[i]],
      size = top_fg$size[[i]],
      stringsAsFactors = FALSE,
      check.names = FALSE
    )
    hit_rows[[length(hit_rows) + 1]] <- data.frame(
      term_id = pathway_name,
      rank = curve$hits$rank,
      gene = curve$hits$gene,
      stat = curve$hits$stat,
      stringsAsFactors = FALSE,
      check.names = FALSE
    )
  }

  list(
    curves = if (length(curve_rows)) do.call(rbind, curve_rows) else empty_curve_df(),
    hits = if (length(hit_rows)) do.call(rbind, hit_rows) else empty_hit_df()
  )
}

pathways <- parse_gmt(gmt_text)
if (!length(pathways)) stop("No pathways were parsed from the GMT file.")
gmt_genes <- unique(unlist(pathways, use.names = FALSE))
overlap_counts <- vapply(pathways, function(genes) sum(genes %in% names(stats)), integer(1))
if (!any(overlap_counts > 0)) {
  ranked_examples <- paste(head(names(stats), 6), collapse = ", ")
  gmt_examples <- paste(head(gmt_genes, 6), collapse = ", ")
  stop(paste(
    "No GMT genes overlapped the ranked DE genes.",
    "Ranked gene examples:", ranked_examples,
    "GMT gene examples:", gmt_examples,
    "Upload a GMT whose gene identifiers match the DE table gene_symbol or gene_id values."
  ))
}
eligible_counts <- overlap_counts[overlap_counts >= min_size & overlap_counts <= max_size]
if (!length(eligible_counts)) {
  stop(sprintf(
    "GMT genes overlapped the ranked DE genes, but no pathway met minSize=%d and maxSize=%d after overlap. Overlap range was %d-%d genes.",
    min_size, max_size, min(overlap_counts), max(overlap_counts)
  ))
}
fgsea_args <- list(pathways = pathways, stats = stats, minSize = min_size, maxSize = max_size)
if ("BPPARAM" %in% names(formals(fgseaMultilevel))) fgsea_args$BPPARAM <- fgsea_param
if ("nproc" %in% names(formals(fgseaMultilevel))) fgsea_args$nproc <- 0L
fg <- do.call(fgseaMultilevel, fgsea_args)
if (nrow(fg) == 0) {
  out <- data.frame()
  curve_out <- empty_curve_df()
  hit_out <- empty_hit_df()
} else {
  fg <- fg[order(fg$padj, -abs(fg$NES)), ]
  curves <- curve_tables(fg, pathways, stats, curve_up_limit, curve_down_limit, curve_point_limit)
  out <- data.frame(
    term_id = fg$pathway,
    term_name = fg$pathway,
    pvalue = fg$pval,
    padj = fg$padj,
    enrichmentScore = fg$ES,
    NES = fg$NES,
    size = fg$size,
    genes = vapply(fg$leadingEdge, paste, collapse = ";", character(1)),
    reference = reference_name,
    method = "fgsea webR",
    check.names = FALSE
  )
  curve_out <- curves$curves
  hit_out <- curves$hits
}
paste(
  csv_text(out),
  ${fgseaRString(FGSEA_CURVE_SEPARATOR.trim())},
  csv_text(curve_out),
  ${fgseaRString(FGSEA_HIT_SEPARATOR.trim())},
  csv_text(hit_out),
  sep = "\\n"
)
`;
  const result = await evalR(code);
  return fgseaParseWebRResult(result);
}

function fgseaParseWebRResult(result) {
  const text = fgseaResultText(result);
  const [resultText, curveAndHitText = ''] = text.split(FGSEA_CURVE_SEPARATOR);
  const [curveText = '', hitText = ''] = curveAndHitText.split(FGSEA_HIT_SEPARATOR);
  const rows = parseEnrichmentCsv(resultText).map((row) => ({
    ...row,
    term_name: row.term_name || row.term_id || row.pathway,
    term_id: row.term_id || row.pathway || '',
  }));
  return {
    rows,
    enrichment_curves: fgseaBuildEnrichmentCurves(parseCsv(curveText), parseCsv(hitText), rows),
  };
}

function fgseaBuildEnrichmentCurves(curveRows, hitRows, rows) {
  const rowByTerm = new Map(rows.map((row) => [String(row.term_id || row.pathway || ''), row]));
  const curves = new Map();

  curveRows.forEach((point) => {
    const termId = String(point.term_id || '').trim();
    const rank = Number(point.rank);
    const runningScore = Number(point.runningScore);
    if (!termId || !Number.isFinite(rank) || !Number.isFinite(runningScore)) return;
    if (!curves.has(termId)) {
      const row = rowByTerm.get(termId) || {};
      curves.set(termId, {
        term_id: termId,
        term_name: row.term_name || termId,
        enrichmentScore: numericOrEmpty(point.enrichmentScore),
        NES: numericOrEmpty(point.NES),
        padj: numericOrEmpty(point.padj),
        size: numericOrEmpty(point.size),
        totalRanks: numericOrEmpty(point.totalRanks),
        points: [],
        hits: [],
      });
    }
    curves.get(termId).points.push({ rank, runningScore });
  });

  hitRows.forEach((hit) => {
    const termId = String(hit.term_id || '').trim();
    const rank = Number(hit.rank);
    if (!termId || !curves.has(termId) || !Number.isFinite(rank)) return;
    curves.get(termId).hits.push({
      rank,
      gene: String(hit.gene || ''),
      stat: numericOrEmpty(hit.stat),
    });
  });

  const order = new Map(rows.map((row, index) => [String(row.term_id || row.pathway || ''), index]));
  return Array.from(curves.values())
    .map((curve) => ({
      ...curve,
      points: curve.points.sort((a, b) => a.rank - b.rank),
      hits: curve.hits.sort((a, b) => a.rank - b.rank),
    }))
    .sort((a, b) => (order.get(a.term_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.term_id) ?? Number.MAX_SAFE_INTEGER));
}

function numericOrEmpty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function fgseaStatsCsv(rows) {
  const columns = ['gene_id', 'gene_symbol', 'statistic', 'log2FoldChange', 'pvalue', 'padj'];
  const geneSymbols = fgseaGeneSymbolLookup();
  return [columns.join(',')]
    .concat(rows.map((row) => columns.map((column) => fgseaCsvEscape(fgseaStatsValue(row, column, geneSymbols))).join(',')))
    .join('\n');
}

function fgseaStatsValue(row, column, geneSymbols) {
  if (column !== 'gene_symbol') return row[column];
  return row.gene_symbol || geneSymbols.get(fgseaGeneKey(row.gene_id)) || '';
}

function fgseaGeneSymbolLookup() {
  const lookup = new Map();
  const addGene = (geneId, geneSymbol) => {
    const key = fgseaGeneKey(geneId);
    const symbol = fgseaGeneLabel(geneSymbol);
    if (key && symbol && !lookup.has(key)) lookup.set(key, symbol);
  };

  (state.geneAnnotation || []).forEach((gene) => {
    addGene(gene.gene_id, gene.gene_symbol || gene.gene_name);
  });
  (state.counts || []).forEach((row) => {
    const geneId = row.gene_id || row.gene_symbol || row.gene_name;
    addGene(geneId, row.gene_symbol || row.gene_name);
  });

  return lookup;
}

function fgseaGeneKey(value) {
  return String(value ?? '').trim();
}

function fgseaGeneLabel(value) {
  const label = String(value ?? '').trim();
  return label && !['NA', 'N/A', 'NULL', 'NONE'].includes(label.toUpperCase()) ? label : '';
}

function fgseaCsvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function fgseaResultText(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.values)) return result.values.join('\n');
  if (result?.values?.[0] !== undefined) return String(result.values[0]);
  return String(result ?? '');
}

function fgseaPositiveInteger(value, min, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function syncFgseaCurveControls() {
  const preset = document.getElementById('gsea-curve-limit')?.value || FGSEA_CURVE_DEFAULT_PRESET;
  const customControls = document.getElementById('gsea-curve-custom-controls');
  if (customControls) customControls.hidden = preset !== 'custom';
}

function fgseaCurveSettingValue() {
  const presetInput = document.getElementById('gsea-curve-limit');
  const preset = String(presetInput?.value || FGSEA_CURVE_DEFAULT_PRESET).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FGSEA_CURVE_PRESETS, preset)) {
    return fgseaNormalizeCurveSetting({ preset, ...FGSEA_CURVE_PRESETS[preset] });
  }
  if (preset === 'custom') {
    return fgseaNormalizeCurveSetting({
      preset,
      up: document.getElementById('gsea-curve-up-limit')?.value,
      down: document.getElementById('gsea-curve-down-limit')?.value,
    });
  }
  if (presetInput) presetInput.value = FGSEA_CURVE_DEFAULT_PRESET;
  syncFgseaCurveControls();
  return fgseaDefaultCurveSetting();
}

function fgseaNormalizeCurveSetting(setting = {}) {
  const fallback = FGSEA_CURVE_PRESETS[FGSEA_CURVE_DEFAULT_PRESET];
  const preset = String(setting.preset || FGSEA_CURVE_DEFAULT_PRESET).trim().toLowerCase();
  const up = fgseaBoundedCurveCount(setting.up, fallback.up);
  const down = fgseaBoundedCurveCount(setting.down, fallback.down);
  if ((up + down) < 1) return fgseaDefaultCurveSetting();
  return {
    preset: preset === 'custom' ? 'custom' : (FGSEA_CURVE_PRESETS[preset] ? preset : FGSEA_CURVE_DEFAULT_PRESET),
    up,
    down,
    id: preset === 'custom' ? `custom-up${up}-down${down}` : (FGSEA_CURVE_PRESETS[preset] ? preset : FGSEA_CURVE_DEFAULT_PRESET),
  };
}

function fgseaDefaultCurveSetting() {
  return fgseaNormalizeCurveSetting({
    preset: FGSEA_CURVE_DEFAULT_PRESET,
    ...FGSEA_CURVE_PRESETS[FGSEA_CURVE_DEFAULT_PRESET],
  });
}

function fgseaBoundedCurveCount(value, fallback) {
  const n = fgseaPositiveInteger(value, 0, fallback);
  return Math.max(0, Math.min(FGSEA_CURVE_MAX_PER_DIRECTION, n));
}

function fgseaCurveSettingId(curveSetting) {
  return fgseaNormalizeCurveSetting(curveSetting).id;
}

function fgseaSetStatus(element, message) {
  if (element) element.textContent = message;
}

function fgseaRString(value) {
  return JSON.stringify(String(value));
}
