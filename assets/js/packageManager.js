import { installRPackages, loadRPackage } from './webrManager.js';
import { ensurePackageSnapshotAvailable } from './packageSnapshot.js';
import { createProgressReporter, logAnalysis, runWithProgressPulse } from './state.js';

const packageStatus = new Map();

export function getPackageStatus(pkg) {
  return packageStatus.get(pkg) || 'not-installed';
}

export function markPackagesAvailable(packages, status = 'mounted') {
  uniquePackageNames(packages).forEach((pkg) => packageStatus.set(pkg, status));
  notifyPackageStatusChanged();
}

export function isPackageAvailable(pkg) {
  return ['installed', 'loaded', 'mounted'].includes(getPackageStatus(pkg));
}

export function arePackagesAvailable(packages) {
  return uniquePackageNames(packages).every(isPackageAvailable);
}

export async function ensureRPackages(packages, options = {}) {
  const installTargets = uniquePackageNames(packages);
  const loadTargets = uniquePackageNames(options.load || packages);
  const missing = installTargets.filter((pkg) => !isPackageAvailable(pkg));
  const needsLoad = loadTargets.filter((pkg) => getPackageStatus(pkg) !== 'loaded');
  if (missing.length === 0 && needsLoad.length === 0) return;

  const progress = createProgressReporter('R package setup', Math.max(3, missing.length + needsLoad.length + (missing.length ? 3 : 2)));
  let step = 1;
  const preparing = missing.length ? missing : needsLoad;
  if (missing.length) {
    await progress.step('Checking webR package snapshot availability', step);
    await ensurePackageSnapshotAvailable();
    step += 1;
  }
  await progress.step(`Preparing ${preparing.join(', ')}`, step);
  step += 1;
  missing.forEach((pkg) => packageStatus.set(pkg, 'installing'));
  try {
    if (missing.length) {
      await progress.step('Initializing webR and installing missing packages', step);
      step += 1;
      await runWithProgressPulse(
        progress,
        `Installing missing package snapshot: ${missing.join(', ')}`,
        () => installRPackages(missing),
        { intervalMs: 10000 },
      );
      missing.forEach((pkg) => packageStatus.set(pkg, 'installed'));
    }
    for (const [index, pkg] of needsLoad.entries()) {
      await progress.step(`Loading ${pkg}`, step + index);
      await loadPackageWithStatus(pkg);
    }
    await progress.done(`Packages ready: ${loadTargets.join(', ')}`);
    notifyPackageStatusChanged();
  } catch (error) {
    missing.concat(needsLoad).forEach((pkg) => packageStatus.set(pkg, 'failed'));
    await progress.fail(`package setup failed: ${error.message}`);
    logAnalysis(`Package installation failed: ${error.message}`);
    notifyPackageStatusChanged();
    throw error;
  }
}

function uniquePackageNames(packages) {
  return Array.from(new Set((packages || []).map((pkg) => String(pkg || '').trim()).filter(Boolean)));
}

async function loadPackageWithStatus(pkg) {
  try {
    await loadRPackage(pkg);
    packageStatus.set(pkg, 'loaded');
  } catch (error) {
    packageStatus.set(pkg, 'failed');
    throw error;
  }
}

function notifyPackageStatusChanged() {
  document.dispatchEvent(new CustomEvent('rnaseq-report:packages-changed'));
}
