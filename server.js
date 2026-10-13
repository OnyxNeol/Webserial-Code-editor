const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';
const WORKSPACE = path.join(__dirname, 'workspace');

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- File API ---

function listDir(dir, relBase = '') {
  const items = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return items; }
  // folders first, then files, both alphabetical
  const folders = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of [...folders, ...files]) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      items.push({ name: e.name, path: rel, type: 'dir', children: listDir(path.join(dir, e.name), rel) });
    } else {
      items.push({ name: e.name, path: rel, type: 'file' });
    }
  }
  return items;
}

app.get('/api/files', (req, res) => {
  res.json(listDir(WORKSPACE));
});

app.get('/api/file', (req, res) => {
  const filePath = path.join(WORKSPACE, req.query.p || '');
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

app.put('/api/file', (req, res) => {
  const filePath = path.join(WORKSPACE, req.body.path || '');
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body.content, 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/file', (req, res) => {
  const filePath = path.join(WORKSPACE, req.body.path || '');
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body.content || '', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/file', (req, res) => {
  const filePath = path.join(WORKSPACE, req.query.p || '');
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.rmSync(filePath, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(PORT, HOST, () => {
  console.log(`VS Code Web Editor running on http://${HOST}:${PORT}`);
});
