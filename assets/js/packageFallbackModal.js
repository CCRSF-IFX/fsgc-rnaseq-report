import { logAnalysis, setStatus, state } from './state.js';
import { checkPackageSnapshot, getPackageSnapshotStatus } from './packageSnapshot.js';
import {
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
        <a id="package-fallback-download" class="button" href="#" download>Download webR library bundle</a>
        <label class="file-button secondary">Choose downloaded bundle
          <input id="package-fallback-bundle-file" type="file" accept=".zip,.data,.gz,.metadata,.json" multiple />
        </label>
        <button id="package-fallback-retry" class="secondary" type="button">Retry online snapshot</button>
        <button id="package-fallback-continue" class="secondary" type="button">Continue report only</button>
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
  document.getElementById('package-fallback-download')?.addEventListener('click', () => {
    setPackageFallbackStatus('After the download finishes, choose the ZIP here to mount it in webR.', 'warn');
  });
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
    download.href = url;
    download.setAttribute('download', bundle.archiveFile || '');
    download.removeAttribute('aria-disabled');
  } else {
    download.href = '#';
    download.setAttribute('aria-disabled', 'true');
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
  ['package-fallback-retry', 'package-fallback-continue', 'package-fallback-close'].forEach((id) => {
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
    bundle.artifactVersion || bundle.version || bundle.releaseTag || bundle.archiveFile || 'library',
  ].map((part) => String(part || '').trim().replace(/\s+/g, '-'));
  return `rnaseq-report:package-fallback-dismissed:${parts.join(':')}`;
}
