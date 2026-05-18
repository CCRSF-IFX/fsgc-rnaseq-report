import { state, logAnalysis, setStatus, yieldToBrowser } from './state.js';
import { arePackagesAvailable, ensureRPackages, getPackageStatus, markPackagesAvailable } from './packageManager.js';
import { mountRLibraryBundle } from './webrManager.js';
import { checkPackageSnapshot, getPackageSnapshotStatus, packageSnapshotBaseUrl, packageSnapshotCanInstall, packageSnapshotIndexUrl } from './packageSnapshot.js';
import { enhanceTablesWithin } from './tables.js';

export function renderPackageRepositoryPanel() {
  const container = document.getElementById('package-repository-panel');
  if (!container) return;

  const cfg = state.config?.webr || {};
  const packages = packageRepoRequiredPackages();
  const visiblePackages = packageRepoLoadPackages();
  const dependencyCount = Math.max(0, packages.length - visiblePackages.length);
  const repoUrl = packageRepoBaseUrl();
  const indexUrl = packageRepoIndexUrl();
  const bundleUrl = packageRepoBundleUrl();
  const bundleFilename = packageRepoDownloadFilename(bundleUrl, `rnaseq-report-webr-packages-${cfg.packageRepoVersion || 'snapshot'}.zip`);
  const libraryBundle = packageRepoLibraryBundleConfig();
  const libraryBundleDownloadUrl = packageRepositoryLibraryBundleDownloadUrl();
  const snapshotVersion = cfg.packageRepoVersion || 'the configured package snapshot';
  const disabled = cfg.enabled ? '' : 'disabled';
  const snapshotStatus = getPackageSnapshotStatus();
  const canInstallOrLoad = packageRepoCanInstallOrLoad(packages);
  const installDisabled = disabled || !packages.length || !canInstallOrLoad ? 'disabled' : '';

  container.innerHTML = `
    <section class="package-panel">
      <div>
        <h4>webR package snapshot</h4>
        <p class="note">${packageRepoEscapeHtml(cfg.packageRepoVersion || 'unversioned')} · ${packageRepoEscapeHtml(repoUrl || 'not configured')}</p>
        <p class="note">Showing top-level packages only; ${dependencyCount} dependencies are included in the snapshot.</p>
        <div id="package-snapshot-availability" class="status-message ${packageRepoSnapshotTone(snapshotStatus)}">${packageRepoEscapeHtml(packageRepoSnapshotMessage(snapshotStatus))}</div>
      </div>
      <div class="package-actions">
        <button class="secondary" id="package-check" ${disabled}>${snapshotStatus.state === 'checking' ? 'Checking snapshot...' : 'Check snapshot'}</button>
        <button id="package-install" ${installDisabled}>Install/load packages</button>
        <button class="secondary" id="package-download-snapshot" type="button" data-download-url="${packageRepoEscapeHtml(bundleUrl)}" data-download-name="${packageRepoEscapeHtml(bundleFilename)}" ${bundleUrl ? '' : 'disabled'}>Download snapshot ZIP</button>
      </div>
      <div class="package-local-bundle">
        <div>
          <strong>Local webR library bundle</strong>
          <p class="note">Load ${packageRepoEscapeHtml(libraryBundle.archiveFile)} to mount a prebuilt package library for ${packageRepoEscapeHtml(snapshotVersion)} without reinstalling every dependency.</p>
        </div>
        <div class="package-actions">
          ${libraryBundleDownloadUrl ? `<button id="package-download-library" type="button" data-download-url="${packageRepoEscapeHtml(libraryBundleDownloadUrl)}" data-download-name="${packageRepoEscapeHtml(libraryBundle.archiveFile || '')}">Download webR library bundle</button>` : ''}
          <label class="file-button secondary">Mount bundle <input id="package-library-bundle-file" type="file" accept=".zip,.data,.gz,.metadata,.json" multiple ${disabled} /></label>
          ${libraryBundle.releaseUrl ? `<a class="button secondary" href="${packageRepoEscapeHtml(libraryBundle.releaseUrl)}" target="_blank" rel="noopener">Release bundle</a>` : ''}
        </div>
      </div>
      <div id="package-download-progress" class="operation-progress" role="status" aria-live="polite" hidden>
        <div class="operation-progress-head">
          <strong id="package-download-progress-title">Preparing download</strong>
          <span id="package-download-progress-detail">Starting...</span>
        </div>
        <div class="operation-progress-track" aria-hidden="true"><span id="package-download-progress-fill"></span></div>
      </div>
      <div class="package-chips">${visiblePackages.map((pkg) => packageRepoPackageChip(pkg)).join('')}</div>
      <div class="package-state-table">
        <h5>Top-level package status</h5>
        <div class="table-wrap compact">${packageRepoPackageStatusTable(visiblePackages)}</div>
      </div>
      <div class="package-links">
        <a href="${packageRepoEscapeHtml(indexUrl)}" target="_blank" rel="noopener">PACKAGES index</a>
        <a href="${packageRepoEscapeHtml(repoUrl)}" target="_blank" rel="noopener">Package repository</a>
      </div>
      <div id="package-repository-status" class="package-status"></div>
    </section>`;

  if (cfg.enabled !== false && snapshotStatus.state === 'unchecked') {
    checkPackageSnapshot().finally(renderPackageRepositoryPanel);
  }

  document.getElementById('package-check')?.addEventListener('click', () => checkPackageRepository({ force: true }));
  document.getElementById('package-download-snapshot')?.addEventListener('click', () => downloadPackageRepositoryFile('package-download-snapshot', 'Package snapshot ZIP'));
  document.getElementById('package-download-library')?.addEventListener('click', () => downloadPackageRepositoryFile('package-download-library', 'webR library bundle'));
  document.getElementById('package-library-bundle-file')?.addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const files = input?.files;
    try {
      packageRepoSetStatus('Mounting local webR library bundle...', 'info');
      await mountPackageRepositoryLibraryBundle(files, { packages });
      renderPackageRepositoryPanel();
      packageRepoSetStatus('Local webR library bundle mounted; top-level analysis packages are ready to load.', 'ok');
    } catch (error) {
      packageRepoSetStatus(`Library bundle mount failed: ${error.message}`, 'fail');
      logAnalysis(`webR library bundle mount failed: ${error.message}`);
    } finally {
      if (input) input.value = '';
    }
  });
  document.getElementById('package-install')?.addEventListener('click', async () => {
    try {
      packageRepoSetStatus('Installing packages in webR...', 'info');
      if (!arePackagesAvailable(packages)) {
        await checkPackageSnapshot();
        if (!packageSnapshotCanInstall()) throw new Error(`${getPackageSnapshotStatus().message} Mount a local webR library bundle or recheck after the snapshot is available.`);
      }
      const loadPackages = packageRepoLoadPackages();
      await ensureRPackages(packages, { load: loadPackages });
      logAnalysis(`webR packages installed; loaded top-level packages: ${loadPackages.join(', ') || 'none'}`);
      renderPackageRepositoryPanel();
      packageRepoSetStatus('Packages installed; top-level analysis packages loaded.', 'ok');
    } catch (error) {
      packageRepoSetStatus(`Package install failed: ${error.message}`, 'fail');
    }
  });
}

export function packageRepositoryRequiredPackages() {
  return packageRepoRequiredPackages();
}

export function packageRepositoryLoadPackages() {
  return packageRepoLoadPackages();
}

export function packageRepositoryLibraryBundleConfig() {
  return packageRepoLibraryBundleConfig();
}

export function packageRepositoryLibraryBundleDownloadUrl() {
  const cfg = state.config?.webr || {};
  const bundle = cfg.libraryBundle || {};
  const configured = String(bundle.downloadUrl || bundle.archiveUrl || '').trim();
  if (configured) return configured;
  const archiveFile = packageRepoLibraryBundleConfig().archiveFile;
  const releaseTag = String(bundle.releaseTag || '').trim();
  if (releaseTag && archiveFile) {
    return `https://github.com/omicsreporthub/rnaseq-report/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(archiveFile)}`;
  }
  const releaseUrl = String(bundle.releaseUrl || '').trim();
  const match = releaseUrl.match(/\/releases\/tag\/([^/?#]+)/);
  if (match && archiveFile) {
    const base = releaseUrl.replace(/\/releases\/tag\/[^/?#]+.*/, '');
    return `${base}/releases/download/${encodeURIComponent(decodeURIComponent(match[1]))}/${encodeURIComponent(archiveFile)}`;
  }
  return '';
}

export async function mountPackageRepositoryLibraryBundle(files, options = {}) {
  const packages = options.packages || packageRepoRequiredPackages();
  await mountRLibraryBundle(files, packages);
  markPackagesAvailable(packages, options.status || 'mounted');
  logAnalysis('webR library bundle mounted; package downloads are not needed for this session.');
  return packages;
}

export async function downloadPackageFileWithProgress(options = {}) {
  const url = String(options.url || '').trim();
  if (!url) throw new Error('No download URL is configured.');
  const label = options.label || 'Download';
  const filename = options.filename || packageRepoDownloadFilename(url, 'download.bin');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  onStatus('Starting download', '', null);
  await yieldToBrowser();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.noDownloadFallback = true;
      throw error;
    }
    const total = Number(response.headers.get('content-length')) || 0;
    const type = response.headers.get('content-type') || 'application/octet-stream';
    if (!response.body) {
      onStatus(label, 'Downloading...', null);
      const blob = await response.blob();
      triggerBlobDownload(blob, filename);
      onProgress(blob.size || total, total || blob.size || 0);
      return { filename, bytes: blob.size || 0, measured: false };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length || 0;
      onProgress(received, total);
      await yieldToBrowser();
    }
    const blob = new Blob(chunks, { type });
    triggerBlobDownload(blob, filename);
    onProgress(blob.size || received, total || blob.size || received);
    return { filename, bytes: blob.size || received, measured: total > 0 };
  } catch (error) {
    if (error.noDownloadFallback) throw error;
    triggerUrlDownload(url, filename);
    logAnalysis(`${label} download started without measurable progress: ${error.message}`);
    return { filename, fallback: true, error };
  }
}

export async function checkPackageRepository(options = {}) {
  try {
    const snapshotStatus = await checkPackageSnapshot({ force: Boolean(options.force) });
    renderPackageRepositoryPanel();
    if (snapshotStatus.available !== true) {
      packageRepoSetStatus(`${snapshotStatus.message} Install/load packages is disabled until the snapshot is available, but you can still mount a local webR library bundle.`, 'fail');
      return;
    }
    const packages = packageRepoRequiredPackages();
    const response = await fetch(packageRepoIndexUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const records = packageRepoParsePackages(await response.text());
    const found = new Map(records.map((record) => [record.Package, record]));
    const fallbackFound = await packageRepoFallbackPackages();
    const dependencyIndex = new Map([...fallbackFound, ...found]);
    const visiblePackages = packageRepoLoadPackages();
    const dependencyCount = Math.max(0, packages.length - visiblePackages.length);
    const missing = packages.filter((pkg) => !found.has(pkg));
    const missingDeps = packageRepoMissingDependencies(packages, dependencyIndex);
    const missingVisible = visiblePackages.filter((pkg) => !found.has(pkg));
    const hiddenProblemCount = missing.filter((pkg) => !visiblePackages.includes(pkg)).length + missingDeps.length;
    const rows = visiblePackages.map((pkg) => {
      const record = found.get(pkg);
      return `<tr><td>${packageRepoEscapeHtml(pkg)}</td><td>${record ? packageRepoEscapeHtml(record.Version || '') : 'missing'}</td><td>${record ? 'available' : 'missing'}</td></tr>`;
    }).join('');
    const problemCount = missingVisible.length + hiddenProblemCount;
    const problemDetails = [
      missingVisible.length ? `Missing top-level packages: ${missingVisible.map(packageRepoEscapeHtml).join(', ')}.` : '',
      hiddenProblemCount ? `${hiddenProblemCount} dependency issue${hiddenProblemCount === 1 ? '' : 's'} detected inside the snapshot.` : '',
    ].filter(Boolean).join(' ');
    const summary = problemCount
      ? `Snapshot check found package issues. ${problemDetails}`
      : `Snapshot contains the top-level analysis packages; ${dependencyCount} dependencies are included.`;
    packageRepoSetStatus(`
      <div class="${problemCount ? 'status-message warn' : 'status-message ok'}">${summary}</div>
      <div class="table-wrap compact"><table><thead><tr><th>Package</th><th>Version</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      `, problemCount ? 'warn' : 'ok', true);
  } catch (error) {
    packageRepoSetStatus(`Snapshot check failed: ${error.message}`, 'fail');
  }
}

async function packageRepoFallbackPackages() {
  try {
    const response = await fetch('https://repo.r-wasm.org/bin/emscripten/contrib/4.5/PACKAGES', { cache: 'force-cache' });
    if (!response.ok) return new Map();
    return new Map(packageRepoParsePackages(await response.text()).map((record) => [record.Package, record]));
  } catch (_) {
    return new Map();
  }
}

function packageRepoRequiredPackages() {
  const modules = state.config?.webr?.modules || {};
  const packages = [];
  Object.values(modules).forEach((moduleConfig) => {
    if (moduleConfig?.enabled === false) return;
    (moduleConfig?.packages || []).forEach((pkg) => {
      if (!packages.includes(pkg)) packages.push(pkg);
    });
  });
  return packages;
}

function packageRepoLoadPackages() {
  const modules = state.config?.webr?.modules || {};
  const packages = [];
  Object.values(modules).forEach((moduleConfig) => {
    if (moduleConfig?.enabled === false) return;
    const loadPackages = moduleConfig?.loadPackages || (moduleConfig?.packages || []).slice(0, 1);
    loadPackages.forEach((pkg) => {
      if (!packages.includes(pkg)) packages.push(pkg);
    });
  });
  return packages;
}

function packageRepoCanInstallOrLoad(packages) {
  if (!packages.length) return false;
  return packageSnapshotCanInstall() || arePackagesAvailable(packages);
}

function packageRepoRequiredPackagesReady() {
  const packages = packageRepoRequiredPackages();
  return packages.length > 0 && arePackagesAvailable(packages);
}

function packageRepoTopLevelPackagesReady() {
  const packages = packageRepoLoadPackages();
  return packages.length > 0 && arePackagesAvailable(packages);
}

function packageRepoPackageChip(pkg) {
  const status = getPackageStatus(pkg);
  return `<span>${packageRepoEscapeHtml(pkg)} <small>${packageRepoEscapeHtml(status)}</small></span>`;
}

function packageRepoPackageStatusTable(packages) {
  if (!packages.length) return '<p class="note">No top-level analysis packages are configured.</p>';
  const rows = packages.map((pkg) => {
    const status = getPackageStatus(pkg);
    const ready = arePackagesAvailable([pkg]) ? 'ready' : 'not ready';
    return `<tr><td>${packageRepoEscapeHtml(pkg)}</td><td>${packageRepoEscapeHtml(status)}</td><td>${ready}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Package</th><th>Status</th><th>Ready</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function packageRepoBaseUrl() {
  return packageSnapshotBaseUrl();
}

function packageRepoIndexUrl() {
  return packageSnapshotIndexUrl();
}

function packageRepoBundleUrl() {
  const configured = String(state.config?.webr?.packageArchiveUrl || '').trim();
  if (configured) return configured;
  const version = state.config?.webr?.packageRepoVersion || 'snapshot';
  return `${packageRepoBaseUrl()}rnaseq-report-webr-packages-${version}.zip`;
}

async function downloadPackageRepositoryFile(buttonId, label) {
  const button = document.getElementById(buttonId);
  const url = button?.dataset.downloadUrl || '';
  const filename = button?.dataset.downloadName || packageRepoDownloadFilename(url, `${label}.zip`);
  const buttons = ['package-download-snapshot', 'package-download-library']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  buttons.forEach((item) => { item.disabled = true; });
  packageRepoSetDownloadProgress(label, 'Starting...', null);
  setStatus(`${label}: starting download`, { busy: true });
  try {
    const result = await downloadPackageFileWithProgress({
      url,
      filename,
      label,
      onProgress: (received, total) => {
        const hasTotal = total > 0;
        const detail = hasTotal
          ? `${formatBytes(received)} of ${formatBytes(total)}`
          : `${formatBytes(received)} downloaded`;
        packageRepoSetDownloadProgress(label, detail, hasTotal ? received / total : null);
        setStatus(`${label}: ${detail}`, { busy: true, progress: hasTotal ? received / total : undefined });
      },
      onStatus: (title, detail, progress) => packageRepoSetDownloadProgress(title || label, detail, progress),
    });
    if (result.fallback) {
      packageRepoSetDownloadProgress(label, 'Download opened in your browser. Track progress in the browser downloads panel, then mount the ZIP here when it finishes.', null, 'handoff');
      setStatus(`${label}: browser download started`, { tone: 'warn' });
    } else {
      packageRepoSetDownloadProgress(label, `${result.filename} ready`, 1, 'ok');
      setStatus(`${label}: download ready`, { tone: 'ok', progress: 1 });
      logAnalysis(`${label} downloaded: ${result.filename}.`);
    }
  } catch (error) {
    packageRepoSetDownloadProgress(label, error.message, 1, 'fail');
    setStatus(`${label}: download failed`, { tone: 'fail' });
    packageRepoSetStatus(`${label} download failed: ${error.message}`, 'fail');
  } finally {
    buttons.forEach((item) => { item.disabled = !item.dataset.downloadUrl; });
  }
}

function packageRepoLibraryBundleConfig() {
  const cfg = state.config?.webr || {};
  const bundle = cfg.libraryBundle || {};
  const version = bundle.version || bundle.artifactVersion || cfg.packageRepoVersion || 'library';
  const artifactStem = bundle.artifactStem || 'rnaseq-report-webr-library';
  return {
    archiveFile: bundle.archiveFile || `${artifactStem}-${version}.zip`,
    releaseUrl: bundle.releaseUrl || '',
  };
}

function packageRepoParsePackages(text) {
  const records = [];
  let current = {};
  let currentKey = '';
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      if (current.Package) records.push(current);
      current = {};
      currentKey = '';
      return;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      current[currentKey] = match[2];
    } else if (/^\s+/.test(line) && currentKey) {
      current[currentKey] = `${current[currentKey]} ${line.trim()}`;
    }
  });
  if (current.Package) records.push(current);
  return records;
}

function packageRepoMissingDependencies(packages, found) {
  const missing = [];
  const visited = new Set();
  const queue = packages.slice();
  const basePackages = new Set([
    'R', 'base', 'compiler', 'datasets', 'grDevices', 'graphics', 'grid', 'methods',
    'parallel', 'splines', 'stats', 'stats4', 'tools', 'utils',
  ]);

  while (queue.length) {
    const pkg = queue.shift();
    if (visited.has(pkg)) continue;
    visited.add(pkg);
    const record = found.get(pkg);
    if (!record) continue;

    const deps = packageRepoDependencyNames(`${record.Depends || ''}, ${record.Imports || ''}, ${record.LinkingTo || ''}`);
    deps.forEach((dep) => {
      if (basePackages.has(dep)) return;
      if (found.has(dep)) {
        queue.push(dep);
      } else if (!missing.some((item) => item.package === dep && item.requiredBy === pkg)) {
        missing.push({ package: dep, requiredBy: pkg });
      }
    });
  }

  return missing.sort((a, b) => a.package.localeCompare(b.package));
}

function packageRepoDependencyNames(text) {
  return Array.from(new Set(text
    .split(',')
    .map((entry) => entry.trim().replace(/\s*\(.*?\)\s*/g, '').trim())
    .filter((entry) => /^[A-Za-z][A-Za-z0-9.]*$/.test(entry))));
}

function packageRepoSetStatus(message, tone = 'info', html = false) {
  const status = document.getElementById('package-repository-status');
  if (!status) return;
  status.className = `package-status ${tone}`;
  if (html) {
    status.innerHTML = message;
    enhanceTablesWithin(status, { pageLength: 10 });
  } else {
    status.textContent = message;
  }
}

function packageRepoSetDownloadProgress(title, detail, progress = null, tone = '') {
  const container = document.getElementById('package-download-progress');
  if (!container) return;
  const titleEl = document.getElementById('package-download-progress-title');
  const detailEl = document.getElementById('package-download-progress-detail');
  const fill = document.getElementById('package-download-progress-fill');
  container.hidden = false;
  container.className = `operation-progress ${tone || ''}`.trim();
  const value = Number(progress);
  const hasProgress = Number.isFinite(value);
  container.classList.toggle('is-indeterminate', !hasProgress && tone !== 'handoff');
  if (titleEl) titleEl.textContent = title || 'Download';
  if (detailEl) detailEl.textContent = detail || '';
  if (fill) fill.style.width = hasProgress ? `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%` : '';
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerUrlDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function packageRepoDownloadFilename(url, fallback) {
  try {
    const pathname = new URL(url, globalThis.location?.href).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return name || fallback;
  } catch (_) {
    return fallback;
  }
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

function packageRepoSnapshotTone(status) {
  if (status.available === true) return 'ok';
  if (packageRepoRequiredPackagesReady() || packageRepoTopLevelPackagesReady()) return 'ok';
  if (status.state === 'checking' || status.state === 'unchecked') return 'warn';
  return 'fail';
}

function packageRepoSnapshotMessage(status) {
  if (status.available === true) return 'Snapshot available. Install/load packages is enabled.';
  if (packageRepoRequiredPackagesReady()) {
    return 'Snapshot is not available, but the local package library is mounted. Top-level packages can be loaded.';
  }
  if (packageRepoTopLevelPackagesReady()) {
    return 'Snapshot is not available, but the top-level analysis packages are already loaded.';
  }
  if (status.state === 'checking') return 'Checking whether the configured webR package snapshot is available...';
  if (status.state === 'unchecked') return 'Snapshot availability will be checked automatically.';
  return `${status.message || 'Snapshot is not available.'} Install/load packages is disabled until it is available.`;
}

function packageRepoEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
