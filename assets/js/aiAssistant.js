import { state, logAnalysis, setStatus, yieldToBrowser } from './state.js';
import { summarizeQC } from './qc.js';

const AI_ASSISTANT_DEFAULT_BASE_URL = 'http://127.0.0.1:10531/v1';
const AI_ASSISTANT_DEFAULT_MAX_TOKENS = 900;

let aiAssistantWired = false;
let aiAssistantModels = [];

export function setupAiAssistant() {
  const enabled = aiAssistantEnabled();
  syncAiAssistantVisibility(enabled);
  if (!enabled) return;

  applyAiAssistantConfig();
  renderAiAssistantModels();
  setAiAssistantConnectionState('Not connected', 'warn');
  setAiAssistantStatus('Start the local ChatGPT OAuth proxy, then connect.');

  if (aiAssistantWired) return;
  aiAssistantWired = true;
  document.getElementById('ai-connect')?.addEventListener('click', () => connectAiAssistant());
  document.getElementById('ai-refresh-models')?.addEventListener('click', () => connectAiAssistant({ refresh: true }));
  document.getElementById('ai-ask')?.addEventListener('click', () => askAiAssistant());
  document.getElementById('ai-clear')?.addEventListener('click', clearAiAssistantResponse);
  document.querySelectorAll('[data-ai-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = document.getElementById('ai-prompt');
      if (prompt) {
        prompt.value = button.dataset.aiPrompt || '';
        prompt.focus();
      }
    });
  });
}

export function refreshAiAssistant() {
  if (!aiAssistantEnabled()) {
    syncAiAssistantVisibility(false);
    return;
  }
  syncAiAssistantVisibility(true);
}

function aiAssistantEnabled() {
  return state.config?.ai?.enabled === true;
}

function syncAiAssistantVisibility(enabled) {
  document.querySelectorAll('[data-ai-feature]').forEach((element) => {
    element.hidden = !enabled;
  });

  const activePanel = document.getElementById('tab-ai')?.classList.contains('active');
  if (!enabled && activePanel) {
    document.querySelector('.tab-button[data-tab="overview"]')?.click();
  }
}

function applyAiAssistantConfig() {
  const cfg = aiAssistantConfig();
  const baseUrl = document.getElementById('ai-base-url');
  const modelInput = document.getElementById('ai-model-input');
  if (baseUrl && !baseUrl.value) baseUrl.value = cfg.baseUrl || AI_ASSISTANT_DEFAULT_BASE_URL;
  if (modelInput && !modelInput.value) modelInput.value = cfg.model || '';
}

async function connectAiAssistant(options = {}) {
  try {
    setAiAssistantConnectionState(options.refresh ? 'Refreshing...' : 'Connecting...', 'warn');
    setAiAssistantStatus('Checking local AI endpoint...');
    setStatus('AI assistant: checking local endpoint', { busy: true });
    await yieldToBrowser();

    aiAssistantModels = await fetchAiAssistantModels();
    renderAiAssistantModels();
    const model = selectedAiAssistantModel();
    setAiAssistantConnectionState('Connected', 'ok');
    setAiAssistantStatus(model ? `Connected. Selected model: ${model}.` : 'Connected. Choose a model before asking.');
    setStatus('AI assistant connected', { tone: 'ok' });
    logAnalysis(`AI assistant connected to ${currentAiAssistantBaseUrl()}.`);
  } catch (error) {
    setAiAssistantConnectionState('Connection failed', 'fail');
    setAiAssistantStatus(`Connection failed: ${error.message}`);
    setStatus('AI assistant connection failed', { tone: 'fail' });
    logAnalysis(`AI assistant connection failed: ${error.message}`);
  }
}

async function fetchAiAssistantModels() {
  const url = `${currentAiAssistantBaseUrl()}/models`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await aiAssistantReadJsonResponse(response);
  if (!response.ok) throw new Error(aiAssistantErrorMessage(payload, response));
  const models = (Array.isArray(payload?.data) ? payload.data : [])
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
  return Array.from(new Set(models));
}

function renderAiAssistantModels() {
  const select = document.getElementById('ai-model-select');
  if (!select) return;

  const cfgModel = aiAssistantConfig().model || '';
  const customModel = document.getElementById('ai-model-input')?.value?.trim() || '';
  const preferred = select.value || customModel || cfgModel;
  const models = aiAssistantModels.length ? aiAssistantModels : (cfgModel ? [cfgModel] : []);
  select.replaceChildren(...[
    aiAssistantOption('', models.length ? 'Choose model' : 'Connect to load models'),
    ...models.map((model) => aiAssistantOption(model, model)),
  ]);
  if (models.includes(preferred)) select.value = preferred;
  else if (models.includes(cfgModel)) select.value = cfgModel;
  else if (models.length === 1) select.value = models[0];
}

function aiAssistantOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

async function askAiAssistant() {
  const prompt = document.getElementById('ai-prompt')?.value?.trim() || '';
  if (!prompt) {
    setAiAssistantStatus('Enter a prompt before asking.');
    return;
  }
  const model = selectedAiAssistantModel();
  if (!model) {
    setAiAssistantStatus('Choose a model before asking.');
    return;
  }

  const button = document.getElementById('ai-ask');
  try {
    if (button) button.disabled = true;
    setAiAssistantStatus('Asking model...');
    setStatus('AI assistant: asking model', { busy: true });
    await yieldToBrowser();

    const responseText = await fetchAiAssistantCompletion(prompt, model);
    const response = document.getElementById('ai-response');
    if (response) response.textContent = responseText || 'The model returned an empty response.';
    setAiAssistantStatus('Response received.');
    setStatus('AI assistant response received', { tone: 'ok' });
    logAnalysis(`AI assistant response received from ${model}.`);
  } catch (error) {
    setAiAssistantStatus(`AI request failed: ${error.message}`);
    setStatus('AI assistant request failed', { tone: 'fail' });
    logAnalysis(`AI assistant request failed: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function fetchAiAssistantCompletion(prompt, model) {
  const includeContext = document.getElementById('ai-include-context')?.checked !== false;
  const cfg = aiAssistantConfig();
  const userContent = includeContext
    ? `Report context:\n${JSON.stringify(buildAiAssistantReportContext(), null, 2)}\n\nUser request:\n${prompt}`
    : prompt;
  const body = {
    model,
    messages: [
      { role: 'system', content: cfg.systemPrompt || defaultAiAssistantSystemPrompt() },
      { role: 'user', content: userContent },
    ],
    stream: false,
    max_tokens: Number(cfg.maxTokens) || AI_ASSISTANT_DEFAULT_MAX_TOKENS,
  };

  const response = await fetch(`${currentAiAssistantBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await aiAssistantReadJsonResponse(response);
  if (!response.ok) throw new Error(aiAssistantErrorMessage(payload, response));
  return payload?.choices?.[0]?.message?.content || payload?.output_text || '';
}

async function aiAssistantReadJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (response.ok) throw new Error(`AI endpoint returned invalid JSON: ${error.message}`);
    return { error: { message: text } };
  }
}

function aiAssistantErrorMessage(payload, response) {
  return payload?.error?.message || `${response.status} ${response.statusText}`.trim();
}

function buildAiAssistantReportContext() {
  const cfg = state.config || {};
  const qcSummary = summarizeQC();
  return {
    report: {
      title: cfg.projectTitle || cfg.reportTitle || '',
      subtitle: cfg.reportSubtitle || '',
      run_id: cfg.runId || '',
      version: cfg.reportVersion || '',
    },
    samples: {
      count: state.samples.length,
      metadata_columns: aiAssistantMetadataColumns(),
      groups: aiAssistantSampleGroups(),
    },
    count_matrix: {
      genes: state.counts.length,
      warnings: state.countMatrixWarnings || [],
      gene_symbol_column: state.countMatrixInfo?.hasGeneSymbolColumn === true,
    },
    qc: {
      ok: qcSummary.counts.ok,
      warn: qcSummary.counts.warn,
      fail: qcSummary.counts.fail,
    },
    pca: aiAssistantPcaSummary(),
    contrasts: state.contrasts.slice(0, 12).map((contrast) => ({
      id: contrast.id,
      label: contrast.label || contrast.id,
      numerator: contrast.numerator ?? '',
      denominator: contrast.denominator ?? '',
      column: contrast.column || '',
    })),
    de_results: aiAssistantDeSummaries(),
    enrichment_results: aiAssistantEnrichmentSummaries(),
    provenance: aiAssistantLimitedObject(state.provenance, 14),
    software: aiAssistantLimitedObject(state.software, 14),
  };
}

function aiAssistantMetadataColumns() {
  const keys = new Set();
  state.samples.forEach((sample) => {
    Object.keys(sample || {}).forEach((key) => {
      if (key !== 'sample_id') keys.add(key);
    });
  });
  return Array.from(keys).slice(0, 24);
}

function aiAssistantSampleGroups() {
  return aiAssistantMetadataColumns()
    .map((column) => {
      const counts = new Map();
      state.samples.forEach((sample) => {
        const value = String(sample?.[column] ?? '').trim() || 'NA';
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      if (counts.size < 2 || counts.size > 10) return null;
      return {
        column,
        levels: Array.from(counts.entries()).map(([level, count]) => ({ level, count })),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function aiAssistantPcaSummary() {
  const variance = state.pca?.variance_explained || state.pca?.variance || {};
  return {
    sample_points: Array.isArray(state.pca?.samples) ? state.pca.samples.length : 0,
    variance_explained: aiAssistantLimitedObject(variance, 6),
  };
}

function aiAssistantDeSummaries() {
  return Array.from(state.deResults.entries()).slice(0, 8).map(([contrastId, rows]) => {
    const padjThreshold = Number(document.getElementById('padj-threshold')?.value || 0.05);
    const lfcThreshold = Number(document.getElementById('lfc-threshold')?.value || 1);
    const usableRows = Array.isArray(rows) ? rows : [];
    const degRows = usableRows.filter((row) => {
      const padj = Number(row.padj);
      const lfc = Number(row.log2FoldChange);
      return Number.isFinite(padj) && padj <= padjThreshold && Number.isFinite(lfc) && Math.abs(lfc) >= lfcThreshold;
    });
    return {
      contrast_id: contrastId,
      rows: usableRows.length,
      thresholds: { padj: padjThreshold, abs_log2fc: lfcThreshold },
      significant: {
        total: degRows.length,
        up: degRows.filter((row) => Number(row.log2FoldChange) > 0).length,
        down: degRows.filter((row) => Number(row.log2FoldChange) < 0).length,
      },
      top_genes: usableRows
        .filter((row) => Number.isFinite(Number(row.padj)))
        .sort((a, b) => Number(a.padj) - Number(b.padj))
        .slice(0, 12)
        .map((row) => ({
          gene: row.gene_symbol || row.gene_id || row.gene_name || '',
          log2FoldChange: aiAssistantRound(row.log2FoldChange),
          padj: aiAssistantRound(row.padj),
        })),
    };
  });
}

function aiAssistantEnrichmentSummaries() {
  return Array.from(state.enrichmentResults.values()).slice(0, 8).map((entry) => {
    const rows = Array.isArray(entry) ? entry : (entry?.rows || []);
    return {
      label: Array.isArray(entry) ? 'enrichment' : (entry.label || entry.source_label || entry.result_id || ''),
      rows: rows.length,
      top_pathways: rows
        .filter((row) => Number.isFinite(Number(row.padj ?? row.pvalue)))
        .sort((a, b) => Number(a.padj ?? a.pvalue) - Number(b.padj ?? b.pvalue))
        .slice(0, 10)
        .map((row) => ({
          pathway: row.pathway || row.term || row.name || row.ID || '',
          NES: aiAssistantRound(row.NES),
          padj: aiAssistantRound(row.padj ?? row.pvalue),
        })),
    };
  });
}

function aiAssistantLimitedObject(value, limit) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, limit));
}

function aiAssistantRound(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value ?? '';
  if (number === 0) return 0;
  if (Math.abs(number) < 0.001) return Number(number.toExponential(3));
  return Number(number.toPrecision(4));
}

function defaultAiAssistantSystemPrompt() {
  return [
    'You are an RNA-seq report assistant for scientists.',
    'Use the supplied report context when it is present.',
    'Be concise, distinguish observations from speculation, and mention when the report context is insufficient.',
    'Do not invent gene or pathway results that are not in the context.',
  ].join(' ');
}

function selectedAiAssistantModel() {
  return document.getElementById('ai-model-select')?.value
    || document.getElementById('ai-model-input')?.value?.trim()
    || aiAssistantConfig().model
    || '';
}

function currentAiAssistantBaseUrl() {
  return normalizeAiAssistantBaseUrl(document.getElementById('ai-base-url')?.value || aiAssistantConfig().baseUrl);
}

function normalizeAiAssistantBaseUrl(value) {
  const raw = String(value || AI_ASSISTANT_DEFAULT_BASE_URL).trim() || AI_ASSISTANT_DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return raw.replace(/\/$/, '');
  }
}

function aiAssistantConfig() {
  return state.config?.ai || {};
}

function setAiAssistantConnectionState(message, tone = '') {
  const element = document.getElementById('ai-connection-state');
  if (!element) return;
  element.textContent = message;
  ['ok', 'warn', 'fail'].forEach((item) => element.classList.toggle(item, tone === item));
}

function setAiAssistantStatus(message) {
  const status = document.getElementById('ai-status');
  if (status) status.textContent = message;
}

function clearAiAssistantResponse() {
  const prompt = document.getElementById('ai-prompt');
  const response = document.getElementById('ai-response');
  if (prompt) prompt.value = '';
  if (response) response.textContent = '';
  setAiAssistantStatus('Cleared.');
}
