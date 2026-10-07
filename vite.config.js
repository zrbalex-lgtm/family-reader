import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { inspectConfig, repositoryBase } from './src/lib/config.js';

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const problem = inspectConfig(env);
  if (command === 'build' && problem) throw new Error(problem);

  return {
    plugins: [svelte()],
    base: repositoryBase(env),
    build: {
      // Oldest supported family device: iPad on iPadOS 16 (Safari 16). Safari 15 adds a safety margin.
      target: ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'],
      cssTarget: ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'],
    },
  };
});
