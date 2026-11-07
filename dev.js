// Local dev server that mimics Vercel's routing: node dev.js  ->  http://localhost:3000
// Uses in-memory storage, so data resets whenever you restart it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const routes = {
  '/api/webhook': require('./api/webhook'),
  '/api/noshows': require('./api/noshows'),
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[url.pathname];
  if (!handler) {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(fs.readFileSync(path.join(__dirname, 'public/index.html')));
    }
    res.statusCode = 404;
    return res.end('Not found');
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    await handler(req, res);
  });
}).listen(process.env.PORT || 3000, () => console.log('Dev server on http://localhost:' + (process.env.PORT || 3000)));
