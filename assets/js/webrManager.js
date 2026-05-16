import { state, logAnalysis } from './state.js';

let webR = null;
let initialized = false;
const DEFAULT_WEBR_PACKAGE_REPO = 'https://repo.r-wasm.org/';

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
  const repos = packageRepoEntries();
  await evalR(`options(webr_pkg_repos = ${rNamedVector(repos)}, repos = ${rNamedVector(repos)})`);
  logAnalysis(`webR package repositories: ${repos.map((repo) => repo.url).join(', ')}`);
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
  const packageVector = rCharacterVector(packages);
  const reposVector = rNamedVector(packageRepoEntries());
  logAnalysis(`Installing R packages: ${packages.join(', ')}`);
  await evalR(`webr::install(${packageVector}, repos = ${reposVector})`);
  await evalR(`
    requested <- ${packageVector}
    missing <- requested[!vapply(requested, function(pkg) length(find.package(pkg, quiet = TRUE)) > 0, logical(1))]
    if (length(missing)) {
      stop("webR install finished but package(s) were not available: ", paste(missing, collapse = ", "))
    }
  `);
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

function packageRepoEntries() {
  const cfg = state.config?.webr || {};
  const repos = [];
  const configured = String(cfg.packageRepo || '').trim();
  if (configured) repos.push({ name: 'rnaseq', url: configured.replace(/\/?$/, '/') });
  repos.push({ name: 'webr', url: DEFAULT_WEBR_PACKAGE_REPO });
  return repos;
}

function rNamedVector(entries) {
  if (!entries.length) return 'character()';
  return `c(${entries.map((entry) => `${entry.name} = ${rString(entry.url)}`).join(', ')})`;
}

function rCharacterVector(values) {
  const uniqueValues = Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
  if (!uniqueValues.length) return 'character()';
  return `c(${uniqueValues.map(rString).join(', ')})`;
}

function rString(value) {
  return JSON.stringify(String(value));
}
