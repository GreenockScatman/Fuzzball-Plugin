import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/popup', { recursive: true });
await build({ entryPoints: ['src/background/service-worker.ts', 'src/popup/popup.ts'], outbase: 'src', outdir: 'dist', bundle: true, format: 'esm', target: 'chrome120', minify: true });
await build({ entryPoints: ['src/content/content-script.ts'], outfile: 'dist/content/content-script.js', bundle: true, format: 'iife', target: 'chrome120', minify: true });
for (const [source, target] of [['manifest.json', 'manifest.json'], ['src/popup/popup.html', 'popup/popup.html'], ['src/popup/popup.css', 'popup/popup.css']]) {
  await copyFile(source, `dist/${target}`);
}
console.log('Built unpacked extension in dist/');
