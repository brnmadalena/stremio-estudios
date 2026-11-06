#!/usr/bin/env node
// Generates the Stremio catalog addon as static files (for GitHub Pages).
// Usage: TMDB_API_KEY=... node scripts/build.mjs
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';
const KEY = (process.env.TMDB_API_KEY || '').trim();
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, 'dist'));
const CACHE_FILE = path.join(ROOT, 'cache', 'details.json');
const DAY = 86400000;

if (!KEY) {
  console.error('Missing the TMDB_API_KEY environment variable (create the GitHub secret, see the README).');
  process.exit(1);
}
// v4 tokens are long and sent as a Bearer header; the v3 key goes in the URL.
const useBearer = KEY.length > 40;

const config = JSON.parse(await readFile(path.join(ROOT, 'studios.json'), 'utf8'));
const stats = { detailFetched: 0, detailFailed: 0, cacheHits: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Studio names become part of file names and URLs, so they are restricted.
for (const s of config.studios) {
  if (/[\/\\?#%&=:*"<>|]/.test(s.name) || s.name.endsWith('.')) {
    throw new Error(`Invalid studio name in studios.json: "${s.name}" (avoid / \\ ? # % & = : * " < > | and a trailing dot)`);
  }
}

async function tmdb(p, params = {}, attempt = 0) {
  const url = new URL(API + p);
  const all = { language: config.language, ...params };
  for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  if (!useBearer) url.searchParams.set('api_key', KEY);
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', ...(useBearer ? { authorization: `Bearer ${KEY}` } : {}) },
    });
  } catch (e) {
    if (attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return tmdb(p, params, attempt + 1);
    }
    throw new Error(`Network failure on ${p}: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
    await sleep(wait * 1000);
    return tmdb(p, params, attempt + 1);
  }
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('TMDB rejected the key (401). Check the TMDB_API_KEY secret.');
  if (!res.ok) throw new Error(`TMDB answered ${res.status} on ${p}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- details cache (IMDb id, localized title and poster) ----------
const cache = existsSync(CACHE_FILE) ? JSON.parse(await readFile(CACHE_FILE, 'utf8')) : {};
async function saveCache() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));
}

async function getDetails(type, tmdbId) {
  const kind = type === 'movie' ? 'movie' : 'tv';
  const key = `${kind}:${tmdbId}`;
  const hit = cache[key];
  // With an IMDb id: refresh every 90 days. Without one: retry after 14 days.
  if (hit && Date.now() - hit.ts < (hit.imdb ? 90 : 14) * DAY) {
    stats.cacheHits++;
    return hit;
  }
  const d = await tmdb(`/${kind}/${tmdbId}`, {
    append_to_response: 'external_ids,images',
    include_image_language: 'pt,null',
  });
  if (!d) return hit || null;
  stats.detailFetched++;
  const posters = (d.images?.posters || [])
    .filter((p) => p.iso_639_1 === 'pt')
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0));
  const date = kind === 'movie' ? d.release_date : d.first_air_date;
  const entry = {
    imdb: d.external_ids?.imdb_id || d.imdb_id || null,
    title: kind === 'movie' ? d.title : d.name,
    poster: posters[0]?.file_path || d.poster_path || null,
    pt: Boolean(posters[0]),
    year: date ? date.slice(0, 4) : null,
    ts: Date.now(),
  };
  cache[key] = entry;
  return entry;
}

// ---------- studios -> TMDB companies ----------
async function resolveCompanies(studio) {
  const found = new Map();
  const expect = new RegExp(studio.expect || '.', 'i');
  for (const id of studio.ids || []) {
    const c = await tmdb(`/company/${id}`);
    if (c && expect.test(c.name)) found.set(c.id, c.name);
    else console.warn(`  warning: company ${id} does not match "${studio.name}" (TMDB says: ${c ? c.name : 'not found'}), ignored`);
  }
  for (const term of studio.search || []) {
    const r = await tmdb('/search/company', { query: term });
    const exact = r?.results?.find((x) => x.name.toLowerCase() === term.toLowerCase());
    if (exact) found.set(exact.id, exact.name);
    else console.warn(`  warning: company search for "${term}" found no identical name`);
  }
  return [...found].map(([id, name]) => ({ id, name }));
}

// ---------- title list for one studio ----------
async function collect(type, companyIds) {
  const kind = type === 'movie' ? 'movie' : 'tv';
  const wantPages = Math.min(500, Math.ceil((config.maxItems * 1.25) / 20));
  const base = {
    with_companies: companyIds.join('|'),
    sort_by: 'popularity.desc',
    'vote_count.gte': config.minVotes,
    include_adult: 'false',
  };
  const first = await tmdb(`/discover/${kind}`, { ...base, page: 1 });
  if (!first) return [];
  const total = Math.min(first.total_pages || 1, wantPages);
  const pages = [];
  for (let p = 2; p <= total; p++) pages.push(p);
  const rest = await mapLimit(pages, config.concurrency, (p) => tmdb(`/discover/${kind}`, { ...base, page: p }));
  const seenIds = new Set();
  const candidates = [first, ...rest]
    .flatMap((r) => r?.results || [])
    .filter((r) => (seenIds.has(r.id) ? false : seenIds.add(r.id)));

  const metas = [];
  const seenImdb = new Set();
  // Fetch details in chunks and stop as soon as there are enough titles.
  for (let i = 0; i < candidates.length && metas.length < config.maxItems; i += 50) {
    const chunk = candidates.slice(i, i + 50);
    const details = await mapLimit(chunk, config.concurrency, (r) =>
      getDetails(type, r.id).catch((e) => {
        stats.detailFailed++;
        console.warn(`  warning: failed ${kind}:${r.id}: ${e.message}`);
        return null;
      }),
    );
    chunk.forEach((r, j) => {
      const d = details[j];
      if (!d || !d.imdb || !d.poster || seenImdb.has(d.imdb) || metas.length >= config.maxItems) return;
      seenImdb.add(d.imdb);
      const meta = {
        id: d.imdb,
        type,
        name: d.title || r.title || r.name,
        poster: IMG + d.poster,
        posterShape: 'poster',
      };
      if (d.year) meta.releaseInfo = d.year;
      metas.push(meta);
    });
  }
  return metas;
}

// ---------- writing files ----------
async function writeJson(rel, data) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

// Writes pages using the URL layout Stremio requests:
//   .../catalog/movie/studio/genre=Pixar.json
//   .../catalog/movie/studio/genre=Pixar&skip=100.json
//   .../catalog/movie/studio-pixar.json  and  .../catalog/movie/studio-pixar/skip=100.json
async function writePaged(type, catalogId, genre, metas) {
  const size = config.pageSize;
  const pages = Math.max(1, Math.ceil(metas.length / size));
  const skips = new Set();
  for (let p = 0; p <= pages; p++) skips.add(p * size);
  skips.add(metas.length); // Stremio asks for skip = number of items already loaded
  for (const skip of skips) {
    const slice = metas.slice(skip, skip + size);
    let rel;
    if (genre !== null) {
      const extra = `genre=${genre}`;
      rel = `catalog/${type}/${catalogId}/${skip ? `${extra}&skip=${skip}` : extra}.json`;
    } else {
      rel = skip ? `catalog/${type}/${catalogId}/skip=${skip}.json` : `catalog/${type}/${catalogId}.json`;
    }
    await writeJson(rel, { metas: slice });
  }
}

// ---------- main ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const results = [];
for (const studio of config.studios) {
  console.log(`> ${studio.name}`);
  const companies = await resolveCompanies(studio);
  const items = { movie: [], series: [] };
  if (!companies.length) {
    console.warn(`  warning: no company found for "${studio.name}", the studio will be left out`);
  } else {
    const ids = companies.map((c) => c.id);
    items.movie = await collect('movie', ids);
    items.series = await collect('series', ids);
    console.log(`  ${companies.map((c) => `${c.name} (${c.id})`).join(', ')} -> ${items.movie.length} movies, ${items.series.length} series`);
  }
  results.push({ studio, slug: slugify(studio.name), companies, items });
  await saveCache(); // keep progress even if a later step fails
}

if (!results.some((r) => r.items.movie.length || r.items.series.length)) {
  console.error('No titles were generated. Check the TMDB key and studios.json.');
  process.exit(1);
}

const catalogId = 'studio';
const catalogs = [];
for (const type of ['movie', 'series']) {
  const active = results.filter((r) => r.items[type].length);
  if (!active.length) continue;
  catalogs.push({
    type,
    id: catalogId,
    name: config.addon.catalogName,
    extra: [
      { name: 'genre', options: active.map((r) => r.studio.name), isRequired: true },
      { name: 'skip' },
    ],
  });
  for (const r of active) await writePaged(type, catalogId, r.studio.name, r.items[type]);

  for (const featured of config.featured || []) {
    const r = active.find((x) => x.studio.name === featured);
    if (!r) continue;
    const id = `studio-${r.slug}`;
    catalogs.push({ type, id, name: r.studio.name, extra: [{ name: 'skip' }] });
    await writePaged(type, id, null, r.items[type]);
  }
}

const manifest = {
  id: config.addon.id,
  version: config.addon.version,
  name: config.addon.name,
  description: config.addon.description,
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs,
  behaviorHints: { configurable: false, configurationRequired: false },
};
await writeJson('manifest.json', manifest);

const report = {
  generatedAt: new Date().toISOString(),
  stats,
  studios: results.map((r) => ({
    name: r.studio.name,
    companies: r.companies,
    movies: r.items.movie.length,
    series: r.items.series.length,
  })),
};
await writeJson('report.json', report);
await writeFile(path.join(OUT, 'index.html'), renderIndex(report));
await saveCache();

console.log(
  `\nDone: ${catalogs.length} catalogs. Details fetched: ${stats.detailFetched}, from cache: ${stats.cacheHits}, failures: ${stats.detailFailed}.`,
);

function renderIndex(rep) {
  const rows = rep.studios
    .map(
      (s) =>
        `<li><span>${esc(s.name)}</span><small>${s.movies} movies · ${s.series} series</small></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.addon.name)}</title>
<style>
  :root { color-scheme: dark; --bg:#12121a; --card:#1c1c28; --fg:#ecebf5; --mut:#9b9ab0; --acc:#7b5bf5; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:640px; margin:0 auto; padding:40px 16px; }
  h1 { margin:0 0 4px; font-size:28px; }
  p { color:var(--mut); }
  .btns { display:flex; flex-wrap:wrap; gap:10px; margin:20px 0; }
  a.btn, button { background:var(--acc); color:#fff; border:0; border-radius:10px; padding:12px 18px; font:inherit; text-decoration:none; cursor:pointer; }
  button.alt { background:var(--card); }
  code { display:block; background:var(--card); padding:10px 12px; border-radius:8px; word-break:break-all; color:var(--fg); }
  ul { list-style:none; padding:0; margin:24px 0 0; display:grid; gap:8px; }
  li { display:flex; justify-content:space-between; gap:12px; background:var(--card); padding:10px 14px; border-radius:10px; }
  small { color:var(--mut); }
  footer { margin-top:32px; font-size:13px; color:var(--mut); }
</style>
</head>
<body>
<main>
  <h1>${esc(config.addon.name)}</h1>
  <p>Movies and series organized by studio, with titles and posters in Brazilian Portuguese. In Stremio, open <b>Discover</b>, choose <b>${esc(config.addon.catalogName)}</b> and pick a studio in the filter.</p>
  <div class="btns">
    <a class="btn" id="app" href="#">Install in Stremio</a>
    <a class="btn" id="web" href="#">Install via Stremio Web</a>
    <button class="alt" id="copy">Copy addon link</button>
  </div>
  <code id="url"></code>
  <ul>
${rows}
  </ul>
  <footer>Updated on ${esc(rep.generatedAt.slice(0, 10))}. This product uses the TMDB API but is not endorsed or certified by TMDB.</footer>
</main>
<script>
  var base = location.href.split('#')[0].split('?')[0].replace(/index\\.html$/, '').replace(/\\/?$/, '/');
  var manifest = base + 'manifest.json';
  document.getElementById('url').textContent = manifest;
  document.getElementById('app').href = 'stremio://' + manifest.replace(/^https?:\\/\\//, '');
  document.getElementById('web').href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(manifest);
  document.getElementById('copy').onclick = function () {
    var b = this;
    navigator.clipboard.writeText(manifest).then(function () { b.textContent = 'Copied'; });
  };
</script>
</body>
</html>
`;
}
