/* ===== BH Control - Banco de Horas - App Logic ===== */

// ===== UTILITIES =====
function secToHMS(sec) {
  if (!sec || sec === 0) return '00:00:00';
  const neg = sec < 0;
  const s = Math.abs(Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const str = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return neg ? `-${str}` : str;
}

function secToTimeOfDay(sec) {
  if (!sec) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatDate(d) {
  const parts = d.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getDayOfWeek(d) {
  const days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  return days[new Date(d + 'T12:00:00').getDay()];
}

function normalizeName(n) {
  if (!n) return '';
  return n.trim().toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="material-icons-round">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}</span>${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ===== STATE =====
const ADMIN_MATRICULA = '1926';
let CURRENT_USER = null;
let currentOpViewMode = 'cards';
let DATA = { records: [], resumo: [] };
let FERIADOS = JSON.parse(localStorage.getItem('bh_feriados') || '[]');
let FALTAS = JSON.parse(localStorage.getItem('bh_faltas') || '[]');
let chartSaldo = null, chartEvolucao = null, chartOperador = null, chartPausas = null;

// Default feriados if none exist
const DEFAULT_FERIADOS = [
  { data: '2026-01-01', desc: 'Confraternização Universal', tipo: 'nacional' },
  { data: '2026-02-16', desc: 'Carnaval', tipo: 'nacional' },
  { data: '2026-02-17', desc: 'Carnaval', tipo: 'nacional' },
  { data: '2026-02-18', desc: 'Quarta-feira de Cinzas', tipo: 'nacional' },
  { data: '2026-03-19', desc: 'São José (Feriado Local)', tipo: 'local' },
  { data: '2026-03-25', desc: 'Data Magna do Ceará (Feriado Estadual)', tipo: 'local' },
  { data: '2026-04-03', desc: 'Paixão de Cristo', tipo: 'nacional' },
  { data: '2026-04-21', desc: 'Tiradentes', tipo: 'nacional' },
  { data: '2026-05-01', desc: 'Dia do Trabalho', tipo: 'nacional' },
  { data: '2026-06-04', desc: 'Corpus Christi', tipo: 'nacional' },
  { data: '2026-09-07', desc: 'Independência do Brasil', tipo: 'nacional' },
  { data: '2026-10-12', desc: 'Nossa Senhora Aparecida', tipo: 'nacional' },
  { data: '2026-11-02', desc: 'Finados', tipo: 'nacional' },
  { data: '2026-11-20', desc: 'Dia da Consciência Negra', tipo: 'nacional' },
  { data: '2026-12-25', desc: 'Natal', tipo: 'nacional' }
];

// Force reset to include the full year list
FERIADOS = [...DEFAULT_FERIADOS];
localStorage.setItem('bh_feriados', JSON.stringify(FERIADOS));

const COMPENSACAO_FERIADO = 4320; // 01:12 em segundos

// ===== LOAD DATA =====
async function loadData() {
  try {
    if (typeof EMBEDDED_DATA !== 'undefined') {
      DATA = EMBEDDED_DATA;
    } else {
      const res = await fetch('data.json');
      DATA = await res.json();
    }
    initApp();
  } catch(e) {
    console.error('Erro ao carregar dados:', e);
    toast('Erro ao carregar dados!', 'error');
  }
}

// ===== COMPUTED DATA =====
function applyGlobalFilters(records, mes, dataIni, dataFim) {
  const dtIni = dataIni || '2026-03-16';
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const todayStr = d.toISOString().split('T')[0];
  const dtFim = dataFim || (mes ? '2099-12-31' : todayStr);

  return records.filter(r => {
    if (mes && !r.data.startsWith(mes)) return false;
    if (r.data < dtIni) return false;
    if (r.data > dtFim) return false;
    return true;
  });
}

function getOperators(mes, dataIni, dataFim) {
  const map = {};
  const filtered = applyGlobalFilters(DATA.records, mes, dataIni, dataFim);
  filtered.forEach(r => {
    const key = normalizeName(r.agente);
    if (!map[key]) map[key] = { nome: key, grupo: r.grupo, records: [] };
    map[key].records.push(r);
  });
  // Merge with resumo
  DATA.resumo.forEach(res => {
    const key = normalizeName(res.nome);
    let matchKey = key;
    
    if (!map[key]) {
      const existingKeys = Object.keys(map);
      const found = existingKeys.find(k => k.includes(key) || key.includes(k));
      if (found) {
        matchKey = found;
      } else {
        map[key] = { nome: res.nome, grupo: null, records: [] };
      }
    }
    
    map[matchKey].matricula = res.matricula;
    map[matchKey].admissao = res.admissao;
    map[matchKey].operacao = res.operacao;
    map[matchKey].banco_horas_resumo = res.banco_horas;
  });
  return map;
}

function getOperatorSummary(op, mes, dataIni, dataFim) {
  let credito = 0, deficit = 0;
  op.records.forEach(r => {
    credito += r.credito || 0;
    deficit += r.deficit || 0;
  });
  const dtIni = dataIni || '2026-03-16';
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const todayStr = d.toISOString().split('T')[0];
  const dtFim = dataFim || (mes ? '2099-12-31' : todayStr);

  // Add falta as BH deficit
  const faltasBH = FALTAS.filter(f => {
    if (normalizeName(f.operador) !== op.nome || f.tipo !== 'banco_horas') return false;
    if (mes && !f.data.startsWith(mes)) return false;
    if (f.data < dtIni) return false;
    if (f.data > dtFim) return false;
    return true;
  });
  faltasBH.forEach(f => { deficit += f.carga; });
  
  // Feriados: sempre incluir deficit de 01:12:00 por cada feriado cadastrado no sistema
  const feriadosFilt = FERIADOS.filter(f => {
    if (mes && !f.data.startsWith(mes)) return false;
    if (f.data < dtIni) return false;
    if (f.data > dtFim) return false;
    if (op.admissao && op.admissao >= f.data) return false;
    return true;
  });
  const bhFeriados = feriadosFilt.length * COMPENSACAO_FERIADO;
  
  const saldo = credito - deficit - bhFeriados;
  return { credito, deficit, bhFeriados, saldo };
}

function getGroups() {
  const groups = new Set();
  DATA.records.forEach(r => { if (r.grupo) groups.add(r.grupo); });
  return [...groups].sort();
}

// ===== INIT =====
function initApp() {
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  // ALWAYS clear session on page load/refresh - force login every time
  sessionStorage.removeItem('bh_user');
  CURRENT_USER = null;
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('search-box').style.display = 'none';
  document.getElementById('menu-toggle').style.display = 'none';
  document.getElementById('main-content').style.marginLeft = '0';
  document.querySelectorAll('.admin-only-show').forEach(el => el.style.display = 'none');

  populateFilters();
  renderFeriados();
  renderFaltas();
  setupEvents();
}

function populateFilters() {
  const groups = getGroups();
  const ops = Object.values(getOperators()).sort((a,b) => a.nome.localeCompare(b.nome));
  // Group selects
  ['filter-grupo-dashboard','filter-grupo-detalhes','filter-grupo-pausa', 'filter-grupo-op'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    groups.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
  });
  // Operator selects
  ['select-operador','filter-operador-detalhes','falta-operador'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    ops.forEach(op => { const o = document.createElement('option'); o.value = op.nome; o.textContent = `${op.nome} (${op.grupo})`; sel.appendChild(o); });
  });
  // Month selects
  const months = new Set();
  DATA.records.forEach(r => {
    if (r.data) {
      const parts = r.data.split('-');
      months.add(`${parts[0]}-${parts[1]}`);
    }
  });
  ['filter-mes-pausa', 'filter-mes-dash', 'filter-mes-op', 'filter-mes-detalhes'].forEach(id => {
    const selMes = document.getElementById(id);
    if (selMes) {
      const firstMes = selMes.options[0];
      selMes.innerHTML = '';
      selMes.appendChild(firstMes);
      [...months].sort().reverse().forEach(m => {
        const o = document.createElement('option');
        o.value = m;
        const parts = m.split('-');
        o.textContent = `${parts[1]}/${parts[0]}`;
        selMes.appendChild(o);
      });
    }
  });

  // Set default date filter only on those that still use the default (like detalhes maybe, but leaving empty is better for filtering all)
}

// ===== DASHBOARD =====
function renderDashboard() {
  const mes = document.getElementById('filter-mes-dash')?.value || '';
  const dataIni = document.getElementById('filter-data-ini-dash')?.value || '';
  const dataFim = document.getElementById('filter-data-fim-dash')?.value || '';
  const filterGrupo = document.getElementById('filter-grupo-dashboard')?.value || '';

  const ops = getOperators(mes, dataIni, dataFim);
  const opsList = Object.values(ops);
  let totalCredito = 0, totalDeficit = 0, totalBH = 0;
  const summaries = [];

  opsList.forEach(op => {
    if (filterGrupo && op.grupo !== filterGrupo) return;
    const s = getOperatorSummary(op, mes, dataIni, dataFim);
    totalCredito += s.credito;
    totalDeficit += s.deficit;
    totalBH += s.bhFeriados;
    summaries.push({ ...op, ...s });
  });

  const totalSaldo = totalCredito - totalDeficit - totalBH;

  document.getElementById('kpi-credito-val').textContent = secToHMS(totalCredito);
  document.getElementById('kpi-deficit-val').textContent = secToHMS(totalDeficit);
  document.getElementById('kpi-saldo-val').textContent = secToHMS(totalSaldo);
  document.getElementById('kpi-saldo-val').style.color = totalSaldo >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('kpi-operadores-val').textContent = summaries.length;

  // Ranking
  let filtered = summaries;
  filtered.sort((a, b) => b.saldo - a.saldo);

  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = '';
  filtered.forEach((s, i) => {
    const statusClass = s.saldo > 0 ? 'status-positivo' : s.saldo < 0 ? 'status-negativo' : 'status-neutro';
    const statusText = s.saldo > 0 ? 'Positivo' : s.saldo < 0 ? 'Negativo' : 'Neutro';
    tbody.innerHTML += `<tr>
      <td>${i + 1}</td>
      <td><strong>${s.nome}</strong></td>
      <td>${s.grupo || '-'}</td>
      <td>${s.matricula || '-'}</td>
      <td class="val-credito">${secToHMS(s.credito)}</td>
      <td class="val-deficit">${secToHMS(s.deficit)}</td>
      <td>${secToHMS(s.bhFeriados)}</td>
      <td style="color:${s.saldo >= 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">${secToHMS(s.saldo)}</td>
      <td><span class="status ${statusClass}">${statusText}</span></td>
    </tr>`;
  });

  renderCharts(summaries);
}

// ===== CHARTS =====
function renderCharts(summaries) {
  const chartColors = {
    green: '#10b981', red: '#ef4444', cyan: '#00d4ff',
    greenBg: 'rgba(16,185,129,0.2)', redBg: 'rgba(239,68,68,0.2)', cyanBg: 'rgba(0,212,255,0.2)'
  };
  Chart.defaults.color = '#8b95b0';
  Chart.defaults.borderColor = 'rgba(42,52,86,0.4)';
  Chart.defaults.font.family = 'Inter';

  // Saldo por Operador
  const sorted = [...summaries].sort((a,b) => b.saldo - a.saldo);
  const labels = sorted.map(s => s.nome.split(' ').slice(0,2).join(' '));
  const saldoData = sorted.map(s => Math.round(s.saldo / 60));

  if (chartSaldo) chartSaldo.destroy();
  chartSaldo = new Chart(document.getElementById('canvas-saldo-operador'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Saldo (min)',
        data: saldoData,
        backgroundColor: saldoData.map(v => v >= 0 ? chartColors.greenBg : chartColors.redBg),
        borderColor: saldoData.map(v => v >= 0 ? chartColors.green : chartColors.red),
        borderWidth: 1.5,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(42,52,86,0.3)' }, ticks: { callback: v => `${v}min` } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } }
      }
    }
  });

  // Evolução Diária
  const dailyMap = {};
  DATA.records.forEach(r => {
    if (!dailyMap[r.data]) dailyMap[r.data] = { credito: 0, deficit: 0 };
    dailyMap[r.data].credito += r.credito || 0;
    dailyMap[r.data].deficit += r.deficit || 0;
  });
  const dates = Object.keys(dailyMap).sort();
  const creditoDaily = dates.map(d => Math.round(dailyMap[d].credito / 60));
  const deficitDaily = dates.map(d => Math.round(dailyMap[d].deficit / 60));
  const dateLabels = dates.map(d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; });

  if (chartEvolucao) chartEvolucao.destroy();
  chartEvolucao = new Chart(document.getElementById('canvas-evolucao'), {
    type: 'line',
    data: {
      labels: dateLabels,
      datasets: [
        { label: 'Crédito (min)', data: creditoDaily, borderColor: chartColors.green, backgroundColor: chartColors.greenBg, fill: true, tension: .4, pointRadius: 2 },
        { label: 'Déficit (min)', data: deficitDaily, borderColor: chartColors.red, backgroundColor: chartColors.redBg, fill: true, tension: .4, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 16 } } },
      scales: {
        y: { grid: { color: 'rgba(42,52,86,0.3)' }, ticks: { callback: v => `${v}min` } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 15 } }
      }
    }
  });
}

// ===== OPERADORES VIEW =====
function renderOperadoresView() {
  const mes = document.getElementById('filter-mes-op')?.value || '';
  const dataIni = document.getElementById('filter-data-ini-op')?.value || '';
  const dataFim = document.getElementById('filter-data-fim-op')?.value || '';
  const grupo = document.getElementById('filter-grupo-op')?.value || '';
  const search = document.getElementById('search-op-list')?.value.toLowerCase() || '';

  const ops = Object.values(getOperators(mes, dataIni, dataFim)).sort((a,b) => a.nome.localeCompare(b.nome));
  const filteredOps = ops.filter(op => {
    if (grupo && op.grupo !== grupo) return false;
    if (search && !(op.nome.toLowerCase().includes(search) || String(op.matricula||'').includes(search))) return false;
    return true;
  });

  const gridContainer = document.getElementById('operadores-grid-container');
  const listContainer = document.getElementById('operadores-list-container');
  const listBody = document.getElementById('operadores-list-body');
  const detailContainer = document.getElementById('operador-detail');

  if (!gridContainer || !listContainer) return;
  detailContainer.style.display = 'none';

  if (currentOpViewMode === 'cards') {
    gridContainer.style.display = 'grid';
    listContainer.style.display = 'none';
    gridContainer.innerHTML = '';
    
    if (CURRENT_USER && CURRENT_USER.role === 'operator') {
      gridContainer.classList.add('single-mode');
    } else {
      gridContainer.classList.remove('single-mode');
    }

    filteredOps.forEach(op => {
      const s = getOperatorSummary(op, mes, dataIni, dataFim);
      const isPos = s.saldo >= 0;
      let tempoLogado = 0;
      let pausasTotal = 0;
      op.records.forEach(r => {
        tempoLogado += (r.tempo_logado || 0);
        pausasTotal += (r.pausas_total || 0);
      });
      const pctPausa = tempoLogado > 0 ? ((pausasTotal / tempoLogado) * 100).toFixed(1) + '%' : '0.0%';
      const dataAtt = DATA.updated_at ? new Date(DATA.updated_at).toLocaleDateString('pt-BR') + ' ' + new Date(DATA.updated_at).toLocaleTimeString('pt-BR').slice(0,5) : '-';

      gridContainer.innerHTML += `
        <div class="op-card" onclick="openOperadorDetail('${op.nome}')">
          <div class="op-card-header">
            <div class="op-card-avatar"><span class="material-icons-round">person</span></div>
            <div class="op-card-info">
              <h4>${op.nome}</h4>
              <p>${op.grupo || '-'} | Mat: ${op.matricula || '-'}</p>
            </div>
          </div>
          <div class="op-card-stats">
            <div class="op-card-stat"><label>Pausas</label><span style="color: ${parseFloat(pctPausa) <= 15.5 ? 'var(--green)' : 'var(--red)'}">${pctPausa}</span></div>
            <div class="op-card-stat" style="text-align:right"><label>Saldo BH</label><span style="color:${isPos ? 'var(--green)' : 'var(--red)'}">${secToHMS(s.saldo)}</span></div>
          </div>
          <div style="font-size: 0.65rem; color: var(--text-muted); text-align: right; margin-top: 10px;">Atualizado: ${dataAtt}</div>
        </div>
      `;
    });
  } else {
    gridContainer.style.display = 'none';
    listContainer.style.display = 'block';
    listBody.innerHTML = '';
    filteredOps.forEach(op => {
      const s = getOperatorSummary(op, mes, dataIni, dataFim);
      const isPos = s.saldo >= 0;
      listBody.innerHTML += `
        <tr style="cursor:pointer" onclick="openOperadorDetail('${op.nome}')">
          <td><strong>${op.nome}</strong></td>
          <td>${op.grupo || '-'}</td>
          <td>${op.matricula || '-'}</td>
          <td class="val-credito">${secToHMS(s.credito)}</td>
          <td class="val-deficit">${secToHMS(s.deficit)}</td>
          <td style="color:${isPos ? 'var(--green)' : 'var(--red)'}; font-weight:700">${secToHMS(s.saldo)}</td>
        </tr>
      `;
    });
  }
}

function openOperadorDetail(nome) {
  document.getElementById('operadores-grid-container').style.display = 'none';
  document.getElementById('operadores-list-container').style.display = 'none';
  const ctrl = document.getElementById('admin-op-controls');
  if(ctrl) ctrl.style.display = 'none';
  const back = document.getElementById('btn-back-operadores');
  if(back) back.style.display = 'inline-flex';
  renderOperadorDetail(nome);
}

function renderOperadorDetail(nome) {
  const mes = document.getElementById('filter-mes-op')?.value || '';
  const dataIni = document.getElementById('filter-data-ini-op')?.value || '';
  const dataFim = document.getElementById('filter-data-fim-op')?.value || '';

  const ops = getOperators(mes, dataIni, dataFim);
  const op = ops[nome];
  if (!op) return;
  const s = getOperatorSummary(op, mes, dataIni, dataFim);

  document.getElementById('operador-detail').style.display = 'flex';
  document.getElementById('operador-nome').textContent = op.nome;
  document.getElementById('operador-grupo').textContent = op.grupo || '-';
  document.getElementById('operador-matricula').textContent = `Mat: ${op.matricula || '-'}`;
  document.getElementById('operador-operacao').textContent = op.operacao || '-';
  document.getElementById('operador-saldo').textContent = secToHMS(s.saldo);
  document.getElementById('operador-saldo').style.color = s.saldo >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('op-credito').textContent = secToHMS(s.credito);
  document.getElementById('op-deficit').textContent = secToHMS(s.deficit);
  document.getElementById('op-bh-feriados').textContent = secToHMS(s.bhFeriados);

  let tempLog = 0, pTotal = 0;
  op.records.forEach(r => { tempLog += (r.tempo_logado||0); pTotal += (r.pausas_total||0); });
  const pct = tempLog > 0 ? ((pTotal / tempLog) * 100).toFixed(1) + '%' : '0.0%';
  const elPct = document.getElementById('op-pct-pausa');
  if (elPct) {
    elPct.textContent = pct;
    elPct.style.color = parseFloat(pct) <= 15.5 ? 'var(--green)' : 'var(--red)';
  }

  // Table
  const tbody = document.getElementById('operador-body');
  tbody.innerHTML = '';
  const sorted = [...op.records].sort((a,b) => a.data.localeCompare(b.data));
  sorted.forEach(r => {
    tbody.innerHTML += `<tr>
      <td>${formatDate(r.data)} <small style="color:var(--text-muted)">${getDayOfWeek(r.data).slice(0,3)}</small></td>
      <td>${secToTimeOfDay(r.primeiro_login)}</td>
      <td>${secToTimeOfDay(r.ultimo_logout)}</td>
      <td>${secToHMS(r.tempo_logado)}</td>
      <td>${secToHMS(r.meta)}</td>
      <td class="val-credito">${r.credito ? secToHMS(r.credito) : '-'}</td>
      <td class="val-deficit">${r.deficit ? secToHMS(r.deficit) : '-'}</td>
      <td>${secToHMS(r.pausas_total)}</td>
    </tr>`;
  });

  // Chart
  const chartLabels = sorted.map(r => { const p = r.data.split('-'); return `${p[2]}/${p[1]}`; });
  const cred = sorted.map(r => Math.round((r.credito || 0) / 60));
  const def = sorted.map(r => -Math.round((r.deficit || 0) / 60));

  if (chartOperador) chartOperador.destroy();
  chartOperador = new Chart(document.getElementById('canvas-operador-hist'), {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: [
        { label: 'Crédito (min)', data: cred, backgroundColor: 'rgba(16,185,129,0.6)', borderRadius: 3 },
        { label: 'Déficit (min)', data: def, backgroundColor: 'rgba(239,68,68,0.6)', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 20 } },
        y: { stacked: true, grid: { color: 'rgba(42,52,86,0.3)' }, ticks: { callback: v => `${v}min` } }
      }
    }
  });
}

// ===== DETALHES =====
function renderDetalhes() {
  const ini = document.getElementById('filter-data-ini-detalhes')?.value || '';
  const fim = document.getElementById('filter-data-fim-detalhes')?.value || '';
  const mes = document.getElementById('filter-mes-detalhes')?.value || '';
  const grupo = document.getElementById('filter-grupo-detalhes')?.value || '';
  const operador = document.getElementById('filter-operador-detalhes')?.value || '';

  let filtered = applyGlobalFilters(DATA.records, mes, ini, fim);
  filtered = filtered.filter(r => {
    if (grupo && r.grupo !== grupo) return false;
    if (operador && normalizeName(r.agente) !== operador) return false;
    return true;
  });

  filtered.sort((a,b) => a.data.localeCompare(b.data) || a.agente.localeCompare(b.agente));
  document.getElementById('detalhes-count').textContent = `${filtered.length} registros`;

  const tbody = document.getElementById('detalhes-body');
  tbody.innerHTML = '';
  filtered.forEach(r => {
    tbody.innerHTML += `<tr>
      <td>${formatDate(r.data)} <small style="color:var(--text-muted)">${getDayOfWeek(r.data).slice(0,3)}</small></td>
      <td>${normalizeName(r.agente)}</td>
      <td>${r.grupo || '-'}</td>
      <td>${secToTimeOfDay(r.primeiro_login)}</td>
      <td>${secToTimeOfDay(r.ultimo_logout)}</td>
      <td>${secToHMS(r.tempo_logado)}</td>
      <td>${secToHMS(r.meta)}</td>
      <td class="val-credito">${r.credito ? secToHMS(r.credito) : '-'}</td>
      <td class="val-deficit">${r.deficit ? secToHMS(r.deficit) : '-'}</td>
      <td>${secToHMS(r.pausas_total)}</td>
    </tr>`;
  });
}

// ===== PAUSAS =====
function renderPausas() {
  const mes = document.getElementById('filter-mes-pausa')?.value || '';
  const dataIni = document.getElementById('filter-data-ini-pausa')?.value || '';
  const dataFim = document.getElementById('filter-data-fim-pausa')?.value || '';
  const grupo = document.getElementById('filter-grupo-pausa')?.value || '';
  
  const opsMap = {};
  let filteredRecords = applyGlobalFilters(DATA.records, mes, dataIni, dataFim);
  
  if (grupo) {
    filteredRecords = filteredRecords.filter(r => r.grupo === grupo);
  }
  
  filteredRecords.forEach(r => {
    const nome = normalizeName(r.agente);
    if (!opsMap[nome]) {
      opsMap[nome] = { nome, tempo_logado: 0, pausas_total: 0, diasTrabalhados: 0 };
    }
    opsMap[nome].tempo_logado += (r.tempo_logado || 0);
    opsMap[nome].pausas_total += (r.pausas_total || 0);
    opsMap[nome].diasTrabalhados += 1;
  });
  
  const opsList = Object.values(opsMap);
  let totalLogado = 0;
  let totalPausas = 0;
  let dentroMeta = 0;
  let acimaMeta = 0;
  
  const pausasData = opsList.map(op => {
    totalLogado += op.tempo_logado;
    totalPausas += op.pausas_total;
    const pct = op.tempo_logado > 0 ? (op.pausas_total / op.tempo_logado) * 100 : 0;
    if (pct <= 15.5) dentroMeta++; else acimaMeta++;
    
    // Média de tempo logado e pausa por dia trabalhado
    const mediaLogado = op.diasTrabalhados > 0 ? op.tempo_logado / op.diasTrabalhados : 0;
    const mediaPausa = op.diasTrabalhados > 0 ? op.pausas_total / op.diasTrabalhados : 0;
    
    // Get Saldo BH
    const opsForPeriod = getOperators(mes, dataIni, dataFim);
    const fullOp = opsForPeriod[op.nome];
    const saldoBH = fullOp ? getOperatorSummary(fullOp, mes, dataIni, dataFim).saldo : 0;
    
    return { ...op, pct, mediaLogado, mediaPausa, saldoBH };
  });
  
  pausasData.sort((a,b) => b.pct - a.pct);
  
  const mediaPct = totalLogado > 0 ? (totalPausas / totalLogado) * 100 : 0;
  
  const elMedia = document.getElementById('kpi-pausa-media');
  if (elMedia) {
    elMedia.textContent = mediaPct.toFixed(1) + '%';
    elMedia.style.color = mediaPct <= 15.5 ? 'var(--green)' : 'var(--red)';
    document.getElementById('kpi-pausa-dentro').textContent = dentroMeta;
    document.getElementById('kpi-pausa-acima').textContent = acimaMeta;
  }
  
  const tbody = document.getElementById('pausas-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  pausasData.forEach(p => {
    const isOk = p.pct <= 15.5;
    const statusClass = isOk ? 'status-positivo' : 'status-negativo';
    const statusText = isOk ? 'Dentro (&lt;=15.5%)' : 'Acima (&gt;15.5%)';
    tbody.innerHTML += `<tr>
      <td><strong>${p.nome}</strong></td>
      <td>${secToHMS(p.mediaLogado)}</td>
      <td>${secToHMS(p.mediaPausa)}</td>
      <td style="color:${isOk ? 'var(--green)' : 'var(--red)'}; font-weight:700">${p.pct.toFixed(2)}%</td>
      <td><span class="status ${statusClass}">${statusText}</span></td>
      <td style="color:${p.saldoBH >= 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">${secToHMS(p.saldoBH)}</td>
    </tr>`;
  });
  
  // Render Chart
  const labels = pausasData.map(p => p.nome.split(' ').slice(0,2).join(' '));
  const pctData = pausasData.map(p => p.pct.toFixed(2));
  const saldoData = pausasData.map(p => Math.round(p.saldoBH / 60)); // in minutes
  
  if (chartPausas) chartPausas.destroy();
  const ctx = document.getElementById('canvas-pausas');
  if (!ctx) return;
  
  chartPausas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '% Pausa',
          data: pctData,
          type: 'bar',
          yAxisID: 'y',
          backgroundColor: pctData.map(v => parseFloat(v) <= 15.5 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'),
          borderRadius: 3
        },
        {
          label: 'Saldo BH (min)',
          data: saldoData,
          type: 'line',
          yAxisID: 'y1',
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0,212,255,0.2)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { 
        legend: { position: 'top', labels: { boxWidth: 12 } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
        y: { 
          type: 'linear', position: 'left',
          title: { display: true, text: '% Pausa' },
          grid: { color: 'rgba(42,52,86,0.3)' }
        },
        y1: { 
          type: 'linear', position: 'right',
          title: { display: true, text: 'Saldo BH (min)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// ===== FERIADOS =====
function renderFeriados() {
  FERIADOS.sort((a,b) => a.data.localeCompare(b.data));
  const tbody = document.getElementById('feriados-body');
  tbody.innerHTML = '';
  FERIADOS.forEach((f, i) => {
    tbody.innerHTML += `<tr>
      <td>${formatDate(f.data)}</td>
      <td>${getDayOfWeek(f.data)}</td>
      <td>${f.desc}</td>
      <td><span class="status ${f.tipo === 'nacional' ? 'status-positivo' : 'status-atestado'}">${f.tipo === 'nacional' ? 'Nacional' : 'Local'}</span></td>
      <td>${secToHMS(COMPENSACAO_FERIADO)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeFeriado(${i})"><span class="material-icons-round" style="font-size:.9rem">delete</span></button></td>
    </tr>`;
  });
}

function addFeriado() {
  const data = document.getElementById('feriado-data').value;
  const desc = document.getElementById('feriado-desc').value.trim();
  const tipo = document.getElementById('feriado-tipo').value;
  if (!data || !desc) { toast('Preencha data e descrição!', 'error'); return; }
  if (FERIADOS.some(f => f.data === data)) { toast('Feriado já cadastrado nesta data!', 'error'); return; }
  FERIADOS.push({ data, desc, tipo });
  localStorage.setItem('bh_feriados', JSON.stringify(FERIADOS));
  renderFeriados();
  renderDashboard();
  document.getElementById('feriado-data').value = '';
  document.getElementById('feriado-desc').value = '';
  toast('Feriado cadastrado com sucesso!');
}

function removeFeriado(i) {
  showModal('Remover Feriado', `Deseja remover o feriado <strong>${FERIADOS[i].desc}</strong>?`, () => {
    FERIADOS.splice(i, 1);
    localStorage.setItem('bh_feriados', JSON.stringify(FERIADOS));
    renderFeriados();
    renderDashboard();
    toast('Feriado removido!', 'info');
  });
}

// ===== FALTAS =====
function renderFaltas() {
  const filterTipo = document.getElementById('filter-tipo-falta')?.value || '';
  let filtered = [...FALTAS];
  if (filterTipo) filtered = filtered.filter(f => f.tipo === filterTipo);
  filtered.sort((a,b) => a.data.localeCompare(b.data));

  const tbody = document.getElementById('faltas-body');
  tbody.innerHTML = '';
  filtered.forEach((f, i) => {
    const realIdx = FALTAS.indexOf(f);
    const tipoLabel = f.tipo === 'banco_horas' ? 'Banco de Horas' : 'Atestado';
    const tipoClass = f.tipo === 'banco_horas' ? 'status-bh' : 'status-atestado';
    tbody.innerHTML += `<tr>
      <td><strong>${f.operador}</strong></td>
      <td>${formatDate(f.data)}</td>
      <td><span class="status ${tipoClass}">${tipoLabel}</span></td>
      <td>${secToHMS(f.carga)}</td>
      <td>${f.obs || '-'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeFalta(${realIdx})"><span class="material-icons-round" style="font-size:.9rem">delete</span></button></td>
    </tr>`;
  });
}

function addFalta() {
  const operador = document.getElementById('falta-operador').value;
  const data = document.getElementById('falta-data').value;
  const tipo = document.getElementById('falta-tipo').value;
  const carga = parseInt(document.getElementById('falta-carga').value);
  const obs = document.getElementById('falta-obs').value.trim();
  if (!operador || !data) { toast('Preencha operador e data!', 'error'); return; }
  FALTAS.push({ operador, data, tipo, carga, obs });
  localStorage.setItem('bh_faltas', JSON.stringify(FALTAS));
  renderFaltas();
  renderDashboard();
  document.getElementById('falta-data').value = '';
  document.getElementById('falta-obs').value = '';
  const tipoLabel = tipo === 'banco_horas' ? 'Banco de Horas' : 'Atestado';
  toast(`Falta registrada como ${tipoLabel}!`);
}

function removeFalta(i) {
  showModal('Remover Falta', `Deseja remover esta falta de <strong>${FALTAS[i].operador}</strong>?`, () => {
    FALTAS.splice(i, 1);
    localStorage.setItem('bh_faltas', JSON.stringify(FALTAS));
    renderFaltas();
    renderDashboard();
    toast('Falta removida!', 'info');
  });
}

// ===== MODAL =====
function showModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('modal-confirm').onclick = () => {
    onConfirm();
    document.getElementById('modal-overlay').classList.remove('active');
  };
}

// ===== NAVIGATION =====
const ADMIN_ONLY_PAGES = ['dashboard', 'detalhes', 'feriados', 'faltas', 'pausas'];

function navigateTo(page) {
  // HARD BLOCK: Only matricula 1926 can access admin pages
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin' && CURRENT_USER.adminMatricula === ADMIN_MATRICULA;
  
  if (!isAdmin && ADMIN_ONLY_PAGES.includes(page)) {
    page = 'operadores';
  }
  
  // Double-check: operators are ALWAYS forced to 'operadores'
  if (CURRENT_USER && CURRENT_USER.role === 'operator') {
    page = 'operadores';
  }
  
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = { dashboard: 'Dashboard', operadores: 'Operadores', detalhes: 'Detalhes Diários', feriados: 'Feriados', faltas: 'Faltas / Atestados', pausas: 'Análise de Pausas' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'dashboard') renderDashboard();
  if (page === 'detalhes') renderDetalhes();
  if (page === 'faltas') renderFaltas();
  if (page === 'pausas') renderPausas();
  if (page === 'operadores') {
    const ctrl = document.getElementById('admin-op-controls');
    if (ctrl) ctrl.style.display = 'block';
    
    if (CURRENT_USER && CURRENT_USER.role === 'operator') {
      document.querySelectorAll('.admin-only-show').forEach(el => el.style.display = 'none');
      document.getElementById('sidebar').style.display = 'none';
      document.getElementById('search-box').style.display = 'none';
      document.getElementById('menu-toggle').style.display = 'none';
      document.getElementById('main-content').style.marginLeft = '0';
      const searchInput = document.getElementById('search-op-list');
      if (searchInput) searchInput.value = CURRENT_USER.op.matricula;
      currentOpViewMode = 'cards';
      const back = document.getElementById('btn-back-operadores');
      if (back) back.style.display = 'none';
      renderOperadoresView();
    } else {
      document.querySelectorAll('.admin-only-show').forEach(el => el.style.display = '');
      const searchInput = document.getElementById('search-op-list');
      if (searchInput) searchInput.value = '';
      const back = document.getElementById('btn-back-operadores');
      if (back) back.style.display = 'none';
      renderOperadoresView();
    }
  }
}

// ===== EVENTS =====
function setupEvents() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
      document.getElementById('sidebar').classList.remove('open');
    });
  });

  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Filters setup
  ['filter-mes-dash', 'filter-data-ini-dash', 'filter-data-fim-dash', 'filter-grupo-dashboard'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderDashboard);
  });
  
  ['filter-mes-op', 'filter-data-ini-op', 'filter-data-fim-op', 'filter-grupo-op', 'search-op-list'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      renderOperadoresView();
    });
  });

  document.getElementById('btn-view-cards')?.addEventListener('click', () => {
    currentOpViewMode = 'cards';
    document.getElementById('btn-view-cards').classList.add('active');
    document.getElementById('btn-view-list').classList.remove('active');
    renderOperadoresView();
  });
  document.getElementById('btn-view-list')?.addEventListener('click', () => {
    currentOpViewMode = 'list';
    document.getElementById('btn-view-list').classList.add('active');
    document.getElementById('btn-view-cards').classList.remove('active');
    renderOperadoresView();
  });
  document.getElementById('btn-back-operadores')?.addEventListener('click', () => {
    document.getElementById('operador-detail').style.display = 'none';
    if (!CURRENT_USER || CURRENT_USER.role !== 'operator') {
      document.getElementById('admin-op-controls').style.display = 'block';
    }
    renderOperadoresView();
  });
  
  ['filter-mes-detalhes', 'filter-data-ini-detalhes', 'filter-data-fim-detalhes', 'filter-grupo-detalhes', 'filter-operador-detalhes'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderDetalhes);
  });
  document.getElementById('btn-filtrar-detalhes')?.addEventListener('click', renderDetalhes);
  
  ['filter-mes-pausa', 'filter-data-ini-pausa', 'filter-data-fim-pausa', 'filter-grupo-pausa'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderPausas);
  });
  
  document.getElementById('filter-tipo-falta')?.addEventListener('change', renderFaltas);

  // Add buttons
  document.getElementById('btn-add-feriado').addEventListener('click', addFeriado);
  document.getElementById('btn-add-falta').addEventListener('click', addFalta);

  // Modal
  document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal-overlay').classList.remove('active'));
  document.getElementById('modal-cancel').addEventListener('click', () => document.getElementById('modal-overlay').classList.remove('active'));
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('modal-overlay').classList.remove('active');
  });

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    if (q.length > 1) {
      navigateTo('operadores');
      const sel = document.getElementById('select-operador');
      for (let opt of sel.options) {
        if (opt.value && opt.value.toLowerCase().includes(q)) {
          sel.value = opt.value;
          renderOperadorDetail(opt.value);
          break;
        }
      }
    }
  });
}

// ===== AUTO UPDATE =====
let lastUpdateTime = null;

function refreshCurrentView() {
  // Re-render the current active page WITHOUT re-running initApp
  // This preserves the user's login state and current screen
  populateFilters();
  renderFeriados();
  renderFaltas();
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id.replace('page-', '');
    if (pageId === 'dashboard') renderDashboard();
    else if (pageId === 'detalhes') renderDetalhes();
    else if (pageId === 'pausas') renderPausas();
    else if (pageId === 'operadores') renderOperadoresView();
  }
}

setInterval(async () => {
  try {
    const res = await fetch('data.json?t=' + new Date().getTime());
    if (res.ok) {
      const newData = await res.json();
      if (!lastUpdateTime) {
        lastUpdateTime = newData.updated_at || null;
      } else if (newData.updated_at && newData.updated_at !== lastUpdateTime) {
        lastUpdateTime = newData.updated_at;
        DATA = newData;
        refreshCurrentView();
        toast('Dados atualizados com base na nova planilha!', 'info');
      }
    }
  } catch(e) {}
}, 10000);

// ===== AUTH =====
function attemptLogin() {
  const val = document.getElementById('login-input').value.trim();
  if (!val) { toast('Digite a matrícula/senha', 'error'); return; }

  // ADMIN: ONLY matricula 1926 grants admin access
  if (val === ADMIN_MATRICULA) {
    CURRENT_USER = { role: 'admin', op: null, adminMatricula: ADMIN_MATRICULA };
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('sidebar').style.display = 'flex';
    document.getElementById('search-box').style.display = 'flex';
    document.getElementById('menu-toggle').style.display = 'block';
    
    // Check if main-content needs margin restore
    if (window.innerWidth > 768) {
      document.getElementById('main-content').style.marginLeft = 'var(--sidebar-w)';
    }
    
    navigateTo('dashboard');
    toast('Bem-vindo(a), Supervisão!');
    return;
  }

  // Operator login
  const opsList = Object.values(getOperators());
  const operator = opsList.find(o => String(o.matricula) === val);
  if (operator) {
    CURRENT_USER = { role: 'operator', op: operator };
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('search-box').style.display = 'none';
    document.getElementById('menu-toggle').style.display = 'none';
    document.getElementById('main-content').style.marginLeft = '0';
    
    navigateTo('operadores');
    toast(`Bem-vindo(a), ${operator.nome}!`);
  } else {
    toast('Matrícula/Senha incorreta', 'error');
  }
}
document.getElementById('btn-login')?.addEventListener('click', attemptLogin);
document.getElementById('login-input')?.addEventListener('keypress', e => { if(e.key === 'Enter') attemptLogin(); });

function logout() {
  CURRENT_USER = null;
  sessionStorage.removeItem('bh_user');
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-input').value = '';
  window.location.reload();
}
document.getElementById('btn-logout')?.addEventListener('click', logout);

document.getElementById('btn-refresh')?.addEventListener('click', async () => {
  toast('Atualizando dados...');
  try {
    const res = await fetch('data.json?t=' + new Date().getTime());
    if (res.ok) {
      DATA = await res.json();
      lastUpdateTime = DATA.updated_at || null;
      refreshCurrentView();
      toast('Dados atualizados!', 'success');
    }
  } catch(e) {
    toast('Erro ao atualizar dados!', 'error');
  }
});
// ===== START =====
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});
