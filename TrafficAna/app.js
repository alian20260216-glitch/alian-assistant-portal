const state = { source: "google", range: "7d", entity: "", meta: null, snapshot: null };
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

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "資料讀取失敗");
  return payload;
}

function renderSourceTabs() {
  el("sourceTabs").innerHTML = state.meta.sources.map((source) => `
    <button class="source-tab" type="button" role="tab" data-source="${source.id}"
      aria-selected="${source.id === state.source}" ${source.available ? "" : "disabled"}>
      ${source.label}
    </button>`).join("");
  el("sourceTabs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.source = button.dataset.source; state.entity = "";
    renderSourceTabs(); renderEntityOptions(); loadData();
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
  el("sourceHealth").innerHTML = state.meta.sources.map((source) => {
    const fresh = source.available && source.freshness_minutes != null && source.freshness_minutes <= 180;
    const freshness = !source.available ? "無法讀取" : source.freshness_minutes == null ? "尚無資料" :
      source.freshness_minutes < 60 ? `${Math.round(source.freshness_minutes)} 分鐘前` : `${(source.freshness_minutes / 60).toFixed(1)} 小時前`;
    const width = source.available ? Math.max(12, 100 - Math.min(source.freshness_minutes || 0, 720) / 7.2) : 0;
    return `<div class="health-row">
      <div class="health-title"><strong>${escapeHtml(source.label)}</strong><span class="health-badge ${fresh ? "" : "stale"}">${fresh ? "資料正常" : "注意"}</span></div>
      <div class="health-bar"><i style="width:${width}%"></i></div>
      <div class="health-meta"><span>快照建立時 ${freshness}</span><span>七天 ${(source.record_count || 0).toLocaleString("zh-TW")} 筆</span></div>
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
    `<td>${index === 0 ? formatTime(cell, true) : escapeHtml(cell)}</td>`).join("")}</tr>`).join("") :
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
  const labels = dateTicks.map((tick) => `<text class="axis-label" x="${x(tick)}" y="${height - 10}" text-anchor="middle">${formatTime(new Date(tick).toISOString(), state.range !== "24h")}</text>`).join("");
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

async function loadData(showConfirmation = false) {
  const button = el("refreshButton"); button.disabled = true;
  el("chart").innerHTML = '<div class="chart-loading">正在整理趨勢資料…</div>';
  try {
    const sourceData = state.snapshot.data[state.source];
    const data = sourceData[state.entity || "__all__"];
    if (!data) throw new Error("找不到這個監測項目的快照資料");
    el("sourceTitle").textContent = data.label;
    el("lastUpdated").textContent = `最後資料：${formatTime(data.last_updated, true)} · 台北時間｜快照：${formatTime(state.snapshot.generated_at, true)}`;
    renderMetrics(data.metrics); renderChart(data.chart); renderTable(data.table, data.record_count);
    if (showConfirmation) showToast("已重新載入七日快照");
  } catch (error) {
    el("chart").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    el("systemStatus").textContent = "資料讀取異常";
    document.querySelector(".live-dot").classList.remove("is-live");
  } finally { button.disabled = false; }
}

async function initialize() {
  startClock();
  try {
    state.snapshot = await fetchJson("snapshot.json");
    state.meta = {sources: state.snapshot.sources};
    const available = state.meta.sources.find((source) => source.available);
    if (!available) throw new Error("沒有可讀取的快照資料");
    if (!currentSourceMeta()?.available) state.source = available.id;
    renderSourceTabs(); renderEntityOptions(); renderHealth();
    el("windowLabel").textContent = `${state.snapshot.window.label}｜截至 ${formatTime(state.snapshot.generated_at, true)}`;
    el("systemStatus").textContent = "七日靜態快照";
    document.querySelector(".live-dot").classList.add("is-live");
    await loadData();
  } catch (error) {
    el("systemStatus").textContent = error.message;
    el("chart").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

el("entitySelect").addEventListener("change", (event) => { state.entity = event.target.value; loadData(); });
el("refreshButton").addEventListener("click", async () => {
  try {
    state.snapshot = await fetchJson(`snapshot.json?v=${Date.now()}`);
    state.meta = {sources: state.snapshot.sources};
    const entityStillExists = currentSourceMeta().entities.some((item) => item.id === state.entity);
    if (!entityStillExists) state.entity = "";
    el("windowLabel").textContent = `${state.snapshot.window.label}｜截至 ${formatTime(state.snapshot.generated_at, true)}`;
    renderEntityOptions(); renderHealth(); await loadData(true);
  } catch (error) {
    showToast(error.message);
  }
});

initialize();
