import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.aitmpl.com',
  output: 'server',
  adapter: cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }),
  integrations: [react()],
  vite: {
    plugins: [
      tailwindcss(),
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      target: 'webworker',
      external: ['node:fs', 'node:path', 'node:url', 'node:stream'],
    },
  },
});
