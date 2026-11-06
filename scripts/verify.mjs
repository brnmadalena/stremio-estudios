#!/usr/bin/env node
// Checks a published (or local) addon by requesting URLs the same way Stremio does.
// Usage: node scripts/verify.mjs https://YOUR_USERNAME.github.io/REPOSITORY_NAME
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('Usage: node scripts/verify.mjs <addon-base-url>');
  process.exit(1);
}

let errors = 0;
const fail = (msg) => {
  errors++;
  console.error(`  ERROR: ${msg}`);
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    fail(`${res.status} at ${url}`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    fail(`Invalid JSON at ${url}`);
    return null;
  }
}

function checkMetas(metas, url) {
  if (!Array.isArray(metas)) return fail(`"metas" is not a list at ${url}`);
  for (const m of metas) {
    if (!/^tt\d+$/.test(m.id || '')) fail(`id is not an IMDb id (${m.id}) at ${url}`);
    if (!m.name) fail(`empty title at ${url}`);
    if (!/^https:\/\//.test(m.poster || '')) fail(`poster without https at ${url}`);
    if (m.type !== 'movie' && m.type !== 'series') fail(`invalid type (${m.type}) at ${url}`);
  }
}

// Simulates Stremio pagination: skip = number of items already loaded, until an empty page.
async function walk(urlFor, label) {
  let loaded = 0;
  let pagesRead = 0;
  for (;;) {
    const url = urlFor(loaded);
    const data = await getJson(url);
    if (!data) return;
    checkMetas(data.metas, url);
    pagesRead++;
    if (!data.metas.length) break;
    loaded += data.metas.length;
    if (pagesRead > 100) return fail(`pagination never ends in ${label}`);
  }
  console.log(`  ${label}: ${loaded} titles in ${pagesRead - 1} page(s)`);
  if (loaded === 0) fail(`${label} is empty`);
}

const manifest = await getJson(`${base}/manifest.json`);
if (!manifest) process.exit(1);
console.log(`${manifest.name} v${manifest.version}, ${manifest.catalogs.length} catalogs`);
for (const k of ['id', 'version', 'name', 'description', 'resources', 'types', 'catalogs']) {
  if (!manifest[k]) fail(`manifest is missing "${k}"`);
}

for (const cat of manifest.catalogs) {
  console.log(`[${cat.type}] ${cat.id}`);
  const genre = cat.extra?.find((e) => e.name === 'genre');
  if (genre) {
    if (!genre.options?.length) fail(`catalog ${cat.id}/${cat.type} has no genre options`);
    for (const option of genre.options || []) {
      const enc = encodeURIComponent(option);
      await walk(
        (skip) =>
          `${base}/catalog/${cat.type}/${cat.id}/genre=${enc}${skip ? `&skip=${skip}` : ''}.json`,
        option,
      );
    }
  } else {
    await walk(
      (skip) =>
        skip
          ? `${base}/catalog/${cat.type}/${cat.id}/skip=${skip}.json`
          : `${base}/catalog/${cat.type}/${cat.id}.json`,
      cat.name,
    );
  }
}

console.log(errors ? `\n${errors} problem(s) found.` : '\nAll good.');
process.exit(errors ? 1 : 0);
