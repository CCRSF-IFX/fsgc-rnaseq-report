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
    const fallbackFound = await packageRepoFallbackPackages();
    const dependencyIndex = new Map([...fallbackFound, ...found]);
    const missing = packages.filter((pkg) => !found.has(pkg));
    const missingDeps = packageRepoMissingDependencies(packages, dependencyIndex);
    const rows = packages.map((pkg) => {
      const record = found.get(pkg);
      return `<tr><td>${packageRepoEscapeHtml(pkg)}</td><td>${record ? packageRepoEscapeHtml(record.Version || '') : 'missing'}</td><td>${record ? 'available' : 'missing'}</td></tr>`;
    }).join('');
    const depRows = missingDeps.map((dep) => (
      `<tr><td>${packageRepoEscapeHtml(dep.package)}</td><td>${packageRepoEscapeHtml(dep.requiredBy)}</td><td>missing dependency</td></tr>`
    )).join('');
    const depTable = depRows
      ? `<div class="table-wrap compact"><table><thead><tr><th>Dependency</th><th>Required by</th><th>Status</th></tr></thead><tbody>${depRows}</tbody></table></div>`
      : '';
    const problemCount = missing.length + missingDeps.length;
    packageRepoSetStatus(`
      <div class="${problemCount ? 'status-message warn' : 'status-message ok'}">${problemCount ? 'Snapshot is missing configured packages or hard dependencies.' : 'Snapshot contains configured packages and their indexed hard dependencies.'}</div>
      <div class="table-wrap compact"><table><thead><tr><th>Package</th><th>Version</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${depTable}`, problemCount ? 'warn' : 'ok', true);
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
  if (html) status.innerHTML = message;
  else status.textContent = message;
}

function packageRepoEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
