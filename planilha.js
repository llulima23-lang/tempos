// planilha.js
// Load and visualize ABRIL.xlsx with multiple sheets
// Sheets: TEMPO LOGADO, PAUSAS, INAT, QUARTIL, ABS
// Utilizes xlsx library (included in HTML) and modern UI (glassmorphism)

// Utility functions
function timeStringToSec(str) {
  // Accepts HH:MM or HH:MM:SS
  if (!str) return 0;
  const parts = str.split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 2) parts.push(0);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function secToTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function percentStringToNum(str) {
  if (!str) return 0;
  return parseFloat(str.replace('%', '').trim()) / 100;
}
function numToPercent(num) {
  return (num * 100).toFixed(1) + "%";
}

// Global state
let workbook = null;
let sheetsData = {};
let currentSheet = null;
let viewMode = 'cards'; // or 'list'

// DOM references
// Automatic loading of ABRIL.xlsx from server
const tabList = document.getElementById('tab-list');
const sheetTabsSection = document.getElementById('sheet-tabs');
const sheetControls = document.getElementById('sheet-controls');
const dataView = document.getElementById('data-view');
const cardsContainer = document.getElementById('cards-container');
const tableContainer = document.getElementById('table-container');
const tableHead = document.getElementById('table-head');
const tableBody = document.getElementById('table-body');
const toggleViewBtn = document.getElementById('toggle-view');
const kpiSection = document.getElementById('kpi-overview');
const kpiLoggedAvg = document.getElementById('kpi-logged-avg');
const kpiPausaAvg = document.getElementById('kpi-pausa-avg');
const kpiInatAvg = document.getElementById('kpi-inat-avg');
const filterMes = document.getElementById('filter-mes');
const filterDia = document.getElementById('filter-dia');

// Event listeners
toggleViewBtn.addEventListener('click', toggleView);
filterMes.addEventListener('change', renderCurrentSheet);
filterDia.addEventListener('change', renderCurrentSheet);

// Load workbook data from server endpoint
fetch('/data')
  .then(res => res.json())
  .then(json => {
    // json.sheets is an object {sheetName: rowsArray}
    workbook = { SheetNames: Object.keys(json.sheets), Sheets: {} };
    // Convert each sheet's rows back to a sheet object for XLSX utils
    Object.entries(json.sheets).forEach(([name, rows]) => {
      workbook.Sheets[name] = XLSX.utils.json_to_sheet(rows);
    });
    initTabs();
  })
  .catch(err => console.error('Failed to load Excel data:', err));

function initTabs() {
  // Clear previous UI
  tabList.innerHTML = '';
  sheetTabsSection.style.display = 'block';
  sheetsData = {};

  workbook.SheetNames.forEach(name => {
    const ws = workbook.Sheets[name];
    const json = XLSX.utils.sheet_to_json(ws, {defval: ''}); // keep empty cells as ''
    sheetsData[name] = json;
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.dataset.sheet = name;
    btn.addEventListener('click', () => selectSheet(name, btn));
    tabList.appendChild(btn);
  });
  // Auto select first sheet
  if (workbook.SheetNames.length) selectSheet(workbook.SheetNames[0], tabList.firstChild);
}

function selectSheet(name, btn) {
  // Highlight active tab
  Array.from(tabList.children).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  currentSheet = name;
  // Show or hide controls based on sheet
  if (['TEMPO LOGADO', 'PAUSAS', 'INAT'].includes(name)) {
    sheetControls.style.display = 'block';
    populateFilters(name);
  } else {
    sheetControls.style.display = 'none';
  }
  // Reset view mode to cards
  viewMode = 'cards';
  toggleViewBtn.textContent = 'Ver como Lista';
  renderCurrentSheet();
}

function populateFilters(sheetName) {
  const data = sheetsData[sheetName];
  if (!data || data.length === 0) return;
  // Assume first column is "Operador" and remaining columns are dates (dd/mm/yyyy or yyyy-mm-dd)
  const sample = data[0];
  const columns = Object.keys(sample);
  const dateCols = columns.filter(c => c !== 'Operador');
  // Fill month filter
  const months = new Set();
  const days = new Set();
  dateCols.forEach(col => {
    const date = new Date(col);
    if (!isNaN(date)) {
      months.add(date.getMonth() + 1); // 1‑12
      days.add(date.getDate());
    }
  });
  // Populate month select
  filterMes.innerHTML = '<option value="">Todos</option>' +
    Array.from(months).sort((a, b) => a - b).map(m => `<option value="${m}">${m}</option>`).join('');
  // Populate day select
  filterDia.innerHTML = '<option value="">Todos</option>' +
    Array.from(days).sort((a, b) => a - b).map(d => `<option value="${d}">${d}</option>`).join('');
}

function toggleView() {
  viewMode = viewMode === 'cards' ? 'list' : 'cards';
  toggleViewBtn.textContent = viewMode === 'cards' ? 'Ver como Lista' : 'Ver como Cards';
  renderCurrentSheet();
}

function renderCurrentSheet() {
  if (!currentSheet) return;
  const data = sheetsData[currentSheet];
  if (!data) return;

  // Apply month/day filters if applicable
  let filtered = data;
  if (['TEMPO LOGADO', 'PAUSAS', 'INAT'].includes(currentSheet)) {
    const month = filterMes.value;
    const day = filterDia.value;
    filtered = data.map(row => {
      const newRow = {Operador: row['Operador']};
      Object.entries(row).forEach(([col, val]) => {
        if (col === 'Operador') return;
        const date = new Date(col);
        if (isNaN(date)) return; // skip non‑date columns
        if ((month && (date.getMonth() + 1).toString() !== month) ||
            (day && date.getDate().toString() !== day)) return;
        newRow[col] = val;
      });
      return newRow;
    }).filter(r => Object.keys(r).length > 1);
  }

  // Show KPI overview only for specific sheets
  if (['TEMPO LOGADO', 'PAUSAS', 'INAT'].includes(currentSheet)) {
    kpiSection.style.display = 'grid';
    computeKPIs(currentSheet, filtered);
  } else {
    kpiSection.style.display = 'none';
  }

  dataView.style.display = 'block';
  if (viewMode === 'cards') {
    renderCards(filtered);
    cardsContainer.style.display = 'grid';
    tableContainer.style.display = 'none';
  } else {
    renderTable(filtered);
    cardsContainer.style.display = 'none';
    tableContainer.style.display = 'block';
  }
}

function computeKPIs(sheet, rows) {
  // Reference target values
  const targetLoggedSec = 6 * 3600 + 20 * 60; // 06:20:00
  const targetPausa = 0.12; // 12%
  const targetInat = 0.10; // 10%

  if (sheet === 'TEMPO LOGADO') {
    let totalSec = 0, cnt = 0;
    rows.forEach(r => {
      Object.entries(r).forEach(([col, val]) => {
        if (col === 'Operador') return;
        const sec = timeStringToSec(val);
        if (sec) { totalSec += sec; cnt++; }
      });
    });
    const avgSec = cnt ? totalSec / cnt : 0;
    kpiLoggedAvg.textContent = secToTime(Math.round(avgSec));
    // Reset others
    kpiPausaAvg.textContent = '--';
    kpiInatAvg.textContent = '--';
  } else if (sheet === 'PAUSAS') {
    let sum = 0, cnt = 0;
    rows.forEach(r => {
      Object.entries(r).forEach(([col, val]) => {
        if (col === 'Operador') return;
        const num = percentStringToNum(val);
        if (!isNaN(num)) { sum += num; cnt++; }
      });
    });
    const avg = cnt ? sum / cnt : 0;
    kpiPausaAvg.textContent = numToPercent(avg);
    kpiLoggedAvg.textContent = '--';
    kpiInatAvg.textContent = '--';
  } else if (sheet === 'INAT') {
    let sum = 0, cnt = 0;
    rows.forEach(r => {
      Object.entries(r).forEach(([col, val]) => {
        if (col === 'Operador') return;
        const num = percentStringToNum(val);
        if (!isNaN(num)) { sum += num; cnt++; }
      });
    });
    const avg = cnt ? sum / cnt : 0;
    kpiInatAvg.textContent = numToPercent(avg);
    kpiLoggedAvg.textContent = '--';
    kpiPausaAvg.textContent = '--';
  }
}

function renderCards(rows) {
  cardsContainer.innerHTML = '';
  rows.forEach(row => {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h4');
    title.textContent = row['Operador'] || 'Operador';
    card.appendChild(title);
    const list = document.createElement('ul');
    Object.entries(row).forEach(([col, val]) => {
      if (col === 'Operador') return;
      const li = document.createElement('li');
      li.textContent = `${col}: ${val}`;
      list.appendChild(li);
    });
    card.appendChild(list);
    cardsContainer.appendChild(card);
  });
}

function renderTable(rows) {
  // Build header based on first row keys
  const headerCols = rows.length ? Object.keys(rows[0]) : [];
  tableHead.innerHTML = '';
  headerCols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    tableHead.appendChild(th);
  });
  // Build body
  tableBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    headerCols.forEach(col => {
      const td = document.createElement('td');
      td.textContent = row[col] ?? '';
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });
}

// Ranking for QUARTIL sheet – create separate view when that sheet is active
function renderQuartilRanking() {
  const rows = sheetsData['QUARTIL'] || [];
  // Expect columns: Operador, Quartil (numeric or Q1, Q2...)
  const sorted = rows.slice().sort((a, b) => {
    const qa = a['Quartil'];
    const qb = b['Quartil'];
    // Try numeric extraction
    const na = parseInt(qa?.replace(/\D/g, ''), 10);
    const nb = parseInt(qb?.replace(/\D/g, ''), 10);
    return na - nb;
  });
  // Render as table in data view (list mode)
  viewMode = 'list';
  toggleViewBtn.textContent = 'Ver como Cards';
  // Build header
  const header = ['Posição', 'Operador', 'Quartil'];
  tableHead.innerHTML = '';
  header.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    tableHead.appendChild(th);
  });
  // Body
  tableBody.innerHTML = '';
  sorted.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const posTd = document.createElement('td');
    posTd.textContent = idx + 1;
    const opTd = document.createElement('td');
    opTd.textContent = row['Operador'] || '';
    const quartTd = document.createElement('td');
    quartTd.textContent = row['Quartil'] || '';
    tr.appendChild(posTd);
    tr.appendChild(opTd);
    tr.appendChild(quartTd);
    tableBody.appendChild(tr);
  });
  cardsContainer.style.display = 'none';
  tableContainer.style.display = 'block';
}

// When QUARTIL tab selected, render ranking automatically
function selectSheet(name, btn) {
  // previous code … (same as before) – duplicated for brevity, but we'll call the original logic
  Array.from(tabList.children).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentSheet = name;
  if (['TEMPO LOGADO', 'PAUSAS', 'INAT'].includes(name)) {
    sheetControls.style.display = 'block';
    populateFilters(name);
    viewMode = 'cards';
    toggleViewBtn.textContent = 'Ver como Lista';
    renderCurrentSheet();
  } else if (name === 'QUARTIL') {
    sheetControls.style.display = 'none';
    renderQuartilRanking();
  } else {
    // For ABS or others – simple table view
    sheetControls.style.display = 'none';
    viewMode = 'list';
    toggleViewBtn.textContent = 'Ver como Cards';
    renderCurrentSheet();
  }
}

// Consolidated operator cards view (across sheets)
// When user clicks a special tab "Consolidação", we could add it later.

// Initial UI state
sheetTabsSection.style.display = 'none';
sheetControls.style.display = 'none';
dataView.style.display = 'none';

// The HTML already includes the toggle button etc.; this script will activate everything after file load.
