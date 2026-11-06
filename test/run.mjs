// End-to-end test: starts a mock TMDB, runs the generator, serves the dist folder
// the way GitHub Pages would (decoding %20 etc.) and runs the verifier.
// Usage: node test/run.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, copyFile, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-tmdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(os.tmpdir(), 'studio-test-'));
const OUT = path.join(work, 'dist');

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
  });
}

const mock = await startMock();
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAILED'} ${msg}`);
  if (!ok) failures++;
};

// Do not touch the project's real cache during the test.
const realCache = path.join(ROOT, 'cache', 'details.json');
const backup = path.join(work, 'details.backup.json');
await copyFile(realCache, backup);

const env = {
  TMDB_API_KEY: 'testkey',
  TMDB_BASE_URL: `http://127.0.0.1:${mock.port}/3`,
  OUT_DIR: OUT,
};

console.log('--- 1st run (empty cache) ---');
check((await run(['scripts/build.mjs'], env)) === 0, 'generator finished without errors');
const firstCalls = mock.calls.total;
check(mock.calls.rateLimited === 1, 'simulated 429 was handled with a retry');

console.log('\n--- 2nd run (should use the cache) ---');
check((await run(['scripts/build.mjs'], env)) === 0, 'second run finished without errors');
const secondCalls = mock.calls.total - firstCalls;
check(secondCalls < firstCalls / 3, `cache reduced the calls (${firstCalls} -> ${secondCalls})`);

// Static server that mimics GitHub Pages: decodes the path and allows CORS.
const pages = http.createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(OUT, rel);
    if (!file.startsWith(OUT)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': rel.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'access-control-allow-origin': '*' });
    res.end('not found');
  }
});
await new Promise((r) => pages.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${pages.address().port}`;

console.log('\n--- verification like Stremio ---');
check((await run(['scripts/verify.mjs', base], env)) === 0, 'verify.mjs passed on every catalog');

console.log('\n--- manifest checks ---');
const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
const movie = manifest.catalogs.find((c) => c.type === 'movie' && c.id === 'studio');
const series = manifest.catalogs.find((c) => c.type === 'series' && c.id === 'studio');
const movieOpts = movie.extra.find((e) => e.name === 'genre').options;
const seriesOpts = series.extra.find((e) => e.name === 'genre').options;
check(movieOpts.length === 16, `16 studios in the movie catalog (${movieOpts.length})`);
check(movieOpts.includes('20th Century Fox') && movieOpts.includes('DC Studios') && movieOpts.includes('MGM'), 'names with spaces, name search and MGM present');
check(!seriesOpts.includes('Lucasfilm') && !seriesOpts.includes('Pixar'), 'studios without series are left out of the series menu');
check(movie.extra.find((e) => e.name === 'genre').isRequired === true, 'studio filter is required (shows as a menu in Discover)');

const report = JSON.parse(await readFile(path.join(OUT, 'report.json'), 'utf8'));
const dw = report.studios.find((s) => s.name === 'DreamWorks');
check(dw.companies.length === 1 && dw.companies[0].id === 521, 'company 7 with a wrong name was rejected by "expect"');
const dc = report.studios.find((s) => s.name === 'DC Studios');
check(dc.companies.map((c) => c.id).sort((a, b) => a - b).join() === '9993,128064,187995', 'DC Studios resolved 3 companies by exact search and ignored the similar name');
const lucas = report.studios.find((s) => s.name === 'Lucasfilm');
check(lucas.movies === 300 || lucas.movies > 0, `Lucasfilm has movies (${lucas.movies})`);

const idx = await readFile(path.join(OUT, 'index.html'), 'utf8');
check(idx.includes('stremio://') && idx.includes('A24'), 'index.html has an install button and the studio list');

// Pagination and pt-BR posters.
const p1 = JSON.parse(await readFile(path.join(OUT, 'catalog/movie/studio/genre=Marvel Studios.json'), 'utf8'));
const p2 = JSON.parse(await readFile(path.join(OUT, 'catalog/movie/studio/genre=Marvel Studios&skip=100.json'), 'utf8'));
check(p1.metas.length === 100 && p2.metas.length > 0, `Marvel paginated (${p1.metas.length} + ${p2.metas.length})`);
check(p1.metas.some((m) => m.poster.includes('/pt')) && p1.metas.some((m) => m.poster.includes('/d')), 'pt poster when it exists, default poster as fallback');
check(p1.metas.every((m) => !/tt\d{7}$/.test(m.id) || Number(m.id.slice(2)) % 7 !== 0), 'titles without IMDb were discarded');
check(p1.metas[0].name.startsWith('Movie'), 'title came from the pt-BR details');

pages.close();
mock.server.close();
await copyFile(backup, realCache);
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
