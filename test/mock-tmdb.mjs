// Servidor TMDB simulado, só para testar o gerador sem gastar a API de verdade.
import http from 'node:http';

const COMPANIES = {
  420: 'Marvel Studios',
  2: 'Walt Disney Pictures',
  6125: 'Walt Disney Animation Studios',
  3: 'Pixar',
  174: 'Warner Bros. Pictures',
  33: 'Universal Pictures',
  4: 'Paramount Pictures',
  25: '20th Century Fox',
  127928: '20th Century Studios',
  41077: 'A24',
  3172: 'Blumhouse Productions',
  6704: 'Illumination',
  521: 'DreamWorks Animation',
  7: 'Alguma Outra Empresa', // de propósito: deve ser recusada pelo "expect"
  1632: 'Lionsgate',
  21: 'Metro-Goldwyn-Mayer',
  12: 'New Line Cinema',
  1: 'Lucasfilm Ltd.',
  8411: 'Metro-Goldwyn-Mayer',
  9993: 'DC Entertainment',
  128064: 'DC Films',
  187995: 'DC Studios',
};
const SEARCH = {
  'DC Studios': [{ id: 187995, name: 'DC Studios' }, { id: 5, name: 'DC Studios Fake' }],
  'DC Films': [{ id: 128064, name: 'DC Films' }],
  'DC Entertainment': [{ id: 9993, name: 'DC Entertainment' }],
  'Metro-Goldwyn-Mayer': [{ id: 8411, name: 'Metro-Goldwyn-Mayer' }],
};

export function startMock(port = 0) {
  const calls = { total: 0, rateLimited: 0, byPath: {} };
  let sent429 = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    calls.total++;
    calls.byPath[p.split('/').slice(1, 3).join('/')] = (calls.byPath[p.split('/').slice(1, 3).join('/')] || 0) + 1;
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.searchParams.get('api_key') !== 'testkey') return json(401, { status_message: 'Invalid API key' });
    if (url.searchParams.get('language') !== 'pt-BR' && !p.includes('/search/')) {
      // o gerador sempre deve pedir pt-BR
      return json(400, { status_message: 'language esperado: pt-BR' });
    }

    let m;
    if ((m = p.match(/^\/3\/company\/(\d+)$/))) {
      if (m[1] === '420' && !sent429) {
        sent429 = true;
        calls.rateLimited++;
        return json(429, { status_message: 'rate limit' }, { 'retry-after': '1' });
      }
      const name = COMPANIES[m[1]];
      return name ? json(200, { id: Number(m[1]), name }) : json(404, {});
    }
    if (p === '/3/search/company') {
      const q = url.searchParams.get('query');
      return json(200, { results: SEARCH[q] || [] });
    }
    if ((m = p.match(/^\/3\/discover\/(movie|tv)$/))) {
      const kind = m[1];
      const ids = (url.searchParams.get('with_companies') || '').split('|').map(Number);
      // Lucasfilm (1) e Pixar (3) não têm séries; os demais têm 25 por empresa. Filmes: 130 por empresa.
      const per = kind === 'movie' ? 130 : 25;
      const usable = kind === 'tv' ? ids.filter((i) => i !== 1 && i !== 3) : ids;
      const total = per * usable.length;
      const page = Number(url.searchParams.get('page') || 1);
      const results = [];
      for (let i = (page - 1) * 20; i < Math.min(total, page * 20); i++) {
        const id = usable[i % usable.length] * 1000 + i + (kind === 'tv' ? 500000 : 0);
        results.push({ id, title: `x${id}`, name: `x${id}`, poster_path: `/d${id}.jpg` });
      }
      return json(200, { page, results, total_pages: Math.ceil(total / 20), total_results: total });
    }
    if ((m = p.match(/^\/3\/(movie|tv)\/(\d+)$/))) {
      const kind = m[1];
      const id = Number(m[2]);
      const noImdb = id % 7 === 0;
      const imdb = noImdb ? null : `tt${String(id).padStart(7, '0')}`;
      const posters = [{ iso_639_1: 'en', file_path: `/en${id}.jpg`, vote_average: 9, vote_count: 5 }];
      if (id % 2 === 0) posters.push({ iso_639_1: 'pt', file_path: `/pt${id}.jpg`, vote_average: 5, vote_count: 2 });
      const body = {
        id,
        poster_path: `/d${id}.jpg`,
        images: { posters },
        external_ids: { imdb_id: imdb },
      };
      if (kind === 'movie') Object.assign(body, { title: `Filme ${id}`, release_date: '2020-05-01', imdb_id: imdb });
      else Object.assign(body, { name: `Série ${id}`, first_air_date: '2019-01-01' });
      return json(200, body);
    }
    return json(404, { status_message: 'não existe no mock' });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
  });
}
