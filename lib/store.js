// Storage: Redis over REST (Upstash / Vercel KV) in production, in-memory for local dev + tests.
// Events live in one Redis hash. HSETNX makes "store" and "dedupe" a single atomic step.
const HASH = 'noshow:events';

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cfg, command) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Redis error: ${body.error || res.status}`);
  return body.result;
}

function createMemoryStore() {
  const map = new Map();
  return {
    kind: 'memory',
    async insertIfNew(key, record) {
      if (map.has(key)) return false;
      map.set(key, JSON.stringify(record));
      return true;
    },
    async get(key) {
      const v = map.get(key);
      return v ? JSON.parse(v) : null;
    },
    async update(key, record) { map.set(key, JSON.stringify(record)); },
    async all() { return [...map.values()].map((v) => JSON.parse(v)); },
  };
}

function createRedisStore(cfg) {
  return {
    kind: 'redis',
    async insertIfNew(key, record) {
      return (await redis(cfg, ['HSETNX', HASH, key, JSON.stringify(record)])) === 1;
    },
    async get(key) {
      const v = await redis(cfg, ['HGET', HASH, key]);
      return v ? JSON.parse(v) : null;
    },
    async update(key, record) { await redis(cfg, ['HSET', HASH, key, JSON.stringify(record)]); },
    async all() {
      const flat = (await redis(cfg, ['HGETALL', HASH])) || [];
      const out = [];
      for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]));
      return out;
    },
  };
}

let singleton = null;
function getStore() {
  if (singleton) return singleton;
  const cfg = redisConfig();
  if (cfg) singleton = createRedisStore(cfg);
  else if (process.env.VERCEL) {
    // In-memory on serverless silently loses data between invocations, so fail loudly instead.
    throw new Error('Storage not configured: connect a Redis/KV store to this Vercel project');
  } else singleton = createMemoryStore();
  return singleton;
}

function setStore(s) { singleton = s; } // tests

module.exports = { getStore, setStore, createMemoryStore };
