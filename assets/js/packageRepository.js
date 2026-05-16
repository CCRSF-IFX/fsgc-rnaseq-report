import { state, logAnalysis } from './state.js';
import { ensureRPackages, getPackageStatus } from './packageManager.js';

export function renderPackageRepositoryPanel() {
  const container = document.getElementById('package-repository-panel');
  if (!container) return;

  const cfg = state.config?.webr || {};
  const packages = packageRepoRequiredPackages();
  const repoUrl = packageRepoBaseUrl();
  const indexUrl = packageRepoIndexUrl();
  const bundleUrl = packageRepoBundleUrl();
  const disabled = cfg.enabled ? '' : 'disabled';

  container.innerHTML = `
    <section class="package-panel">
      <div>
        <h4>webR package snapshot</h4>
        <p class="note">${packageRepoEscapeHtml(cfg.packageRepoVersion || 'unversioned')} · ${packageRepoEscapeHtml(repoUrl || 'not configured')}</p>
      </div>
      <div class="package-actions">
        <button class="secondary" id="package-check" ${disabled}>Check snapshot</button>
        <button id="package-install" ${disabled || (packages.length ? '' : 'disabled')}>Install/load packages</button>
        <a class="button secondary" href="${packageRepoEscapeHtml(bundleUrl)}" download>Download snapshot ZIP</a>
      </div>
      <div class="package-chips">${packages.map((pkg) => `<span>${packageRepoEscapeHtml(pkg)} <small>${packageRepoEscapeHtml(getPackageStatus(pkg))}</small></span>`).join('')}</div>
      <div class="package-links">
        <a href="${packageRepoEscapeHtml(indexUrl)}" target="_blank" rel="noopener">PACKAGES index</a>
        <a href="${packageRepoEscapeHtml(repoUrl)}" target="_blank" rel="noopener">Package repository</a>
      </div>
      <div id="package-repository-status" class="package-status"></div>
    </section>`;

  document.getElementById('package-check')?.addEventListener('click', checkPackageRepository);
  document.getElementById('package-install')?.addEventListener('click', async () => {
    try {
      packageRepoSetStatus('Installing packages in webR...', 'info');
      await ensureRPackages(packages);
      logAnalysis(`webR packages ready: ${packages.join(', ')}`);
      renderPackageRepositoryPanel();
      packageRepoSetStatus('Packages installed and loaded.', 'ok');
    } catch (error) {
      packageRepoSetStatus(`Package install failed: ${error.message}`, 'fail');
    }
  });
}

export async function checkPackageRepository() {
  try {
    const packages = packageRepoRequiredPackages();
    const response = await fetch(packageRepoIndexUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const records = packageRepoParsePackages(await response.text());
    const found = new Map(records.map((record) => [record.Package, record]));
    const missing = packages.filter((pkg) => !found.has(pkg));
    const rows = packages.map((pkg) => {
      const record = found.get(pkg);
      return `<tr><td>${packageRepoEscapeHtml(pkg)}</td><td>${record ? packageRepoEscapeHtml(record.Version || '') : 'missing'}</td><td>${record ? 'available' : 'missing'}</td></tr>`;
    }).join('');
    packageRepoSetStatus(`
      <div class="${missing.length ? 'status-message warn' : 'status-message ok'}">${missing.length ? `Missing: ${packageRepoEscapeHtml(missing.join(', '))}` : 'Snapshot contains all configured packages.'}</div>
      <div class="table-wrap compact"><table><thead><tr><th>Package</th><th>Version</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`, missing.length ? 'warn' : 'ok', true);
  } catch (error) {
    packageRepoSetStatus(`Snapshot check failed: ${error.message}`, 'fail');
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

function packageRepoBaseUrl() {
  const raw = String(state.config?.webr?.packageRepo || '').trim();
  return raw ? raw.replace(/\/?$/, '/') : '';
}

function packageRepoIndexUrl() {
  return `${packageRepoBaseUrl()}bin/emscripten/contrib/4.5/PACKAGES`;
}

function packageRepoBundleUrl() {
  const version = state.config?.webr?.packageRepoVersion || 'snapshot';
  return `${packageRepoBaseUrl()}webr-packages-${version}.zip`;
}

function packageRepoParsePackages(text) {
  const records = [];
  let current = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      if (current.Package) records.push(current);
      current = {};
      return;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) current[match[1]] = match[2];
  });
  if (current.Package) records.push(current);
  return records;
}

function packageRepoSetStatus(message, tone = 'info', html = false) {
  const status = document.getElementById('package-repository-status');
  if (!status) return;
  status.className = `package-status ${tone}`;
  if (html) status.innerHTML = message;
  else status.textContent = message;
}

function packageRepoEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
