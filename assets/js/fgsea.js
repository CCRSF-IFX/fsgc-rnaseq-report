import { state, logAnalysis, createProgressReporter, runWithProgressPulse } from './state.js';
import { loadDeForContrast, loadGeneAnnotation, parseCsv } from './dataLoader.js';
import { ensureRPackages } from './packageManager.js';
import { renderCurrentEnrichment, storeGseaResult } from './enrichment.js';
import { evalR } from './webrManager.js';
import { markAnalysisCacheDirty } from './analysisCache.js';

let fgseaControlsWired = false;

export function setupFgseaControls() {
  if (fgseaControlsWired) return;
  fgseaControlsWired = true;
  document.getElementById('gsea-run')?.addEventListener('click', runFgseaAnalysis);
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

    const minSize = fgseaPositiveInteger(document.getElementById('gsea-min-size')?.value, 1, 5);
    const maxSize = fgseaPositiveInteger(document.getElementById('gsea-max-size')?.value, minSize, 500);

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
      const rows = await runWithProgressPulse(
        progress,
        `${sourceMessage}; still working`,
        () => fgseaRunInWebR(deRows, source.gmtText, source.source_label, minSize, maxSize),
        {
          intervalMs: 10000,
          onPulse: (message) => fgseaSetStatus(status, `${message}. Keep this tab open.`),
        },
      );
      if (!rows.length) throw new Error(`fgsea returned no pathways for ${source.source_label}. Check gene identifiers and pathway gene sets.`);
      const resultId = fgseaResultId(contrast.id, source, minSize, maxSize);
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
        created_at: new Date().toISOString(),
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
    const message = `fgsea complete for ${contrast.label || contrast.id}: ${totalPathways} pathway rows across ${sourceLabel}.`;
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

function fgseaResultId(contrastId, source, minSize, maxSize) {
  return [
    contrastId,
    source.source_kind,
    source.source_id || source.source_label,
    `min${minSize}`,
    `max${maxSize}`,
  ].map(fgseaSlug).filter(Boolean).join('__');
}

function fgseaSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gsea';
}

async function fgseaRunInWebR(deRows, gmtText, reference, minSize, maxSize) {
  await loadGeneAnnotation(false);
  const statsCsv = fgseaStatsCsv(deRows);
  const code = `
suppressPackageStartupMessages(library(fgsea))
fgsea_param <- BiocParallel::SerialParam(progressbar = FALSE)
BiocParallel::register(fgsea_param, default = TRUE)
stats_text <- ${fgseaRString(statsCsv)}
gmt_text <- ${fgseaRString(gmtText)}
reference_name <- ${fgseaRString(reference)}
min_size <- ${Number(minSize)}
max_size <- ${Number(maxSize)}

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
  pvalue[!is.finite(pvalue) | pvalue <= 0] <- 1
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
} else {
  fg <- fg[order(fg$padj, -abs(fg$NES)), ]
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
}
paste(capture.output(write.csv(out, row.names = FALSE, na = "")), collapse = "\\n")
`;
  const result = await evalR(code);
  return parseCsv(fgseaResultText(result)).map((row) => ({
    ...row,
    term_name: row.term_name || row.term_id || row.pathway,
    term_id: row.term_id || row.pathway || '',
  }));
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

function fgseaSetStatus(element, message) {
  if (element) element.textContent = message;
}

function fgseaRString(value) {
  return JSON.stringify(String(value));
}
