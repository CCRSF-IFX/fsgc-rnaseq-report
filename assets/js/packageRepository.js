import { state, logAnalysis } from './state.js';
import { ensureRPackages, getPackageStatus, markPackagesAvailable } from './packageManager.js';
import { mountRLibraryBundle } from './webrManager.js';
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
  const libraryBundle = packageRepoLibraryBundleConfig();
  const snapshotVersion = cfg.packageRepoVersion || 'the configured package snapshot';
  const disabled = cfg.enabled ? '' : 'disabled';

  container.innerHTML = `
    <section class="package-panel">
      <div>
        <h4>webR package snapshot</h4>
        <p class="note">${packageRepoEscapeHtml(cfg.packageRepoVersion || 'unversioned')} · ${packageRepoEscapeHtml(repoUrl || 'not configured')}</p>
        <p class="note">Showing top-level packages only; ${dependencyCount} dependencies are included in the snapshot.</p>
      </div>
      <div class="package-actions">
        <button class="secondary" id="package-check" ${disabled}>Check snapshot</button>
        <button id="package-install" ${disabled || (packages.length ? '' : 'disabled')}>Install/load packages</button>
        <a class="button secondary" href="${packageRepoEscapeHtml(bundleUrl)}" download>Download snapshot ZIP</a>
      </div>
      <div class="package-local-bundle">
        <div>
          <strong>Local webR library bundle</strong>
          <p class="note">Load ${packageRepoEscapeHtml(libraryBundle.archiveFile)} to mount a prebuilt package library for ${packageRepoEscapeHtml(snapshotVersion)} without reinstalling every dependency.</p>
        </div>
        <div class="package-actions">
          <label class="file-button secondary">Choose bundle <input id="package-library-bundle-file" type="file" accept=".zip,.data,.gz,.metadata,.json" multiple ${disabled} /></label>
          <button class="secondary" id="package-library-bundle-load" ${disabled}>Mount bundle</button>
          ${libraryBundle.releaseUrl ? `<a class="button secondary" href="${packageRepoEscapeHtml(libraryBundle.releaseUrl)}" target="_blank" rel="noopener">Release bundle</a>` : ''}
        </div>
      </div>
      <div class="package-chips">${visiblePackages.map((pkg) => `<span>${packageRepoEscapeHtml(pkg)} <small>${packageRepoEscapeHtml(getPackageStatus(pkg))}</small></span>`).join('')}</div>
      <div class="package-links">
        <a href="${packageRepoEscapeHtml(indexUrl)}" target="_blank" rel="noopener">PACKAGES index</a>
        <a href="${packageRepoEscapeHtml(repoUrl)}" target="_blank" rel="noopener">Package repository</a>
      </div>
      <div id="package-repository-status" class="package-status"></div>
    </section>`;

  document.getElementById('package-check')?.addEventListener('click', checkPackageRepository);
  document.getElementById('package-library-bundle-load')?.addEventListener('click', async () => {
    const files = document.getElementById('package-library-bundle-file')?.files;
    try {
      packageRepoSetStatus('Mounting local webR library bundle...', 'info');
      await mountRLibraryBundle(files, packages);
      markPackagesAvailable(packages, 'mounted');
      logAnalysis('webR library bundle mounted; package downloads are not needed for this session.');
      renderPackageRepositoryPanel();
      packageRepoSetStatus('Local webR library bundle mounted; top-level analysis packages are ready to load.', 'ok');
    } catch (error) {
      packageRepoSetStatus(`Library bundle mount failed: ${error.message}`, 'fail');
      logAnalysis(`webR library bundle mount failed: ${error.message}`);
    }
  });
  document.getElementById('package-install')?.addEventListener('click', async () => {
    try {
      packageRepoSetStatus('Installing packages in webR...', 'info');
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

export async function checkPackageRepository() {
  try {
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

function packageRepoBaseUrl() {
  const raw = String(state.config?.webr?.packageRepo || '').trim();
  return raw ? raw.replace(/\/?$/, '/') : '';
}

function packageRepoIndexUrl() {
  return `${packageRepoBaseUrl()}bin/emscripten/contrib/4.5/PACKAGES`;
}

function packageRepoBundleUrl() {
  const configured = String(state.config?.webr?.packageArchiveUrl || '').trim();
  if (configured) return configured;
  const version = state.config?.webr?.packageRepoVersion || 'snapshot';
  return `${packageRepoBaseUrl()}rnaseq-report-webr-packages-${version}.zip`;
}

function packageRepoLibraryBundleConfig() {
  const cfg = state.config?.webr || {};
  const bundle = cfg.libraryBundle || {};
  const version = bundle.artifactVersion || bundle.version || cfg.packageRepoVersion || 'library';
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

function packageRepoEscapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
