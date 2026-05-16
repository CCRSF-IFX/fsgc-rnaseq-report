import { installRPackages, loadRPackage } from './webrManager.js';
import { createProgressReporter, logAnalysis, runWithProgressPulse } from './state.js';

const packageStatus = new Map();

export function getPackageStatus(pkg) {
  return packageStatus.get(pkg) || 'not-installed';
}

export async function ensureRPackages(packages, options = {}) {
  const installTargets = uniquePackageNames(packages);
  const loadTargets = uniquePackageNames(options.load || packages);
  const missing = installTargets.filter((pkg) => !isPackageAvailable(pkg));
  const needsLoad = loadTargets.filter((pkg) => getPackageStatus(pkg) !== 'loaded');
  if (missing.length === 0 && needsLoad.length === 0) return;

  const progress = createProgressReporter('R package setup', Math.max(3, missing.length + needsLoad.length + 2));
  const preparing = missing.length ? missing : needsLoad;
  await progress.step(`Preparing ${preparing.join(', ')}`, 1);
  missing.forEach((pkg) => packageStatus.set(pkg, 'installing'));
  try {
    if (missing.length) {
      await progress.step('Initializing webR and installing missing packages', 2);
      await runWithProgressPulse(
        progress,
        `Installing missing package snapshot: ${missing.join(', ')}`,
        () => installRPackages(missing),
        { intervalMs: 10000 },
      );
      missing.forEach((pkg) => packageStatus.set(pkg, 'installed'));
    }
    for (const [index, pkg] of needsLoad.entries()) {
      await progress.step(`Loading ${pkg}`, missing.length + index + 3);
      await loadPackageWithStatus(pkg);
    }
    await progress.done(`Packages ready: ${loadTargets.join(', ')}`);
  } catch (error) {
    missing.concat(needsLoad).forEach((pkg) => packageStatus.set(pkg, 'failed'));
    await progress.fail(`package setup failed: ${error.message}`);
    logAnalysis(`Package installation failed: ${error.message}`);
    throw error;
  }
}

function uniquePackageNames(packages) {
  return Array.from(new Set((packages || []).map((pkg) => String(pkg || '').trim()).filter(Boolean)));
}

function isPackageAvailable(pkg) {
  return ['installed', 'loaded'].includes(getPackageStatus(pkg));
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
