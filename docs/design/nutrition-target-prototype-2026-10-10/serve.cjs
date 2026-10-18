'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const htmlPath = path.join(__dirname, 'prototype.html');
http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (!['/', '/prototype.html'].includes(urlPath) || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(htmlPath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}).listen(8768, '127.0.0.1', () => console.log('FoodLink nutrition prototype: http://127.0.0.1:8768/'));
