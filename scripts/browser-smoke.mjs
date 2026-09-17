import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Local-only rendered DOM verification using an isolated headless Chrome profile.
const youtubeFixture = await readFile('tests/fixtures/youtube.html', 'utf8');
const harness = await build({ stdin: { contents: `
import { scan } from './src/content/element-scanner.ts';
import { CandidateStore } from './src/content/candidate-store.ts';
import { execute } from './src/content/action-executor.ts';
const store = new CandidateStore();
const host = document.getElementById('shadow');
host.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow Play</button>';
const candidates = scan(store, 200);
const checks = [];
function check(name, ok) { checks.push({ name, ok }); }
const names = candidates.map(c => c.name);
check('visible button', names.includes('Visible Play'));
check('open shadow root', names.includes('Shadow Play'));
check('hidden and offscreen exclusion', !names.includes('Hidden') && !names.includes('Offscreen'));
check('overlay exclusion', !names.includes('Covered'));
check('private descendant exclusion', !JSON.stringify(candidates).includes('PRIVATE_SECRET'));
check('organic fixture fallback', names.includes('Top Recipes'));
let clicks = 0;
document.getElementById('play').addEventListener('click', () => clicks++);
const target = candidates.find(c => c.name === 'Visible Play');
execute(store, store.documentId, { kind: 'click', element_id: target.id, open_in_new_tab: false });
check('DOM activation dispatched', clicks === 1);
store.clear();
document.body.innerHTML = ${JSON.stringify(youtubeFixture)};
const youtubeStore = new CandidateStore();
const youtubeCandidates = scan(youtubeStore, 200);
const videos = youtubeCandidates.filter(candidate => candidate.role === 'link' && candidate.scope === 'main_content');
check('YouTube title is available in main_content', videos.some(candidate => candidate.name === 'Goofy Cats'));
check('YouTube search videos have ordered matching metadata', JSON.stringify(videos.map(candidate => [candidate.name, candidate.semantic_kind, candidate.ordinal])) === JSON.stringify([['Goofy Cats', 'search_result', 1], ['Sleepy Cats', 'search_result', 2]]));
check('YouTube thumbnail does not duplicate its title', youtubeCandidates.filter(candidate => candidate.name.includes('Goofy Cats')).length === 1);
let videoClicks = 0;
document.querySelector('#first-video #video-title').addEventListener('click', event => { event.preventDefault(); videoClicks++; });
const video = videos.find(candidate => candidate.name === 'Goofy Cats');
if (video) execute(youtubeStore, youtubeStore.documentId, { kind: 'click', element_id: video.id, open_in_new_tab: false });
check('YouTube named video activation dispatched', videoClicks === 1);
const output = document.createElement('pre'); output.id = 'smoke-result'; output.textContent = JSON.stringify(checks); document.body.append(output);
youtubeStore.clear();
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', target: 'chrome120',
  // Simulate the page URL for host-based adapter selection on a local fixture.
  // This substitution exists only in this test harness, never the extension build.
  define: { 'location.href': JSON.stringify('https://www.youtube.com/results?search_query=cat+videos') },
});
const html = `<!doctype html><meta charset="utf-8"><title>Fuzzball local browser smoke</title><style>body{font:16px sans-serif}button,a{display:inline-block;margin:10px;padding:12px}#covered{position:absolute;left:20px;top:300px;width:140px;height:60px}#overlay{position:absolute;left:0;top:280px;width:300px;height:140px;background:white;z-index:5}</style><main><button id="play">Visible Play</button><button hidden>Hidden</button><button style="position:absolute;top:3000px">Offscreen</button><a href="https://example.com/">Top Recipes<input value="PRIVATE_SECRET"><span hidden>PRIVATE_SECRET</span></a><div id="shadow"></div><button id="covered">Covered</button><div id="overlay"></div></main><script src="/harness.js"></script>`;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/harness.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/harness.js' ? harness.outputFiles[0].text : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await mkdir('.tools/browser-smoke-profile', { recursive: true });
try {
  const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const { stdout } = await promisify(execFile)(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', `--user-data-dir=${resolve('.tools/browser-smoke-profile')}`, '--window-size=1000,800', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
  const result = /<pre id="smoke-result">(.*?)<\/pre>/s.exec(stdout)?.[1];
  if (!result) throw new Error('Chrome did not return the smoke-test result.');
  const checks = JSON.parse(result.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
  if (checks.some(check => !check.ok)) process.exitCode = 1;
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  console.log(`Build manifest: ${manifest.name} ${manifest.version}`);
} finally { server.close(); }
