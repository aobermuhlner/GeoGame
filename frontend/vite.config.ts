import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Build-only: writes dist/sw.js from ./sw.js with this build's file list to precache and a version derived
 * from their contents, so every deploy that changes a file installs a fresh cache.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = isAbsolute(c.build.outDir) ? c.build.outDir : resolve(c.root, c.build.outDir);
    },
    async writeBundle() {
      const files: string[] = [];
      const walk = async (dir: string) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) await walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      await walk(outDir);
      // .well-known/ (Android asset links) is read by the OS, never by the app.
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('.well-known/')).sort();
      const template = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'sw.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of precache) hash.update(f).update(await readFile(join(outDir, f)));
      const workerUrl = process.env.VITE_WORKER_URL || 'http://localhost:8787';
      const src = template
        .replace('= __VERSION__;', `= ${JSON.stringify(hash.digest('hex').slice(0, 12))};`)
        .replace('= __PRECACHE__;', `= ${JSON.stringify(precache)};`)
        .replace('= __WORKER_ORIGIN__;', `= ${JSON.stringify(new URL(workerUrl).origin)};`);
      if (/= __[A-Z_]+__;/.test(src)) throw new Error('sw.js: a build placeholder was not filled in');
      await writeFile(join(outDir, 'sw.js'), src);
    },
  };
}

// Cloudflare Pages serves the site from the root of its domain.
export default defineConfig(() => ({
  base: '/',
  plugins: [preact(), devFlags(), serviceWorker()],
  build: {
    rollupOptions: {
      // The credits open in their own tab (linked from the footer and the photo credit lines).
      input: { main: 'index.html', credits: 'credits.html' },
    },
  },
}));
