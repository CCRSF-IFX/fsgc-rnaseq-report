import { logAnalysis, setStatus, state } from './state.js';
import { checkPackageSnapshot, getPackageSnapshotStatus } from './packageSnapshot.js';
import {
  downloadPackageFileWithProgress,
  mountPackageRepositoryLibraryBundle,
  packageRepositoryLibraryBundleConfig,
  packageRepositoryLibraryBundleDownloadUrl,
  packageRepositoryRequiredPackages,
} from './packageRepository.js';

let fallbackModalWired = false;
let fallbackCallbacks = {};

export function setupPackageFallbackModal(callbacks = {}) {
  fallbackCallbacks = callbacks;
  ensurePackageFallbackModal();
  if (!fallbackModalWired) {
    fallbackModalWired = true;
    wirePackageFallbackModal();
    document.addEventListener('rnaseq-report:package-snapshot-changed', syncPackageFallbackModal);
    document.addEventListener('rnaseq-report:packages-changed', syncPackageFallbackModal);
  }
  syncPackageFallbackModal();
  if (state.config?.webr?.enabled !== false && getPackageSnapshotStatus().state === 'unchecked') {
    checkPackageSnapshot().catch((error) => logAnalysis(`webR package snapshot check failed: ${error.message}`));
  }
}

function ensurePackageFallbackModal() {
  if (document.getElementById('package-fallback-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'package-fallback-modal';
  modal.className = 'modal-backdrop package-fallback-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="package-fallback-title">
      <div class="modal-header">
        <h4 id="package-fallback-title">Online package snapshot is unavailable</h4>
        <button id="package-fallback-close" class="secondary icon-button" type="button" aria-label="Continue report only">&times;</button>
      </div>
      <p class="note">The report can still be viewed. To run browser-side DESeq2 or fgsea, download the prebuilt webR library bundle and choose it here.</p>
      <div id="package-fallback-status" class="status-message fail"></div>
      <p id="package-fallback-bundle-name" class="package-fallback-bundle-name"></p>
      <div class="modal-actions package-fallback-actions">
        <button id="package-fallback-download" type="button">Download webR library bundle</button>
        <label class="file-button secondary">Choose downloaded bundle
          <input id="package-fallback-bundle-file" type="file" accept=".zip,.data,.gz,.metadata,.json" multiple />
        </label>
        <button id="package-fallback-retry" class="secondary" type="button">Retry online snapshot</button>
        <button id="package-fallback-continue" class="secondary" type="button">Continue report only</button>
      </div>
      <div id="package-fallback-download-progress" class="operation-progress" role="status" aria-live="polite" hidden>
        <div class="operation-progress-head">
          <strong id="package-fallback-download-progress-title">Preparing download</strong>
          <span id="package-fallback-download-progress-detail">Starting...</span>
        </div>
        <div class="operation-progress-track" aria-hidden="true"><span id="package-fallback-download-progress-fill"></span></div>
      </div>
      <label class="check-label package-fallback-dismiss">
        <input id="package-fallback-dismiss" type="checkbox" />
        <span>Don't show again for this report and package version</span>
      </label>
    </div>`;
  document.body.appendChild(modal);
}

function wirePackageFallbackModal() {
  document.getElementById('package-fallback-close')?.addEventListener('click', continueReportOnly);
  document.getElementById('package-fallback-continue')?.addEventListener('click', continueReportOnly);
  document.getElementById('package-fallback-retry')?.addEventListener('click', retryPackageSnapshot);
  document.getElementById('package-fallback-download')?.addEventListener('click', downloadPackageFallbackBundle);
  document.getElementById('package-fallback-bundle-file')?.addEventListener('change', mountSelectedPackageBundle);
}

function syncPackageFallbackModal() {
  const status = getPackageSnapshotStatus();
  const modal = document.getElementById('package-fallback-modal');
  if (!modal) return;

  configurePackageFallbackDownload();

  if (status.available === true) {
    hidePackageFallbackModal();
    return;
  }
  if (status.state === 'checking') {
    setPackageFallbackStatus('Checking whether the online package snapshot is available...', 'warn');
    return;
  }
  if (status.available === false && !packageFallbackDismissed()) {
    showPackageFallbackModal(status);
  }
}

function showPackageFallbackModal(status) {
  const modal = document.getElementById('package-fallback-modal');
  if (!modal) return;
  configurePackageFallbackDownload();
  setPackageFallbackStatus(
    status?.message || 'Online package snapshot is unavailable. Install/load packages is disabled until the snapshot is available or a local bundle is mounted.',
    'fail',
  );
  modal.hidden = false;
  document.getElementById('package-fallback-download')?.focus();
}

function hidePackageFallbackModal() {
  const modal = document.getElementById('package-fallback-modal');
  if (modal) modal.hidden = true;
}

function configurePackageFallbackDownload() {
  const bundle = packageRepositoryLibraryBundleConfig();
  const url = packageRepositoryLibraryBundleDownloadUrl();
  const download = document.getElementById('package-fallback-download');
  const name = document.getElementById('package-fallback-bundle-name');
  if (name) name.textContent = bundle.archiveFile ? `Expected bundle: ${bundle.archiveFile}` : '';
  if (!download) return;
  if (url) {
    download.dataset.downloadUrl = url;
    download.dataset.downloadName = bundle.archiveFile || '';
    download.removeAttribute('aria-disabled');
    download.disabled = false;
  } else {
    delete download.dataset.downloadUrl;
    delete download.dataset.downloadName;
    download.setAttribute('aria-disabled', 'true');
    download.disabled = true;
  }
}

async function downloadPackageFallbackBundle() {
  const button = document.getElementById('package-fallback-download');
  const url = button?.dataset.downloadUrl || packageRepositoryLibraryBundleDownloadUrl();
  const filename = button?.dataset.downloadName || packageRepositoryLibraryBundleConfig().archiveFile || 'webr-library-bundle.zip';
  setPackageFallbackControlsDisabled(true);
  setPackageFallbackDownloadProgress('webR library bundle', 'Starting...', null);
  setPackageFallbackStatus('Downloading the bundle. After it finishes, choose the ZIP here to mount it in webR.', 'warn');
  try {
    const result = await downloadPackageFileWithProgress({
      url,
      filename,
      label: 'webR library bundle',
      onProgress: (received, total) => {
        const hasTotal = total > 0;
        const detail = hasTotal
          ? `${formatBytes(received)} of ${formatBytes(total)}`
          : `${formatBytes(received)} downloaded`;
        setPackageFallbackDownloadProgress('webR library bundle', detail, hasTotal ? received / total : null);
      },
      onStatus: (title, detail, progress) => setPackageFallbackDownloadProgress(title || 'webR library bundle', detail, progress),
    });
    if (result.fallback) {
      setPackageFallbackDownloadProgress('webR library bundle', 'Download opened in your browser. Track progress in the browser downloads panel, then choose the ZIP here when it finishes.', null, 'handoff');
    } else {
      setPackageFallbackDownloadProgress('webR library bundle', `${result.filename} ready`, 1, 'ok');
    }
    setPackageFallbackStatus('After the download finishes, choose the ZIP here to mount it in webR.', 'warn');
  } catch (error) {
    setPackageFallbackDownloadProgress('Download failed', error.message, 1, 'fail');
    setPackageFallbackStatus(`Bundle download failed: ${error.message}`, 'fail');
  } finally {
    setPackageFallbackControlsDisabled(false);
    configurePackageFallbackDownload();
  }
}

async function retryPackageSnapshot() {
  setPackageFallbackStatus('Retrying online package snapshot...', 'warn');
  const status = await checkPackageSnapshot({ force: true });
  if (status.available === true) {
    hidePackageFallbackModal();
    refreshPackageFallbackUi();
  } else {
    showPackageFallbackModal(status);
  }
}

async function mountSelectedPackageBundle(event) {
  const input = event.currentTarget;
  try {
    setPackageFallbackStatus('Mounting local webR library bundle...', 'warn');
    setPackageFallbackControlsDisabled(true);
    const packages = await mountPackageRepositoryLibraryBundle(input?.files, {
      packages: packageRepositoryRequiredPackages(),
    });
    setPackageFallbackStatus(`Local webR library bundle mounted. Packages are ready: ${packages.join(', ')}`, 'ok');
    setStatus('Local webR library bundle mounted', { tone: 'ok' });
    hidePackageFallbackModal();
    refreshPackageFallbackUi();
  } catch (error) {
    setPackageFallbackStatus(`Library bundle mount failed: ${error.message}`, 'fail');
    logAnalysis(`webR library bundle mount failed: ${error.message}`);
  } finally {
    setPackageFallbackControlsDisabled(false);
    configurePackageFallbackDownload();
    if (input) input.value = '';
  }
}

function continueReportOnly() {
  if (document.getElementById('package-fallback-dismiss')?.checked) {
    setPackageFallbackDismissed();
  }
  hidePackageFallbackModal();
}

function setPackageFallbackControlsDisabled(disabled) {
  ['package-fallback-download', 'package-fallback-retry', 'package-fallback-continue', 'package-fallback-close'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.disabled = disabled;
  });
  const input = document.getElementById('package-fallback-bundle-file');
  if (input) input.disabled = disabled;
}

function setPackageFallbackStatus(message, tone = 'fail') {
  const status = document.getElementById('package-fallback-status');
  if (!status) return;
  status.className = `status-message ${tone}`;
  status.textContent = message;
}

function setPackageFallbackDownloadProgress(title, detail, progress = null, tone = '') {
  const container = document.getElementById('package-fallback-download-progress');
  if (!container) return;
  const titleEl = document.getElementById('package-fallback-download-progress-title');
  const detailEl = document.getElementById('package-fallback-download-progress-detail');
  const fill = document.getElementById('package-fallback-download-progress-fill');
  container.hidden = false;
  container.className = `operation-progress ${tone || ''}`.trim();
  const value = Number(progress);
  const hasProgress = Number.isFinite(value);
  container.classList.toggle('is-indeterminate', !hasProgress && tone !== 'handoff');
  if (titleEl) titleEl.textContent = title || 'Download';
  if (detailEl) detailEl.textContent = detail || '';
  if (fill) fill.style.width = hasProgress ? `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%` : '';
}

function refreshPackageFallbackUi() {
  fallbackCallbacks.refresh?.();
}

function packageFallbackDismissed() {
  try {
    return localStorage.getItem(packageFallbackDismissKey()) === '1';
  } catch (_) {
    return false;
  }
}

function setPackageFallbackDismissed() {
  try {
    localStorage.setItem(packageFallbackDismissKey(), '1');
  } catch (_) {
    /* Ignore private browsing or locked storage. */
  }
}

function packageFallbackDismissKey() {
  const cfg = state.config || {};
  const webr = cfg.webr || {};
  const bundle = webr.libraryBundle || {};
  const parts = [
    cfg.projectTitle || cfg.reportTitle || 'report',
    cfg.reportVersion || 'template',
    webr.packageRepoVersion || 'snapshot',
    bundle.version || bundle.artifactVersion || bundle.releaseTag || bundle.archiveFile || 'library',
  ].map((part) => String(part || '').trim().replace(/\s+/g, '-'));
  return `rnaseq-report:package-fallback-dismissed:${parts.join(':')}`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value.toFixed(0)} B`;
  const units = ['KB', 'MB', 'GB'];
  let current = value / 1024;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current >= 10 ? current.toFixed(1) : current.toFixed(2)} ${units[unitIndex]}`;
}
