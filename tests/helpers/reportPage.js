// @ts-check
import { expect } from '@playwright/test';

const PLOTLY_CDN_PATTERN = /https:\/\/cdn\.plot\.ly\/plotly-2\.35\.2\.min\.js/;

export async function openReport(page, path = '/') {
  await stubPlotly(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForReportReady(page);
}

export async function waitForReportReady(page) {
  await page.waitForFunction(() => {
    const ready = globalThis.__RNA_SEQ_REPORT_READY__;
    return ready?.status === 'ready' || ready?.status === 'error';
  });
  const ready = await page.evaluate(() => globalThis.__RNA_SEQ_REPORT_READY__);
  expect(ready?.status, ready?.message || 'report failed to initialize').toBe('ready');
}

export async function activateTab(page, tabName) {
  await page.locator(`.tab-button[data-tab="${cssString(tabName)}"]`).click();
  await expect(page.locator(`#tab-${tabName}`)).toHaveClass(/active/);
}

async function stubPlotly(page) {
  await page.route(PLOTLY_CDN_PATTERN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (() => {
          function targetElement(target) {
            return typeof target === 'string' ? document.getElementById(target) : target;
          }
          function render(target, data, layout, config) {
            const el = targetElement(target);
            if (!el) return Promise.resolve();
            el.classList.add('js-plotly-plot');
            el.dataset.plotlyRendered = 'true';
            el.__plotlyData = data || [];
            el.__plotlyLayout = layout || {};
            el.__plotlyConfig = config || {};
            el.textContent = '';
            const marker = document.createElement('div');
            marker.setAttribute('data-plotly-stub', 'true');
            marker.textContent = layout?.title?.text || layout?.title || 'Plotly plot';
            el.appendChild(marker);
            return Promise.resolve(el);
          }
          globalThis.Plotly = {
            react: render,
            newPlot: render,
            purge(target) {
              const el = targetElement(target);
              if (!el) return;
              delete el.dataset.plotlyRendered;
              delete el.__plotlyData;
              delete el.__plotlyLayout;
              el.classList.remove('js-plotly-plot');
              el.textContent = '';
            },
            Plots: { resize() {} },
          };
        })();
      `,
    });
  });
}

function cssString(value) {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
