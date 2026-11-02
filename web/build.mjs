// Builds the React app into web/dist. `node web/build.mjs --watch` rebuilds on change.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const writeHtml = {
  name: 'html',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const outputs = Object.keys(result.metafile.outputs).map((f) => '/' + path.relative(out, f).split(path.sep).join('/'));
      const js = outputs.find((f) => f.endsWith('.js'));
      const css = outputs.find((f) => f.endsWith('.css'));
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="${css}">` : '')
        .replace('<!--JS-->', `<script type="module" src="${js}"></script>`);
      fs.writeFileSync(path.join(out, 'index.html'), html);
      fs.copyFileSync(path.join(root, 'favicon.svg'), path.join(out, 'favicon.svg'));
      console.log(`built ${js}${css ? ` + ${css}` : ''}`);
    });
  },
};

fs.rmSync(out, { recursive: true, force: true });
const ctx = await esbuild.context({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  outdir: path.join(out, 'assets'),
  entryNames: 'app-[hash]',
  format: 'esm',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  metafile: true,
  logLevel: 'warning',
  plugins: [writeHtml],
});
if (watch) { await ctx.watch(); console.log('watching web/src …'); }
else { await ctx.rebuild(); await ctx.dispose(); }
