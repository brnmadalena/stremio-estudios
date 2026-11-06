// Teste de ponta a ponta: sobe um TMDB simulado, roda o gerador, serve a pasta dist
// do jeito que o GitHub Pages faria (decodificando %20 etc.) e roda o verificador.
// Uso: node test/run.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, copyFile, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-tmdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(os.tmpdir(), 'estudios-test-'));
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
  console.log(`${ok ? 'OK  ' : 'FALHOU'} ${msg}`);
  if (!ok) failures++;
};

// Não mexe no cache real do projeto durante o teste.
const realCache = path.join(ROOT, 'cache', 'details.json');
const backup = path.join(work, 'details.backup.json');
await copyFile(realCache, backup);

const env = {
  TMDB_API_KEY: 'testkey',
  TMDB_BASE_URL: `http://127.0.0.1:${mock.port}/3`,
  OUT_DIR: OUT,
};

console.log('--- 1a execução (cache vazio) ---');
check((await run(['scripts/build.mjs'], env)) === 0, 'gerador terminou sem erro');
const firstCalls = mock.calls.total;
check(mock.calls.rateLimited === 1, 'o 429 simulado foi tratado com nova tentativa');

console.log('\n--- 2a execução (deve usar o cache) ---');
check((await run(['scripts/build.mjs'], env)) === 0, 'segunda execução terminou sem erro');
const secondCalls = mock.calls.total - firstCalls;
check(secondCalls < firstCalls / 3, `cache reduziu as chamadas (${firstCalls} -> ${secondCalls})`);

// Servidor estático que imita o GitHub Pages: decodifica o caminho e libera CORS.
const pages = http.createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(OUT, rel);
    if (!file.startsWith(OUT)) throw new Error('fora');
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

console.log('\n--- verificação como o Stremio ---');
check((await run(['scripts/verify.mjs', base], env)) === 0, 'verify.mjs passou em todos os catálogos');

console.log('\n--- conferências do manifest ---');
const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
const movie = manifest.catalogs.find((c) => c.type === 'movie' && c.id === 'estudios');
const series = manifest.catalogs.find((c) => c.type === 'series' && c.id === 'estudios');
const movieOpts = movie.extra.find((e) => e.name === 'genre').options;
const seriesOpts = series.extra.find((e) => e.name === 'genre').options;
check(movieOpts.length === 16, `16 estúdios no catálogo de filmes (${movieOpts.length})`);
check(movieOpts.includes('20th Century Fox') && movieOpts.includes('DC Studios') && movieOpts.includes('MGM'), 'nomes com espaço, busca por nome e MGM presentes');
check(!seriesOpts.includes('Lucasfilm') && !seriesOpts.includes('Pixar'), 'estúdios sem séries ficam fora do menu de séries');
check(movie.extra.find((e) => e.name === 'genre').isRequired === true, 'filtro de estúdio é obrigatório (aparece como menu no Descobrir)');

const report = JSON.parse(await readFile(path.join(OUT, 'report.json'), 'utf8'));
const dw = report.studios.find((s) => s.name === 'DreamWorks');
check(dw.companies.length === 1 && dw.companies[0].id === 521, 'empresa 7 com nome errado foi recusada pelo "expect"');
const dc = report.studios.find((s) => s.name === 'DC Studios');
check(dc.companies.map((c) => c.id).sort((a, b) => a - b).join() === '9993,128064,187995', 'DC Studios resolveu 3 empresas por busca exata e ignorou o nome parecido');
const lucas = report.studios.find((s) => s.name === 'Lucasfilm');
check(lucas.movies === 300 || lucas.movies > 0, `Lucasfilm tem filmes (${lucas.movies})`);

const idx = await readFile(path.join(OUT, 'index.html'), 'utf8');
check(idx.includes('stremio://') && idx.includes('A24'), 'index.html tem botão de instalação e lista de estúdios');

// Paginação e posters em pt-BR.
const p1 = JSON.parse(await readFile(path.join(OUT, 'catalog/movie/estudios/genre=Marvel Studios.json'), 'utf8'));
const p2 = JSON.parse(await readFile(path.join(OUT, 'catalog/movie/estudios/genre=Marvel Studios&skip=100.json'), 'utf8'));
check(p1.metas.length === 100 && p2.metas.length > 0, `Marvel paginado (${p1.metas.length} + ${p2.metas.length})`);
check(p1.metas.some((m) => m.poster.includes('/pt')) && p1.metas.some((m) => m.poster.includes('/d')), 'capa em pt quando existe, capa padrão como alternativa');
check(p1.metas.every((m) => !/tt\d{7}$/.test(m.id) || Number(m.id.slice(2)) % 7 !== 0), 'títulos sem IMDb foram descartados');
check(p1.metas[0].name.startsWith('Filme'), 'título veio do detalhe em pt-BR');

pages.close();
mock.server.close();
await copyFile(backup, realCache);
console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTodas as verificações passaram.');
process.exit(failures ? 1 : 0);
