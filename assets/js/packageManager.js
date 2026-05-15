import { installRPackages, loadRPackage } from './webrManager.js';
import { logAnalysis } from './state.js';

const packageStatus = new Map();

export function getPackageStatus(pkg) {
  return packageStatus.get(pkg) || 'not-installed';
}

export async function ensureRPackages(packages) {
  const missing = packages.filter((pkg) => getPackageStatus(pkg) !== 'installed');
  if (missing.length === 0) return;
  missing.forEach((pkg) => packageStatus.set(pkg, 'installing'));
  try {
    await installRPackages(missing);
    for (const pkg of missing) {
      await loadPackageWithStatus(pkg);
    }
  } catch (error) {
    missing.forEach((pkg) => packageStatus.set(pkg, 'failed'));
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
