import { state, logAnalysis } from './state.js';

let webR = null;
let initialized = false;

export async function initWebR() {
  if (initialized) return webR;
  const cfg = state.config?.webr || {};
  if (!cfg.enabled) throw new Error('webR is disabled in report_config.json.');
  const baseUrl = cfg.baseUrl || 'https://webr.r-wasm.org/latest/';
  logAnalysis(`Loading webR from ${baseUrl}`);
  const module = await import(`${baseUrl.replace(/\/$/, '')}/webr.mjs`);
  webR = new module.WebR({ baseUrl });
  await webR.init();
  initialized = true;
  await evalR(`options(repos = c(rnaseq = "${cfg.packageRepo || ''}", webr = "https://repo.r-wasm.org/"))`);
  logAnalysis('webR initialized.');
  return webR;
}

export async function evalR(code) {
  if (!webR) throw new Error('webR is not initialized.');
  const result = await webR.evalR(code);
  try { return await result.toJs(); } catch (_) { return result; }
}

export async function installRPackages(packages) {
  await initWebR();
  if (!packages || packages.length === 0) return;
  const quoted = packages.map((pkg) => `"${pkg}"`).join(', ');
  logAnalysis(`Installing R packages: ${packages.join(', ')}`);
  await evalR(`webr::install(c(${quoted}))`);
  logAnalysis(`Installed R packages: ${packages.join(', ')}`);
}

export async function loadRPackage(packageName) {
  await initWebR();
  logAnalysis(`Loading R package: ${packageName}`);
  await evalR(`library(${JSON.stringify(packageName)}, character.only = TRUE)`);
}

export async function runSmallSummary() {
  await initWebR();
  const out = await evalR('capture.output(sessionInfo())');
  logAnalysis(Array.isArray(out?.values) ? out.values.join('\n') : 'sessionInfo() complete.');
}
