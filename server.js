const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const cors = require('cors');
const manifest = require('./manifest.json');

const PORT = Number(process.env.PORT || 3100);
const API_URL = 'https://embedtv.lat/api/channels';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const CHANNEL_CACHE_MS = 5 * 60 * 1000;
const STREAM_CACHE_MS = 30 * 1000;
const PROXY_SECRET = process.env.PROXY_SECRET
  ? Buffer.from(process.env.PROXY_SECRET, 'utf8')
  : crypto.randomBytes(32);

if (!process.env.PROXY_SECRET) {
  console.warn('[config] PROXY_SECRET não definido; usando um segredo temporário para esta execução.');
}

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '32kb' }));

const CATALOGS = [
  { id: 'embedtv-live', name: 'Todos os canais', filter: () => true },
  { id: 'embedtv-globo', name: 'Globo', filter: channel => /globo/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-band', name: 'Band', filter: channel => /(^|[^a-z])band/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-premiere', name: 'Premiere', filter: channel => /premiere/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-telecine', name: 'Telecine', filter: channel => /telecine/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-hbo', name: 'HBO', filter: channel => /(^|[^a-z])hbo/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-espn', name: 'ESPN', filter: channel => /espn/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-sportv', name: 'SporTV', filter: channel => /sportv/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-cazetv', name: 'CazéTV', filter: channel => /caze(?:tv)?/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-discovery', name: 'Discovery', filter: channel => /discovery/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-disney', name: 'Disney', filter: channel => /disney/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-record', name: 'Record', filter: channel => /record/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-sbt', name: 'SBT', filter: channel => /(^|[^a-z])sbt/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-esportes', name: 'Esportes', genre: 'Esportes' },
  { id: 'embedtv-24h', name: '24 Horas', filter: channel => /^24h(?:_|\s)/i.test(`${channel.id} ${channel.name}`) },
  { id: 'embedtv-abertos', name: 'Canais abertos', genre: 'Abertos' },
  { id: 'embedtv-noticias', name: 'Notícias', genre: 'Noticias' },
  { id: 'embedtv-infantil', name: 'Infantil', genre: 'Infantil' },
  { id: 'embedtv-filmes-series', name: 'Filmes e Séries', genre: 'Filmes e Séries' },
  { id: 'embedtv-documentarios', name: 'Documentários', genre: 'Documentarios' },
  { id: 'embedtv-variedades', name: 'Variedades', genre: 'Variedades' },
  { id: 'embedtv-portugal', name: 'Portugal', genre: 'Portugal' }
];

let channelCache = { expiresAt: 0, value: null };
const streamCache = new Map();

function requestBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        Accept: '*/*',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getChannels() {
  if (channelCache.value && Date.now() < channelCache.expiresAt) {
    return channelCache.value;
  }

  const response = await fetchWithTimeout(API_URL, {
    headers: { Accept: 'application/json,text/plain,*/*' }
  });
  if (!response.ok) throw new Error(`Catálogo remoto respondeu HTTP ${response.status}`);

  const data = JSON.parse(await response.text());
  if (!Array.isArray(data.channels) || !Array.isArray(data.categories)) {
    throw new Error('Formato inesperado no catálogo remoto');
  }

  const categories = new Map(data.categories.map(category => [category.id, category.name]));
  const channels = data.channels
    .filter(channel => channel && channel.id && channel.name && channel.url)
    .map(channel => ({
      ...channel,
      genres: (channel.categories || [])
        .filter(id => id !== 0 && categories.has(id))
        .map(id => categories.get(id))
    }));

  channelCache = {
    expiresAt: Date.now() + CHANNEL_CACHE_MS,
    value: { channels, categories }
  };
  return channelCache.value;
}

function publicId(channelId) {
  return `embedtv:${channelId}`;
}

function rawChannelId(id) {
  const clean = String(id || '').replace(/\.json$/, '');
  return clean.startsWith('embedtv:') ? clean.slice('embedtv:'.length) : clean;
}

function toMeta(channel) {
  return {
    id: publicId(channel.id),
    type: 'tv',
    name: channel.name,
    poster: channel.image,
    background: channel.preview || channel.image,
    logo: channel.image,
    genres: channel.genres,
    description: `Transmissão ao vivo: ${channel.name}`
  };
}

function extractStreamUrl(html) {
  const patterns = [
    /var\s+src\s*=\s*["']([^"']+)["']/i,
    /startPlayer\(\s*["']([^"']+)["']\s*\)/i,
    /source\s*:\s*["']([^"']+)["']/i,
    /file\s*:\s*["']([^"']+)["']/i,
    /src\s*:\s*["']([^"']+)["']/i,
    /["'](https?:\/\/[^"']+(?:\.m3u8|\/file\.txt)(?:\?[^"']*)?)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return match[1].replace(/\\\//g, '/');
  }
  return null;
}

async function resolveChannel(channel) {
  const cached = streamCache.get(channel.id);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const embedResponse = await fetchWithTimeout(channel.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://embedtv.lat/'
    }
  });
  if (!embedResponse.ok) throw new Error(`Embed respondeu HTTP ${embedResponse.status}`);

  const html = await embedResponse.text();
  const url = extractStreamUrl(html);
  if (!url) throw new Error('O embed não apresentou uma URL de stream utilizável');

  const value = {
    url,
    headers: {
      Referer: channel.url,
      Origin: new URL(channel.url).origin
    }
  };
  streamCache.set(channel.id, { expiresAt: Date.now() + STREAM_CACHE_MS, value });
  return value;
}

function encodeProxyPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', PROXY_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeProxyPayload(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw new Error('Token incompleto');
  const expected = crypto.createHmac('sha256', PROXY_SECRET).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Assinatura inválida');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.url || !payload.exp || Date.now() > payload.exp) throw new Error('Token expirado');
  return payload;
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return true;
}

async function assertPublicHttps(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Somente HTTP/HTTPS é permitido');
  if (url.username || url.password) throw new Error('Credenciais na URL não são permitidas');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Destino de rede não permitido');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new Error('Destino de rede não permitido');
  return url;
}

function proxyUrl(req, targetUrl, headers, isPlaylist = true) {
  const token = encodeProxyPayload({
    url: targetUrl,
    headers,
    exp: Date.now() + 4 * 60 * 60 * 1000
  });
  const suffix = isPlaylist ? '/stream.m3u8' : '/segment.ts';
  return `${requestBase(req)}/proxy/${token}${suffix}`;
}

function looksLikePlaylist(buffer, contentType) {
  const prefix = buffer.subarray(0, 64).toString('utf8').trimStart();
  return prefix.startsWith('#EXTM3U') || /mpegurl/i.test(contentType || '');
}

function looksLikeTransportStream(buffer) {
  if (buffer.length < 189 || buffer[0] !== 0x47) return false;
  return buffer[188] === 0x47 || (buffer.length > 376 && buffer[376] === 0x47);
}

function rewritePlaylist(req, text, sourceUrl, headers) {
  return text.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (!trimmed.startsWith('#')) {
      const isSubPlaylist = trimmed.includes('.m3u8') || trimmed.includes('/file.txt');
      return proxyUrl(req, new URL(trimmed, sourceUrl).href, headers, isSubPlaylist);
    }

    return line.replace(/URI=("([^"]+)"|'([^']+)')/g, (whole, quoted, doubleUri, singleUri) => {
      const uri = doubleUri || singleUri;
      const quote = quoted[0];
      const isSub = uri.includes('.m3u8') || uri.includes('/file.txt');
      return `URI=${quote}${proxyUrl(req, new URL(uri, sourceUrl).href, headers, isSub)}${quote}`;
    });
  }).join('\n');
}

app.get('/manifest.json', (req, res) => res.json(manifest));

app.get(['/catalog/tv/:catalogId.json', '/catalog/tv/:catalogId/:extra.json'], async (req, res) => {
  try {
    const { channels } = await getChannels();
    const catalog = CATALOGS.find(item => item.id === req.params.catalogId);
    if (!catalog) return res.status(404).json({ metas: [] });

    const extra = new URLSearchParams(req.params.extra || '');
    const search = String(req.query.search || extra.get('search') || '').trim().toLowerCase();

    const filtered = channels.filter(channel => {
      const matchesCatalog = catalog.filter
        ? catalog.filter(channel)
        : channel.genres.some(item => item.toLowerCase() === catalog.genre.toLowerCase());
      const matchesSearch = !search || channel.name.toLowerCase().includes(search);
      return matchesCatalog && matchesSearch;
    });
    res.json({ metas: filtered.map(toMeta) });
  } catch (error) {
    console.error('[catalog]', error.message);
    res.status(502).json({ metas: [], error: error.message });
  }
});

app.get('/meta/tv/:id.json', async (req, res) => {
  try {
    const { channels } = await getChannels();
    const channel = channels.find(item => item.id === rawChannelId(req.params.id));
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' });
    res.json({ meta: toMeta(channel) });
  } catch (error) {
    console.error('[meta]', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get('/stream/tv/:id.json', async (req, res) => {
  try {
    const { channels } = await getChannels();
    const channel = channels.find(item => item.id === rawChannelId(req.params.id));
    if (!channel) return res.status(404).json({ streams: [] });
    const resolved = await resolveChannel(channel);
    res.json({
      streams: [
        {
          name: 'EmbedTV [HLS Proxy]',
          title: `▶ ${channel.name} (HLS Stream)`,
          url: proxyUrl(req, resolved.url, resolved.headers, true),
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: {
              request: resolved.headers
            }
          }
        },
        {
          name: 'EmbedTV [Direto]',
          title: `⚡ ${channel.name} (Stream Direto)`,
          url: resolved.url,
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: {
              request: resolved.headers
            }
          }
        },
        {
          name: 'EmbedTV Web',
          title: `🌐 ${channel.name} — Abrir player original`,
          externalUrl: channel.url
        }
      ]
    });
  } catch (error) {
    console.error('[stream]', error.message);
    res.status(502).json({ streams: [], error: error.message });
  }
});

app.get(['/proxy/:token', '/proxy/:token/:file'], async (req, res) => {
  try {
    const payload = decodeProxyPayload(req.params.token);
    const target = await assertPublicHttps(payload.url);
    const upstream = await fetchWithTimeout(target.href, { headers: payload.headers || {} });
    if (!upstream.ok) return res.status(upstream.status).send('Falha no conteúdo remoto');

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (looksLikePlaylist(buffer, contentType)) {
      const body = buffer.toString('utf8');
      res.type('application/vnd.apple.mpegurl');
      return res.send(rewritePlaylist(req, body, target.href, payload.headers || {}));
    }

    res.type(looksLikeTransportStream(buffer) ? 'video/MP2T' : (contentType.includes('text/html') ? 'video/MP2T' : contentType));
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.send(buffer);
  } catch (error) {
    console.error('[proxy]', error.message);
    res.status(400).send('URL de mídia inválida ou expirada');
  }
});

app.get('/health', async (req, res) => {
  try {
    const { channels, categories } = await getChannels();
    res.json({ ok: true, channels: channels.length, categories: categories.size });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint não encontrado' }));

app.listen(PORT, () => {
  console.log(`EmbedTV Live disponível em http://localhost:${PORT}`);
  console.log(`Instale no Nuvio: http://localhost:${PORT}/manifest.json`);
});
