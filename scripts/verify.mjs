#!/usr/bin/env node
// Confere um addon já publicado (ou local), pedindo as URLs do mesmo jeito que o Stremio.
// Uso: node scripts/verify.mjs https://usuario.github.io/stremio-estudios
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('Uso: node scripts/verify.mjs <url-base-do-addon>');
  process.exit(1);
}

let errors = 0;
const fail = (msg) => {
  errors++;
  console.error(`  ERRO: ${msg}`);
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    fail(`${res.status} em ${url}`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    fail(`JSON inválido em ${url}`);
    return null;
  }
}

function checkMetas(metas, url) {
  if (!Array.isArray(metas)) return fail(`"metas" não é lista em ${url}`);
  for (const m of metas) {
    if (!/^tt\d+$/.test(m.id || '')) fail(`id fora do padrão IMDb (${m.id}) em ${url}`);
    if (!m.name) fail(`título vazio em ${url}`);
    if (!/^https:\/\//.test(m.poster || '')) fail(`capa sem https em ${url}`);
    if (m.type !== 'movie' && m.type !== 'series') fail(`type inválido (${m.type}) em ${url}`);
  }
}

// Simula a paginação do Stremio: skip = quantidade já carregada, até vir uma página vazia.
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
    if (pagesRead > 100) return fail(`paginação não termina em ${label}`);
  }
  console.log(`  ${label}: ${loaded} títulos em ${pagesRead - 1} página(s)`);
  if (loaded === 0) fail(`${label} está vazio`);
}

const manifest = await getJson(`${base}/manifest.json`);
if (!manifest) process.exit(1);
console.log(`${manifest.name} v${manifest.version}, ${manifest.catalogs.length} catálogos`);
for (const k of ['id', 'version', 'name', 'description', 'resources', 'types', 'catalogs']) {
  if (!manifest[k]) fail(`manifest sem "${k}"`);
}

for (const cat of manifest.catalogs) {
  console.log(`[${cat.type}] ${cat.id}`);
  const genre = cat.extra?.find((e) => e.name === 'genre');
  if (genre) {
    if (!genre.options?.length) fail(`catálogo ${cat.id}/${cat.type} sem opções de gênero`);
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

console.log(errors ? `\n${errors} problema(s) encontrado(s).` : '\nTudo certo.');
process.exit(errors ? 1 : 0);
