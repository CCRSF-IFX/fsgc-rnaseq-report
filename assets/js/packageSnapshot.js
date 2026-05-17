import { state, logAnalysis } from './state.js';

let snapshotCheckPromise = null;

export function getPackageSnapshotStatus() {
  if (!state.packageSnapshot) {
    state.packageSnapshot = {
      state: 'unchecked',
      available: null,
      message: 'Snapshot availability has not been checked yet.',
      checkedAt: '',
      indexUrl: packageSnapshotIndexUrl(),
    };
  }
  return state.packageSnapshot;
}

export function packageSnapshotBaseUrl() {
  const raw = String(state.config?.webr?.packageRepo || '').trim();
  return raw ? raw.replace(/\/?$/, '/') : '';
}

export function packageSnapshotIndexUrl() {
  const baseUrl = packageSnapshotBaseUrl();
  return baseUrl ? `${baseUrl}bin/emscripten/contrib/4.5/PACKAGES` : '';
}

export function packageSnapshotCanInstall() {
  return state.config?.webr?.enabled !== false && getPackageSnapshotStatus().available === true;
}

export async function ensurePackageSnapshotAvailable() {
  const cfg = state.config?.webr || {};
  if (cfg.enabled === false) throw new Error('webR is disabled in report_config.json.');

  const status = getPackageSnapshotStatus();
  if (status.available === true) return status;
  if (status.state === 'unavailable') {
    throw new Error(`${status.message} Recheck the snapshot or mount a local webR library bundle.`);
  }

  const checked = await checkPackageSnapshot();
  if (checked.available !== true) {
    throw new Error(`${checked.message} Install/load packages is disabled until the snapshot is available or a local webR library bundle is mounted.`);
  }
  return checked;
}

export async function checkPackageSnapshot(options = {}) {
  const force = Boolean(options.force);
  const status = getPackageSnapshotStatus();
  const indexUrl = packageSnapshotIndexUrl();

  if (state.config?.webr?.enabled === false) {
    updatePackageSnapshotStatus({
      state: 'unavailable',
      available: false,
      message: 'webR is disabled in report_config.json.',
      checkedAt: new Date().toISOString(),
      indexUrl,
    });
    return status;
  }

  if (!indexUrl) {
    updatePackageSnapshotStatus({
      state: 'unavailable',
      available: false,
      message: 'No webR package repository URL is configured.',
      checkedAt: new Date().toISOString(),
      indexUrl,
    });
    return status;
  }

  if (snapshotCheckPromise && !force) return snapshotCheckPromise;
  if (status.available === true && !force) return status;

  updatePackageSnapshotStatus({
    state: 'checking',
    available: null,
    message: `Checking ${indexUrl}`,
    checkedAt: '',
    indexUrl,
  });

  snapshotCheckPromise = (async () => {
    try {
      const response = await fetch(indexUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      if (!/^Package:\s*\S+/m.test(text)) throw new Error('PACKAGES index is empty or invalid');
      updatePackageSnapshotStatus({
        state: 'available',
        available: true,
        message: `Snapshot is available at ${indexUrl}`,
        checkedAt: new Date().toISOString(),
        indexUrl,
      });
      logAnalysis(`webR package snapshot available: ${indexUrl}`);
    } catch (error) {
      updatePackageSnapshotStatus({
        state: 'unavailable',
        available: false,
        message: `Snapshot unavailable at ${indexUrl}: ${error.message}`,
        checkedAt: new Date().toISOString(),
        indexUrl,
      });
      logAnalysis(`webR package snapshot unavailable: ${error.message}`);
    } finally {
      snapshotCheckPromise = null;
    }
    return getPackageSnapshotStatus();
  })();

  return snapshotCheckPromise;
}

function updatePackageSnapshotStatus(next) {
  Object.assign(getPackageSnapshotStatus(), next);
  notifyPackageSnapshotChanged();
}

function notifyPackageSnapshotChanged() {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('rnaseq-report:package-snapshot-changed'));
}
