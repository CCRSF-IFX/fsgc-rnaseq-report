export const state = {
  config: null,
  samples: [],
  qc: [],
  pca: null,
  distance: null,
  counts: [],
  geneAnnotation: [],
  geneAnnotationLoaded: false,
  contrasts: [],
  deResults: new Map(),
  enrichmentResults: new Map(),
  provenance: null,
  software: null,
  packageSnapshot: null,
  loadedTabs: new Set(),
};

export function setStatus(message, options = {}) {
  const el = document.getElementById('status-bar');
  if (!el) return;
  const text = document.getElementById('status-text');
  if (text) text.textContent = message;
  else el.textContent = message;

  const busy = Boolean(options.busy);
  el.classList.toggle('busy', busy);
  el.setAttribute('aria-busy', busy ? 'true' : 'false');
  ['ok', 'warn', 'fail'].forEach((tone) => el.classList.toggle(tone, options.tone === tone));

  const progress = document.getElementById('status-progress');
  const fill = document.getElementById('status-progress-fill');
  if (progress && fill) {
    const value = Number(options.progress);
    const hasProgress = Number.isFinite(value);
    progress.hidden = !busy && !hasProgress;
    progress.classList.toggle('indeterminate', busy && !hasProgress);
    if (hasProgress) {
      const pct = Math.max(0, Math.min(100, value * 100));
      fill.style.width = `${pct.toFixed(0)}%`;
    } else {
      fill.style.width = '';
    }
  }
}

export function logAnalysis(message) {
  const el = document.getElementById('analysis-log');
  const stamp = new Date().toLocaleTimeString();
  if (el) el.textContent += `[${stamp}] ${message}\n`;
}

export function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function createProgressReporter(label, totalSteps = 0) {
  let currentStep = 0;
  let total = Number(totalSteps) || 0;
  const prefix = String(label || 'Task').trim() || 'Task';

  const progressValue = () => (total > 0 ? Math.min(0.98, currentStep / total) : undefined);
  const fullMessage = (message) => `${prefix}: ${message}`;
  const showBusy = (message) => {
    setStatus(fullMessage(message), { busy: true, progress: progressValue() });
    return yieldToBrowser();
  };

  return {
    step(message, step = null, nextTotal = null) {
      if (Number.isFinite(Number(nextTotal)) && Number(nextTotal) > 0) total = Number(nextTotal);
      currentStep = Number.isFinite(Number(step)) ? Number(step) : currentStep + 1;
      const text = fullMessage(message);
      setStatus(text, { busy: true, progress: progressValue() });
      logAnalysis(text);
      return yieldToBrowser();
    },
    pulse(message, step = null) {
      if (Number.isFinite(Number(step))) currentStep = Number(step);
      return showBusy(message);
    },
    done(message = 'complete') {
      const text = fullMessage(message);
      setStatus(text, { tone: 'ok', progress: 1 });
      logAnalysis(text);
      return yieldToBrowser();
    },
    fail(message) {
      const text = fullMessage(message || 'failed');
      setStatus(text, { tone: 'fail' });
      logAnalysis(text);
      return yieldToBrowser();
    },
  };
}

export async function runWithProgressPulse(progress, message, callback, options = {}) {
  const startedAt = Date.now();
  const intervalMs = Math.max(1000, Number(options.intervalMs) || 10000);
  const onPulse = typeof options.onPulse === 'function' ? options.onPulse : null;
  const pulse = () => {
    const text = `${message} (${elapsedTimeLabel(startedAt)} elapsed)`;
    progress?.pulse?.(text);
    onPulse?.(text);
  };
  const timer = setInterval(pulse, intervalMs);
  try {
    return await callback();
  } finally {
    clearInterval(timer);
  }
}

function elapsedTimeLabel(startedAt) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export function getSampleById(sampleId) {
  return state.samples.find((sample) => sample.sample_id === sampleId);
}

export function metadataColumns() {
  const protectedKeys = new Set(['sample_id']);
  const keys = new Set();
  state.samples.forEach((sample) => Object.keys(sample).forEach((key) => {
    if (!protectedKeys.has(key)) keys.add(key);
  }));
  return Array.from(keys).sort();
}
