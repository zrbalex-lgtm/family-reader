import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { inspectConfig, repositoryBase } from './src/lib/config.js';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Builds dist/sw.js from src/sw/service-worker.js with the list of all built and public files,
// so the whole app (including lazily loaded chunks) is available offline after one visit.
function serviceWorker() {
  return {
    name: 'family-reader-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((name) => !name.endsWith('.map') && name !== 'index.html');
      const publicFiles = readdirSync('public').filter((name) => !name.startsWith('.'));
      const files = [...new Set([...built, ...publicFiles])].sort();
      const html = bundle['index.html']?.source || '';
      const version = createHash('sha256').update(files.join('|') + html).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw/service-worker.js', 'utf8')
        .replaceAll('__PRECACHE__', JSON.stringify(files))
        .replaceAll('__VERSION__', version);
      if (source.includes('__PRECACHE__') || source.includes('__VERSION__')) throw new Error('Service worker placeholders were not replaced.');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const problem = inspectConfig(env);
  if (command === 'build' && problem) throw new Error(problem);

  return {
    plugins: [svelte(), serviceWorker()],
    base: repositoryBase(env),
    build: {
      // Oldest supported family device: iPad on iPadOS 16 (Safari 16). Safari 15 adds a safety margin.
      target: ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'],
      cssTarget: ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'],
    },
  };
});
