let editor = null;
let openTabs = new Map(); // path -> { model, dirty }
let activeTab = null;
let fileTree = [];

// Language mapping
function getLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', html: 'html', css: 'css', scss: 'scss', md: 'markdown',
    py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    sh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql',
    php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin', lua: 'lua',
    txt: 'plaintext', dockerfile: 'dockerfile', makefile: 'makefile'
  };
  return map[ext] || 'plaintext';
}

// File icons (simple colored dots)
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const colors = {
    js: '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
    json: '#cbcb41', html: '#e34c26', css: '#563d7c', scss: '#c6538c',
    md: '#519aba', py: '#3572A5', go: '#00ADD8', rs: '#dea584',
    java: '#b07219', c: '#555555', cpp: '#f34b7d', sh: '#89e051',
    yml: '#cb171e', yaml: '#cb171e', xml: '#e37933', sql: '#e38c00',
    php: '#4F5D95', rb: '#701516', lua: '#000080'
  };
  const color = colors[ext] || '#7f8c8d';
  return `<span style="color:${color}">●</span>`;
}

// --- Monaco Setup ---
require.config({
  paths: { vs: 'https://microsoft.github.io/monaco-editor/node_modules/monaco-editor/min/vs' }
});

require(['vs/editor/editor.main'], function () {
  monaco.editor.defineTheme('vs-dark-custom', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.selectionBackground': '#264f78',
      'editorCursor.foreground': '#aeafad'
    }
  });

  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '',
    language: 'plaintext',
    theme: 'vs-dark-custom',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    minimap: { enabled: true },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'off',
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true }
  });

  editor.onDidChangeCursorPosition(e => {
    document.getElementById('status-right').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  editor.onDidChangeModelContent(() => {
    if (activeTab) {
      const tab = openTabs.get(activeTab);
      if (tab) {
        tab.dirty = true;
        updateTabLabel(activeTab);
      }
    }
  });

  loadFileTree();
  showWelcome();
});

// --- File Tree ---
async function loadFileTree() {
  const res = await fetch('/api/files');
  fileTree = await res.json();
  renderTree(fileTree, document.getElementById('file-tree'), 0);
}

function renderTree(items, container, depth) {
  container.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'tree-item';
    row.style.paddingLeft = (depth * 12 + 4) + 'px';

    if (item.type === 'dir') {
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▶';
      row.appendChild(chevron);

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.innerHTML = '📁';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.name;
      row.appendChild(label);

      const children = document.createElement('div');
      children.className = 'tree-children collapsed';
      renderTree(item.children || [], children, depth + 1);

      row.addEventListener('click', () => {
        chevron.classList.toggle('open');
        children.classList.toggle('collapsed');
      });

      container.appendChild(row);
      container.appendChild(children);
    } else {
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      row.appendChild(chevron);

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.innerHTML = fileIcon(item.name);
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.name;
      row.appendChild(label);

      row.addEventListener('click', () => openFile(item.path, item.name));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e, item); });

      container.appendChild(row);
    }
  }
}

// --- Tabs ---
async function openFile(filePath, fileName) {
  if (openTabs.has(filePath)) {
    switchTab(filePath);
    return;
  }

  const res = await fetch('/api/file?p=' + encodeURIComponent(filePath));
  if (!res.ok) return;
  const data = await res.json();

  const lang = getLanguage(fileName);
  const model = monaco.editor.createModel(data.content || '', lang);
  openTabs.set(filePath, { model, dirty: false, name: fileName });

  renderTabs();
  switchTab(filePath);
  hideWelcome();
}

function switchTab(filePath) {
  activeTab = filePath;
  const tab = openTabs.get(filePath);
  if (tab && editor) {
    editor.setModel(tab.model);
  }
  renderTabs();
}

function closeTab(filePath) {
  const tab = openTabs.get(filePath);
  if (!tab) return;
  tab.model.dispose();
  openTabs.delete(filePath);

  if (activeTab === filePath) {
    activeTab = null;
    if (openTabs.size > 0) {
      switchTab(openTabs.keys().next().value);
    } else {
      if (editor) editor.setModel(null);
      showWelcome();
    }
  }
  renderTabs();
}

function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';
  for (const [filePath, tab] of openTabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (filePath === activeTab ? ' active' : '');
    el.innerHTML = `<span>${fileIcon(tab.name)}</span>&nbsp;<span>${tab.name}${tab.dirty ? ' ●' : ''}</span><span class="tab-close">✕</span>`;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        closeTab(filePath);
      } else {
        switchTab(filePath);
      }
    });
    container.appendChild(el);
  }
}

function updateTabLabel(filePath) {
  renderTabs();
}

// --- Save ---
async function saveCurrentFile() {
  if (!activeTab) return;
  const tab = openTabs.get(activeTab);
  if (!tab) return;
  const content = tab.model.getValue();
  await fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: activeTab, content })
  });
  tab.dirty = false;
  renderTabs();
  document.getElementById('status-left').textContent = 'Saved';
  setTimeout(() => { document.getElementById('status-left').textContent = 'Ready'; }, 2000);
}

// --- Welcome ---
function showWelcome() {
  document.getElementById('editor-container').style.display = 'none';
  document.getElementById('welcome').style.display = 'flex';
  document.getElementById('tabs').style.display = 'none';
}

function hideWelcome() {
  document.getElementById('editor-container').style.display = 'block';
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('tabs').style.display = 'flex';
}

// --- New File ---
async function createFile() {
  const name = prompt('File name:');
  if (!name) return;
  await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: name, content: '' })
  });
  await loadFileTree();
  openFile(name, name.split('/').pop());
}

// --- Context Menu ---
function showContextMenu(e, item) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const delBtn = document.createElement('div');
  delBtn.className = 'ctx-item';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    if (confirm('Delete ' + item.name + '?')) {
      await fetch('/api/file?p=' + encodeURIComponent(item.path), { method: 'DELETE' });
      if (openTabs.has(item.path)) closeTab(item.path);
      await loadFileTree();
    }
    closeContextMenu();
  });

  menu.appendChild(delBtn);
  document.body.appendChild(menu);
  document.addEventListener('click', closeContextMenu, { once: true });
}

function closeContextMenu() {
  const m = document.querySelector('.ctx-menu');
  if (m) m.remove();
}

// --- Search ---
const searchInput = document.getElementById('search-input');
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
});

async function doSearch() {
  const query = searchInput.value.trim();
  const results = document.getElementById('search-results');
  if (!query) { results.innerHTML = ''; return; }

  const allFiles = flattenTree(fileTree);
  results.innerHTML = '';
  for (const file of allFiles) {
    try {
      const res = await fetch('/api/file?p=' + encodeURIComponent(file.path));
      if (!res.ok) continue;
      const data = await res.json();
      const lines = (data.content || '').split('\n');
      const matches = [];
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push({ line: i + 1, text: line.trim().slice(0, 80) });
        }
      });
      if (matches.length > 0) {
        const fileEl = document.createElement('div');
        fileEl.className = 'search-result-file';
        fileEl.textContent = file.name;
        results.appendChild(fileEl);
        for (const m of matches) {
          const lineEl = document.createElement('div');
          lineEl.className = 'search-result-line';
          lineEl.textContent = `${m.line}: ${m.text}`;
          lineEl.addEventListener('click', () => openFile(file.path, file.name));
          results.appendChild(lineEl);
        }
      }
    } catch {}
  }
}

function flattenTree(items, result = []) {
  for (const item of items) {
    if (item.type === 'file') result.push(item);
    if (item.children) flattenTree(item.children, result);
  }
  return result;
}

// --- Activity Bar ---
document.querySelectorAll('.activity-icon').forEach(icon => {
  icon.addEventListener('click', () => {
    document.querySelectorAll('.activity-icon').forEach(i => i.classList.remove('active'));
    icon.classList.add('active');
    const view = icon.dataset.view;
    document.getElementById('file-tree').style.display = view === 'explorer' ? 'block' : 'none';
    document.getElementById('search-panel').style.display = view === 'search' ? 'flex' : 'none';
    document.getElementById('sidebar-title').textContent = view === 'search' ? 'Search' : 'Explorer';
  });
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentFile();
  }
});
