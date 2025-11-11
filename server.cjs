const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const resources = path.join(__dirname); // app root (works after packaging)

function mountIfExists(url, folder) {
  if (fs.existsSync(folder)) {
    app.use(url, express.static(folder));
    console.log(`Mounted ${folder} -> ${url}`);
  }
}

mountIfExists('/_next/static', path.join(resources, '.next', 'static'));
mountIfExists('/_next/static', path.join(resources, '.next', 'standalone', '.next', 'static'));
mountIfExists('/_next/static', path.join(resources, 'app', '.next', 'static'));
mountIfExists('/', path.join(resources, 'app'));
mountIfExists('/', resources);

app.get(/.*/, (req, res) => {
  const candidates = [
    path.join(resources, 'app', 'index.html'),
    path.join(resources, 'index.html')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  res.status(404).send('Not found');
});

const host = '127.0.0.1';
const port = process.env.PORT || 3000;

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
