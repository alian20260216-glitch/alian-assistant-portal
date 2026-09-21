const state = { source: "google", range: "24h", entity: "", meta: null };
let adapter = null, requestSequence = 0;
const colors = ["#197456", "#FF8B72", "#C7A51F", "#6F9C8E", "#D16C57", "#89BFA5", "#9A7A2A", "#66756F"];

const el = (id) => document.getElementById(id);
const formatTime = (value, includeDate = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: includeDate ? "2-digit" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Taipei",
  }).format(date);
};

function startClock() {
  const update = () => { el("clock").textContent = new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Taipei",
  }).format(new Date()); };
  update(); setInterval(update, 1000);
}

function renderSourceTabs() {
  el("sourceTabs").innerHTML = state.meta.sources.map((source) => `
    <button class="source-tab" type="button" role="tab" data-source="${escapeHtml(source.id)}"
      aria-selected="${source.id === state.source}" ${source.available ? "" : "disabled"}>
      ${escapeHtml(source.label)}
    </button>`).join("");
  el("sourceTabs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    void loadData({source: button.dataset.source, range: state.range, entity: ""});
  }));
}

function currentSourceMeta() { return state.meta.sources.find((source) => source.id === state.source); }

function renderEntityOptions() {
  const source = currentSourceMeta();
  el("entitySelect").innerHTML = `<option value="">全部項目</option>${source.entities.map((item) =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("")}`;
  el("entitySelect").value = state.entity;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
}

function renderHealth() {
  if (!state.meta) return;
  el("sourceHealth").innerHTML = state.meta.sources.map((source) => {
    const age = TrafficAdapter.freshness(source.last_updated);
    const fresh = source.available && age.fresh;
    const freshness = !source.available ? "匯出時無法讀取" : age.label;
    const width = fresh ? Math.max(12, 100 - Math.min(age.minutes || 0, 720) / 7.2) : 0;
    return `<div class="health-row">
      <div class="health-title"><strong>${escapeHtml(source.label)}</strong><span class="health-badge ${fresh ? "" : "stale"}">${fresh ? "3 小時內" : "注意"}</span></div>
      <div class="health-bar"><i style="width:${width}%"></i></div>
      <div class="health-meta"><span>${freshness}</span><span>${(source.total_records || 0).toLocaleString("zh-TW")} 筆</span></div>
      <small>${escapeHtml(formatTime(source.last_updated, true))} · 不代表 API 健康</small>
    </div>`;
  }).join("");
}

function renderMetrics(metrics) {
  el("metricGrid").innerHTML = metrics.map((metric) => `
    <article class="metric-card">
      <p>${escapeHtml(metric.label)}</p>
      <strong>${metric.value == null ? "—" : escapeHtml(metric.value)}<span>${escapeHtml(metric.unit)}</span></strong>
      <small title="${escapeHtml(metric.detail)}">${escapeHtml(metric.detail)}</small>
    </article>`).join("");
}

function renderTable(table, count) {
  el("tableHead").innerHTML = `<tr>${table.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr>`;
  el("recordCaption").textContent = `篩選結果 ${count.toLocaleString("zh-TW")} 筆`;
  el("tableBody").innerHTML = table.rows.length ? table.rows.map((row) => `<tr>${row.map((cell, index) =>
    `<td>${escapeHtml(index === 0 ? formatTime(cell, true) : cell)}</td>`).join("")}</tr>`).join("") :
    `<tr><td colspan="${Math.max(1, table.columns.length)}" class="empty-cell">這個範圍目前沒有資料</td></tr>`;
}

function nearestIndex(values, target) {
  let low = 0, high = values.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(values[low - 1] - target) <= Math.abs(values[low] - target)) return low - 1;
  return low;
}

function closestPoint(points, target) {
  if (!points.length) return null;
  let low = 0, high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].time < target) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(points[low - 1].time - target) <= Math.abs(points[low].time - target)) {
    return points[low - 1];
  }
  return points[low];
}

function formatTooltipTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "long", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function renderChart(chart) {
  el("chartTitle").textContent = chart.title;
  el("chartLegend").innerHTML = chart.series.map((series, index) => `<span class="legend-item"><i class="legend-swatch" style="background:${colors[index % colors.length]}"></i>${escapeHtml(series.name)}</span>`).join("");
  const parsedSeries = chart.series.map((series, index) => ({
    name: series.name,
    color: colors[index % colors.length],
    points: series.points.map((point) => ({...point, time: new Date(point.t).getTime()}))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.v))
      .sort((a, b) => a.time - b.time),
  }));
  const points = parsedSeries.flatMap((series) => series.points);
  if (!points.length) { el("chart").innerHTML = '<div class="empty-state">這個範圍目前沒有趨勢資料</div>'; return; }
  const width = 960, height = 330, pad = {left: 55, right: 18, top: 18, bottom: 40};
  const minTime = Math.min(...points.map((p) => p.time));
  const maxTime = Math.max(...points.map((p) => p.time));
  const rawMin = Math.min(...points.map((p) => p.v));
  const rawMax = Math.max(...points.map((p) => p.v));
  const span = Math.max(1, rawMax - rawMin);
  const minValue = Math.max(0, rawMin - span * .12), maxValue = rawMax + span * .12;
  const x = (time) => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - minValue) / Math.max(1, maxValue - minValue)) * (height - pad.top - pad.bottom);
  const ticks = Array.from({length: 5}, (_, index) => minValue + (maxValue - minValue) * index / 4);
  const grid = ticks.map((tick) => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="axis-label" x="${pad.left - 9}" y="${y(tick) + 4}" text-anchor="end">${tick.toFixed(tick >= 100 ? 0 : 1)}</text>`).join("");
  const dateTicks = Array.from({length: 5}, (_, index) => minTime + (maxTime - minTime) * index / 4);
  const labels = dateTicks.map((tick, index) => `<text class="axis-label" x="${x(tick)}" y="${height - 10}" text-anchor="${index === 0 ? "start" : index === dateTicks.length - 1 ? "end" : "middle"}">${formatTime(new Date(tick).toISOString(), state.range !== "24h")}</text>`).join("");
  const lines = parsedSeries.map((series) => {
    if (!series.points.length) return "";
    const path = series.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.time).toFixed(1)},${y(point.v).toFixed(1)}`).join(" ");
    const last = series.points[series.points.length - 1];
    return `<path class="trend-line" d="${path}" stroke="${series.color}"/><circle class="point" cx="${x(last.time)}" cy="${y(last.v)}" r="4.5" fill="${series.color}"><title>${escapeHtml(series.name)}：${last.v} ${escapeHtml(chart.unit)}</title></circle>`;
  }).join("");
  const sampleTimes = [...new Set(points.map((point) => Math.floor(point.time / 60000) * 60000))].sort((a, b) => a - b);
  const chartElement = el("chart");
  chartElement.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" tabindex="0"
      aria-label="${escapeHtml(chart.title)}，單位 ${escapeHtml(chart.unit)}。使用左右方向鍵查看各時間資料。">
      ${grid}${labels}${lines}
      <line class="hover-line" x1="0" x2="0" y1="${pad.top}" y2="${height - pad.bottom}" visibility="hidden"/>
      <g class="hover-points"></g>
      <rect class="chart-interaction-layer" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${height - pad.top - pad.bottom}"/>
    </svg>
    <div class="chart-tooltip" role="tooltip" hidden></div>`;
  chartElement.setAttribute("aria-label", `${chart.title}，單位 ${chart.unit}，共 ${points.length} 個資料點`);

  const svg = chartElement.querySelector("svg");
  const hoverLine = chartElement.querySelector(".hover-line");
  const hoverPoints = chartElement.querySelector(".hover-points");
  const tooltip = chartElement.querySelector(".chart-tooltip");
  let selectedIndex = sampleTimes.length - 1;

  const hideTooltip = () => {
    tooltip.hidden = true;
    hoverLine.setAttribute("visibility", "hidden");
    hoverPoints.innerHTML = "";
  };

  const showTooltip = (index) => {
    selectedIndex = Math.max(0, Math.min(sampleTimes.length - 1, index));
    const sampleTime = sampleTimes[selectedIndex];
    const visible = parsedSeries.map((series) => ({series, point: closestPoint(series.points, sampleTime)}))
      .filter(({point}) => point && Math.abs(point.time - sampleTime) <= 75000);
    if (!visible.length) return;

    const lineX = Math.max(pad.left, Math.min(width - pad.right, x(sampleTime)));
    hoverLine.setAttribute("x1", lineX);
    hoverLine.setAttribute("x2", lineX);
    hoverLine.setAttribute("visibility", "visible");
    hoverPoints.innerHTML = visible.map(({series, point}) =>
      `<circle class="hover-point" cx="${x(point.time)}" cy="${y(point.v)}" r="5" fill="${series.color}"/>`).join("");
    tooltip.innerHTML = `
      <strong>${formatTooltipTime(sampleTime)}</strong>
      <div class="tooltip-values">${visible.map(({series, point}) => `
        <div class="tooltip-row">
          <span class="tooltip-name"><i style="background:${series.color}"></i>${escapeHtml(series.name)}</span>
          <b>${escapeHtml(point.v)} <small>${escapeHtml(chart.unit)}</small></b>
        </div>`).join("")}</div>`;
    tooltip.hidden = false;

    const svgRect = svg.getBoundingClientRect();
    const chartRect = chartElement.getBoundingClientRect();
    const pixelX = svgRect.left - chartRect.left + (lineX / width) * svgRect.width;
    tooltip.style.top = "16px";
    if (pixelX > chartRect.width / 2) {
      tooltip.style.left = "auto";
      tooltip.style.right = `${Math.max(12, chartRect.width - pixelX + 14)}px`;
    } else {
      tooltip.style.right = "auto";
      tooltip.style.left = `${Math.max(12, pixelX + 14)}px`;
    }
  };

  const showFromPointer = (event) => {
    const rect = svg.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * width;
    const boundedX = Math.max(pad.left, Math.min(width - pad.right, viewX));
    const targetTime = minTime + ((boundedX - pad.left) / (width - pad.left - pad.right)) * (maxTime - minTime);
    showTooltip(nearestIndex(sampleTimes, targetTime));
  };

  svg.addEventListener("pointermove", showFromPointer);
  svg.addEventListener("pointerdown", showFromPointer);
  svg.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") hideTooltip(); });
  svg.addEventListener("focus", () => showTooltip(selectedIndex));
  svg.addEventListener("blur", hideTooltip);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showTooltip(selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Escape") hideTooltip();
  });
}

function showToast(message) {
  el("toast").textContent = message; el("toast").classList.add("show");
  window.setTimeout(() => el("toast").classList.remove("show"), 2200);
}

function renderSnapshotNote() {
  if (!adapter) return;
  const meta = state.meta;
  if (adapter.mode === "api") {
    el("snapshotNote").textContent = "本機唯讀查詢；重新讀取不會採集交通資料。Google 是行程預估，TomTom／TDX 是道路路段，不能當成同一行程比較。";
    return;
  }
  const age = TrafficAdapter.freshness(meta.reference_time);
  el("snapshotNote").textContent = `${meta.data_class === "synthetic" ? "合成示範資料，非真實交通。" : "私人已保存快照。"}時間窗口固定於 ${formatTime(meta.reference_time, true)}（台北時間）；${age.fresh ? "" : "快照已過期或時間未驗證；"}不會自動同步，重新讀取不會採集或更新來源。Google 是完整行程預估；TomTom／TDX 是原生道路路段。`;
}

async function loadData(selection = {source: state.source, range: state.range, entity: state.entity}, refresh = false) {
  const request = ++requestSequence;
  const button = el("refreshButton"); button.disabled = true;
  el("loadStatus").textContent = "正在讀取；完成驗證後才切換畫面…";
  try {
    const candidate = refresh || !adapter ? await TrafficAdapter.open(document.documentElement.dataset.mode) : adapter;
    if (!adapter && !candidate.meta.sources.find(s => s.id === selection.source && s.available)) {
      selection = {...selection, source: candidate.meta.sources.find(s => s.available)?.id, entity: ""};
    }
    const data = await candidate.load(selection.source, selection.range, selection.entity);
    if (request !== requestSequence) return false;
    adapter = candidate;
    Object.assign(state, selection, {meta: candidate.meta});
    renderSourceTabs(); renderEntityOptions(); renderHealth(); renderSnapshotNote();
    el("rangeSelect").value = state.range;
    el("sourceTitle").textContent = data.label;
    el("lastUpdated").textContent = `最後資料：${formatTime(data.last_updated, true)} · 台北時間`;
    renderMetrics(data.metrics); renderChart(data.chart); renderTable(data.table, data.record_count);
    const c = data.coverage;
    el("coverageNote").textContent = c ? `符合 ${c.matched_count.toLocaleString()} 筆，計算採用最新 ${c.returned_count.toLocaleString()} 筆（上限 ${c.row_limit.toLocaleString()}${c.truncated ? "，已截斷" : ""}）；${c.returned_first ? `${formatTime(c.returned_first, true)} — ${formatTime(c.returned_last, true)}` : "無觀測"}。趨勢最多 ${c.series_limit} 條${c.series_count > c.series_limit ? `（共 ${c.series_count} 條，請選單一項目）` : ""}；表格只列最新 ${c.table_limit} 筆。「全部」亦受展示上限限制。` : "最多 5,000 筆、8 條趨勢線、最新 12 筆表格。";
    el("loadStatus").textContent = data.record_count ? "已載入；數值僅代表目前選擇的展示範圍。" : "此範圍沒有觀測資料。";
    el("systemStatus").textContent = adapter.mode === "static" ? "靜態快照 · 非即時" : "本機唯讀查詢";
    history.replaceState(null, "", "#" + new URLSearchParams(selection));
    if (refresh) showToast("已重新讀取；未觸發採集或同步");
    return true;
  } catch (error) {
    if (request !== requestSequence) return false;
    el("loadStatus").textContent = `${error.message}。${adapter ? "仍顯示先前成功結果。" : "沒有已驗證資料。"}`;
    if (adapter) { renderSourceTabs(); renderEntityOptions(); }
    else { el("chart").innerHTML = '<div class="empty-state">無法載入快照</div>'; el("metricGrid").innerHTML = ""; el("tableBody").innerHTML = ""; }
    el("rangeSelect").value = state.range;
    el("systemStatus").textContent = "資料讀取異常";
    return false;
  } finally { if (request === requestSequence) button.disabled = false; }
}

async function initialize() {
  startClock();
  const hash = new URLSearchParams(location.hash.slice(1));
  await loadData({source: hash.get("source") || "google", range: hash.get("range") || "24h", entity: hash.get("entity") || ""});
  setInterval(() => {renderHealth(); renderSnapshotNote();}, 15000);
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  addEventListener("pagehide", () => lifecycle.abort(), {once: true});
  try {
    await context.registerTool({name: "select_traffic_view", title: "切換交通觀測畫面",
      description: "切換目前頁面來源、時間範圍與監測項目；不採集、不寫入、不發布資料。entity 需為目前選單的 id，空字串表示全部。",
      inputSchema: {type: "object", properties: {source: {type: "string", enum: ["google", "tomtom", "tdx"]}, range: {type: "string", enum: ["24h", "7d", "30d", "all"]}, entity: {type: "string"}}, required: ["source", "range"], additionalProperties: false},
      annotations: {readOnlyHint: false, untrustedContentHint: true},
      async execute(input) {
        if (!adapter || !input || Object.keys(input).some(k => !["source", "range", "entity"].includes(k))) throw new Error("無效輸入");
        const selection = {source: input.source, range: input.range, entity: input.entity || ""};
        TrafficAdapter.validateSelection(state.meta, selection.source, selection.range, selection.entity);
        if (!await loadData(selection)) throw new Error("讀取失敗，未切換畫面");
        return {...selection, caption: el("recordCaption").textContent};
      }}, {signal: lifecycle.signal});
  } catch { /* Optional browser capability; ordinary controls remain available. */ }
}

el("entitySelect").addEventListener("change", event => { void loadData({source: state.source, range: state.range, entity: event.target.value}); });
el("rangeSelect").addEventListener("change", event => { void loadData({source: state.source, range: event.target.value, entity: state.entity}); });
el("refreshButton").addEventListener("click", () => { void loadData(undefined, true); });

initialize();
