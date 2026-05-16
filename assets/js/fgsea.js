import { state, logAnalysis, createProgressReporter, runWithProgressPulse } from './state.js';
import { loadDeForContrast, loadText, parseCsv } from './dataLoader.js';
import { ensureRPackages } from './packageManager.js';
import { renderEnrichment } from './plots.js';
import { renderTable } from './tables.js';
import { evalR } from './webrManager.js';

let fgseaControlsWired = false;

export function setupFgseaControls() {
  populateGseaReferences();
  if (fgseaControlsWired) return;
  fgseaControlsWired = true;
  document.getElementById('gsea-run')?.addEventListener('click', runFgseaAnalysis);
}

export async function runFgseaAnalysis() {
  const contrastSelect = document.getElementById('enrichment-contrast-select');
  const reference = document.getElementById('gsea-reference')?.value || state.config?.analysis?.gseaReference || 'hg38';
  const contrast = state.contrasts.find((item) => item.id === contrastSelect?.value) || state.contrasts[0];
  const status = document.getElementById('gsea-status');
  const runButton = document.getElementById('gsea-run');
  const runButtonLabel = runButton?.textContent || 'Run fgsea';
  const progress = createProgressReporter('fgsea', 6);
  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = 'Running fgsea...';
    runButton.setAttribute('aria-busy', 'true');
  }

  try {
    if (!contrast) throw new Error('Run or select a DE contrast before fgsea.');
    fgseaSetStatus(status, 'Loading ranked DE result...');
    await progress.step('Loading ranked DE result', 1);
    const deRows = await loadDeForContrast(contrast);
    if (!deRows.length) throw new Error('No DE rows are available. Run DESeq2 first for uploaded data.');

    fgseaSetStatus(status, 'Loading pathway GMT...');
    await progress.step(`Loading ${reference} pathway GMT`, 2);
    const gmtText = await loadGmtForReference(reference);
    const minSize = fgseaPositiveInteger(document.getElementById('gsea-min-size')?.value, 1, 5);
    const maxSize = fgseaPositiveInteger(document.getElementById('gsea-max-size')?.value, minSize, 500);

    fgseaSetStatus(status, 'Loading fgsea package in webR. First run can take a few minutes.');
    await progress.step('Loading fgsea package in webR', 3);
    await ensureRPackages(fgseaPackageSet(), { load: ['fgsea'] });

    const runMessage = `Running fgsea in webR for ${deRows.length} ranked genes`;
    fgseaSetStatus(status, `${runMessage}. Keep this tab open.`);
    await progress.step(runMessage, 4);
    const rows = await runWithProgressPulse(
      progress,
      `${runMessage}; still working`,
      () => fgseaRunInWebR(deRows, gmtText, reference, minSize, maxSize),
      {
        intervalMs: 10000,
        onPulse: (message) => fgseaSetStatus(status, `${message}. Keep this tab open.`),
      },
    );
    if (!rows.length) throw new Error('fgsea returned no pathways. Check gene identifiers and pathway gene sets.');

    await progress.step('Rendering enrichment plot and table', 5);
    state.enrichmentResults.set(contrast.id, rows);
    renderEnrichment(rows);
    renderTable('enrichment-table', rows, { pageLength: 25, exportName: `${contrast.id}.${reference}.fgsea.csv` });
    const message = `fgsea complete for ${contrast.label || contrast.id}: ${rows.length} pathways (${reference}).`;
    fgseaSetStatus(status, message);
    await progress.done(`${rows.length} pathways (${reference})`);
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

function populateGseaReferences() {
  const select = document.getElementById('gsea-reference');
  if (!select) return;
  const references = gseaReferences();
  const previous = select.value || state.config?.analysis?.gseaReference || 'hg38';
  select.innerHTML = Object.entries(references)
    .map(([id, reference]) => `<option value="${fgseaEscapeHtml(id)}">${fgseaEscapeHtml(reference.label || id)}</option>`)
    .join('');
  select.value = references[previous] ? previous : Object.keys(references)[0] || '';
}

function gseaReferences() {
  return state.config?.gsea?.references || {
    hg38: { label: 'hg38', pathwayFile: 'gsea/hg38_demo.gmt' },
    mm10: { label: 'mm10', pathwayFile: 'gsea/mm10_demo.gmt' },
  };
}

async function loadGmtForReference(referenceId) {
  const uploaded = document.getElementById('gsea-gmt-file')?.files?.[0];
  if (uploaded) return uploaded.text();

  const reference = gseaReferences()[referenceId];
  if (!reference?.pathwayFile) throw new Error(`No pathway file is configured for ${referenceId}.`);
  const dataRoot = state.config?.dataRoot || 'assets/data';
  const text = await loadText(`${dataRoot}/${reference.pathwayFile}`, true);
  if (!text) throw new Error(`No pathway GMT was found for ${referenceId}.`);
  return text;
}

async function fgseaRunInWebR(deRows, gmtText, reference, minSize, maxSize) {
  const statsCsv = fgseaStatsCsv(deRows);
  const code = `
suppressPackageStartupMessages(library(fgsea))
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
    unique(parts[-c(1, 2)])
  })
  names(pathways) <- vapply(lines, function(line) strsplit(line, "\\t", fixed = TRUE)[[1]][1], character(1))
  pathways
}

pathways <- parse_gmt(gmt_text)
fg <- fgseaMultilevel(pathways = pathways, stats = stats, minSize = min_size, maxSize = max_size, nproc = 1)
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
  return [columns.join(',')]
    .concat(rows.map((row) => columns.map((column) => fgseaCsvEscape(row[column])).join(',')))
    .join('\n');
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

function fgseaEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
