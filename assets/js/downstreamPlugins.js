import { state, logAnalysis } from './state.js';
import { ensureRPackages } from './packageManager.js';
import { renderPCA } from './plots.js';

export function pluginDefinitions() {
  const modules = state.config?.webr?.modules || {};
  const plugins = [
    {
      id: 'pca_replot',
      name: 'PCA replot',
      description: 'Re-render PCA using current metadata coloring. No package installation required.',
      packages: [],
      memory: 'low',
      run: async () => { renderPCA(document.getElementById('pca-color')?.value || 'condition'); logAnalysis('PCA replot complete.'); },
    },
  ];

  if (modules.deseq2?.enabled !== false) {
    plugins.push({
      id: 'deseq2_experimental',
      name: 'DESeq2 experimental module',
      description: 'Optional DESeq2 browser-side module. This is expected to be heavy and may be unavailable depending on wasm package builds.',
      packages: modules.deseq2?.packages || ['DESeq2'],
      memory: modules.deseq2?.memoryWarning || 'high',
      experimental: true,
      run: async () => { logAnalysis('DESeq2 module loaded. Run a contrast from the Differential Expression tab.'); },
    });
  }

  if (modules.fgsea?.enabled !== false) {
    plugins.push({
      id: 'fgsea_experimental',
      name: 'fgsea experimental module',
      description: 'Run preranked GSEA from the current DE contrast using hg38 or mm10 GMT pathway sets.',
      packages: modules.fgsea?.packages || ['fgsea'],
      memory: modules.fgsea?.memoryWarning || 'medium',
      experimental: true,
      run: async () => { logAnalysis('fgsea module loaded. Run fgsea from the Enrichment tab.'); },
    });
  }

  return plugins;
}

export function renderDownstreamCards() {
  const container = document.getElementById('downstream-cards');
  if (!container) return;
  const cards = pluginDefinitions().map((plugin) => `
    <article class="card plugin-card" data-plugin-id="${plugin.id}">
      <h4>${plugin.name}${plugin.experimental ? ' <span class="badge warn">EXPERIMENTAL</span>' : ''}</h4>
      <p>${plugin.description}</p>
      <p><strong>Packages:</strong> ${plugin.packages.length ? plugin.packages.map((p) => `<code>${p}</code>`).join(' ') : 'none'}</p>
      <p><strong>Memory:</strong> ${plugin.memory}</p>
      <div><button data-action="install" ${plugin.packages.length ? '' : 'disabled'}>Install/load packages</button> <button data-action="run">Run</button></div>
    </article>`).join('');
  container.innerHTML = cards;
  container.querySelectorAll('[data-plugin-id]').forEach((card) => {
    const plugin = pluginDefinitions().find((p) => p.id === card.dataset.pluginId);
    card.querySelector('[data-action="install"]')?.addEventListener('click', async () => {
      try { await ensureRPackages(plugin.packages); logAnalysis(`${plugin.name} packages ready.`); }
      catch (error) { logAnalysis(`${plugin.name} package step failed: ${error.message}`); }
    });
    card.querySelector('[data-action="run"]')?.addEventListener('click', async () => {
      try {
        if (plugin.packages.length) await ensureRPackages(plugin.packages);
        await plugin.run();
      } catch (error) { logAnalysis(`${plugin.name} failed: ${error.message}`); }
    });
  });
}
