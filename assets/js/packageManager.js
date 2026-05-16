import { installRPackages, loadRPackage } from './webrManager.js';
import { createProgressReporter, logAnalysis, runWithProgressPulse } from './state.js';

const packageStatus = new Map();

export function getPackageStatus(pkg) {
  return packageStatus.get(pkg) || 'not-installed';
}

export async function ensureRPackages(packages) {
  const missing = packages.filter((pkg) => getPackageStatus(pkg) !== 'installed');
  if (missing.length === 0) return;
  const progress = createProgressReporter('R package setup', Math.max(3, missing.length + 2));
  await progress.step(`Preparing ${missing.join(', ')}`, 1);
  missing.forEach((pkg) => packageStatus.set(pkg, 'installing'));
  try {
    await progress.step('Initializing webR and installing missing packages', 2);
    await runWithProgressPulse(
      progress,
      `Installing missing package snapshot: ${missing.join(', ')}`,
      () => installRPackages(missing),
      { intervalMs: 10000 },
    );
    for (const [index, pkg] of missing.entries()) {
      await progress.step(`Loading ${pkg}`, index + 3);
      await loadPackageWithStatus(pkg);
    }
    await progress.done(`Packages ready: ${missing.join(', ')}`);
  } catch (error) {
    missing.forEach((pkg) => packageStatus.set(pkg, 'failed'));
    await progress.fail(`package setup failed: ${error.message}`);
    logAnalysis(`Package installation failed: ${error.message}`);
    throw error;
  }
}

async function loadPackageWithStatus(pkg) {
  try {
    await loadRPackage(pkg);
    packageStatus.set(pkg, 'installed');
  } catch (error) {
    packageStatus.set(pkg, 'failed');
    throw error;
  }
}
