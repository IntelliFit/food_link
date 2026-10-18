// Optional local-only preview. The HTML also works directly from disk.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const routes = new Map([
  ['/', ['prototype.html', 'text/html; charset=utf-8']],
  ['/prototype.html', ['prototype.html', 'text/html; charset=utf-8']],
  ['/concept.png', ['concept.png', 'image/png']],
]);
http.createServer((req, res) => {
  const route = routes.get((req.url || '/').split('?')[0]);
  if (!route || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(path.join(__dirname, route[0])).pipe(res);
}).listen(8767, '127.0.0.1', () => console.log('FoodLink prototype: http://127.0.0.1:8767'));
