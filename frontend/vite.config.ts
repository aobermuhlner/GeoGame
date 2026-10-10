import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Dev-only: serves flag-icons SVGs at /dev-flags/<code>.svg for the local bot demo.
 * Never part of the production build (real games get flags from the Worker).
 */
function devFlags(): Plugin {
  const dir = join(dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
  return {
    name: 'dev-flags',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-flags', async (req, res, next) => {
        const m = /^\/([a-z]{2})\.svg$/.exec(req.url ?? '');
        if (!m) return next();
        try {
          const svg = await readFile(join(dir, `${m[1]}.svg`));
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(svg);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

// Cloudflare Pages serves the site from the root of its domain.
export default defineConfig(() => ({
  base: '/',
  plugins: [preact(), devFlags()],
  build: {
    rollupOptions: {
      // The credits open in their own tab (linked from the footer and the photo credit lines).
      input: { main: 'index.html', credits: 'credits.html' },
    },
  },
}));
