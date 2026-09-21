import {DataAdapter} from './adapter.js';
const adapter = new DataAdapter();
const state = { dashboard: null, selectedCode: null, selectedDate: null, holdings: null, changes: null, view: 'holdings', requestId: 0 };

const $ = (selector) => document.querySelector(selector);
const fmt = (value, digits = 2) => Number(value).toFixed(digits);
const signed = (value) => `${Number(value) >= 0 ? '+' : ''}${fmt(value)}`;
const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[char]));

function setStatus(message, error = false) {
  const status = $('#status');
  status.textContent = message;
  status.className = `status${error ? ' error' : ''}`;
}

function renderCards() {
  const activeCards = state.dashboard.etfs.map((etf) => {
    const change = Number(etf.price.change);
    const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
    const active = etf.etf_code === state.selectedCode ? ' active' : '';
    return `<button class="etf-card${active}" data-code="${escapeHtml(etf.etf_code)}">
      <span>${escapeHtml(etf.etf_name)}</span>
      <strong>${escapeHtml(etf.etf_code)}</strong>
      <small>${fmt(etf.price.close_price)} TWD</small>
      <span class="change ${changeClass}">${signed(change)}</span>
      <span class="freshness">持股 ${escapeHtml(etf.source_date)} · ${etf.count} 檔</span>
    </button>`;
  }).join('');
  const plannedCards = (state.dashboard.planned_etfs || []).map((etf) =>
    `<div class="etf-card planned-card" aria-label="${escapeHtml(etf.etf_code)} 待掛牌">
      <span>${escapeHtml(etf.etf_name)}</span>
      <strong>${escapeHtml(etf.etf_code)}</strong>
      <small>待掛牌</small>
      <span class="freshness">${escapeHtml(etf.active_from)} 起自動啟用</span>
    </div>`
  ).join('');
  $('#etf-cards').innerHTML = activeCards + plannedCards;
  document.querySelectorAll('button.etf-card').forEach((button) => {
    button.addEventListener('click', () => selectETF(button.dataset.code));
  });
}

async function selectETF(code, selectedDate = null) {
  const requestId = ++state.requestId;
  setStatus(`正在載入 ${code}…`);
  try {
    const dates = await adapter.dates(code);
    const date = selectedDate || dates.source_dates[0];
    if (!date || !dates.source_dates.includes(date)) throw new Error('此日期未匯出；不會回退至其他日期');
    const {holdings, changes, note} = await adapter.detail(code, date);
    if (requestId !== state.requestId) return;
    state.selectedCode = code;
    state.selectedDate = date;
    state.holdings = holdings;
    state.changes = changes;
    renderCards();
    const selector = $('#source-date');
    selector.innerHTML = dates.source_dates.map((item) =>
      `<option value="${escapeHtml(item)}"${item === date ? ' selected' : ''}>${escapeHtml(item)}</option>`
    ).join('');
    selector.disabled = false;
    renderDetail();
    history.replaceState(null, '', `#${new URLSearchParams({code, date})}`);
    setStatus(`${code} 已載入。${note || ''}${adapter.manifest ? '只涵蓋已匯出日期；非即時資料。' : '本機唯讀查詢。'}`);
    return true;
  } catch (error) {
    if (requestId === state.requestId) {
      if (state.selectedDate) $('#source-date').value = state.selectedDate;
      setStatus(error.message, true);
    }
    return false;
  }
}

function renderDetail() {
  const holdings = state.holdings;
  const changes = state.changes;
  $('#detail-title').textContent = `${holdings.etf_code} ${holdings.etf_name}`;
  $('#detail-meta').textContent = changes.from_source_date
    ? `來源資料日 ${holdings.source_date}，比較基準 ${changes.from_source_date}`
    : `來源資料日 ${holdings.source_date}，目前沒有更早紀錄（新增表示首次觀測，不代表當日買入）`;
  $('#holding-count').textContent = holdings.count;
  $('#total-weight').textContent = `${fmt(holdings.total_weight_pct)}%`;
  $('#added-count').textContent = changes.summary.added;
  $('#removed-count').textContent = changes.summary.removed;
  $('#changed-count').textContent = changes.summary.changed;
  $('#source-note').textContent = `資料來源：${holdings.source} ｜ 擷取時間：${holdings.fetched_at}（UTC）${holdings.disclosure_scope.startsWith('top_') ? ' ｜ 此來源只揭露公開前十大持股' : ''}`;
  renderTable();
}

function holdingRows() {
  return state.holdings.holdings.map((row) => ({
    searchable: `${row.security_code || ''} ${row.security_name}`,
    html: `<tr><td><code>${escapeHtml(row.security_code)}</code></td><td>${escapeHtml(row.security_name)}</td><td class="number">${fmt(row.weight_pct)}%</td><td class="number">${row.shares == null ? '—' : Number(row.shares).toLocaleString()}</td></tr>`,
  }));
}

function changeRows() {
  const rows = [];
  state.changes.added.forEach((row) => rows.push({
    searchable: `${row.security_code || ''} ${row.security_name}`,
    html: `<tr><td><span class="badge positive">新增</span></td><td><code>${escapeHtml(row.security_code)}</code></td><td>${escapeHtml(row.security_name)}</td><td class="number">${fmt(row.current_weight_pct)}%</td><td class="number positive">+${fmt(row.current_weight_pct)}</td></tr>`,
  }));
  state.changes.removed.forEach((row) => rows.push({
    searchable: `${row.security_code || ''} ${row.security_name}`,
    html: `<tr><td><span class="badge negative">移除</span></td><td><code>${escapeHtml(row.security_code)}</code></td><td>${escapeHtml(row.security_name)}</td><td class="number">—</td><td class="number negative">-${fmt(row.previous_weight_pct)}</td></tr>`,
  }));
  state.changes.changed.forEach((row) => rows.push({
    searchable: `${row.security_code || ''} ${row.security_name}`,
    html: `<tr><td><span class="badge neutral">調整</span></td><td><code>${escapeHtml(row.security_code)}</code></td><td>${escapeHtml(row.security_name)}</td><td class="number">${fmt(row.current_weight_pct)}%</td><td class="number ${row.change_pp > 0 ? 'positive' : 'negative'}">${signed(row.change_pp)}</td></tr>`,
  }));
  return rows;
}

function renderTable() {
  if (!state.holdings || !state.changes) return;
  const holdingsView = state.view === 'holdings';
  $('#table-head').innerHTML = holdingsView
    ? '<tr><th>股票代碼</th><th>股票名稱</th><th class="number">權重</th><th class="number">股數</th></tr>'
    : '<tr><th>類型</th><th>股票代碼</th><th>股票名稱</th><th class="number">目前權重</th><th class="number">變化（百分點）</th></tr>';
  const keyword = $('#search').value.trim().toLocaleLowerCase();
  const rows = (holdingsView ? holdingRows() : changeRows()).filter((row) =>
    row.searchable.toLocaleLowerCase().includes(keyword)
  );
  $('#table-body').innerHTML = rows.map((row) => row.html).join('');
  $('#empty').hidden = rows.length > 0;
}

async function start() {
  try {
    await adapter.init();
    state.dashboard = await adapter.dashboard();
    $('#delivery-note').textContent = adapter.notice();
    if (adapter.publicOnly) {
      state.view = 'changes';
      document.querySelector('[data-view="holdings"]').hidden = true;
      document.querySelector('[data-view="holdings"]').classList.remove('active');
      document.querySelector('[data-view="holdings"]').setAttribute('aria-selected', 'false');
      document.querySelector('[data-view="changes"]').classList.add('active');
      document.querySelector('[data-view="changes"]').setAttribute('aria-selected', 'true');
      $('#date-label').textContent = '公開報告日';
    }
    $('#business-date').textContent = state.dashboard.business_date;
    $('#trade-date').textContent = `行情交易日 ${state.dashboard.price_trade_date}`;
    renderCards();
    if (!state.dashboard.etfs.length) { setStatus('此快照沒有可用資料。'); return; }
    const route = new URLSearchParams(location.hash.slice(1));
    const code = route.get('code') || state.dashboard.etfs[0].etf_code;
    if (!state.dashboard.etfs.some(x => x.etf_code === code)) throw new Error('此 ETF 未匯出');
    await selectETF(code, route.get('date'));
    setInterval(() => { $('#delivery-note').textContent = adapter.notice(); }, 15000);
  } catch (error) {
    setStatus(error.message, true);
  }
}

$('#source-date').addEventListener('change', (event) => selectETF(state.selectedCode, event.target.value));
$('#search').addEventListener('input', renderTable);
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderTable();
  });
});

start();

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'select_etf_view', title: '選擇 ETF 查詢日期',
      description: '切換本頁已可用的 ETF 與日期，不採集、不寫入、不發布資料。私人版日期為來源日，公開版為報告日。',
      inputSchema: {type: 'object', properties: {code: {type: 'string'}, date: {type: 'string'}}, required: ['code'], additionalProperties: false},
      annotations: {readOnlyHint: false, untrustedContentHint: true},
      async execute(input) {
        if (!input || Object.keys(input).some(k => !['code', 'date'].includes(k)) || typeof input.code !== 'string' || (input.date !== undefined && (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date))) || !state.dashboard?.etfs.some(x => x.etf_code === input.code)) throw new Error('ETF 或日期不在可查詢範圍');
        const dates = await adapter.dates(input.code);
        if (input.date && !dates.source_dates.includes(input.date)) throw new Error('日期未匯出');
        if (!await selectETF(input.code, input.date)) throw new Error('讀取失敗，保留上次內容');
        return {code: state.selectedCode, date: state.selectedDate, summary: state.changes.summary};
      }
    }, {signal: lifecycle.signal})).catch(() => {});
  } catch { /* Optional browser integration; ordinary UI remains available. */ }
}
