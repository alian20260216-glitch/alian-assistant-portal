/* Same-origin API or immutable, hash-verified static snapshots. No fallback. */
(function (scope) {
  "use strict";
  const sources = ["google", "tomtom", "tdx"], ranges = ["24h", "7d", "30d", "all"];
  const fail = () => { throw new Error("快照格式或完整性驗證失敗"); };
  const isTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
  const digest = async bytes => Array.from(new Uint8Array(await scope.crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  async function read(url, fetcher, hash) {
    const response = await fetcher(url, {cache: "no-store"});
    if (!response.ok) throw new Error("資料讀取失敗；保留上一份畫面");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 4 * 1024 * 1024) fail();
    if (hash && await digest(bytes) !== hash) fail();
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function freshness(timestamp, now = Date.now()) {
    const age = (now - Date.parse(timestamp)) / 60000;
    if (!timestamp || !Number.isFinite(age)) return {label: "尚無可驗證時間", fresh: false, minutes: null};
    if (age < -1) return {label: "未來時間，未驗證", fresh: false, minutes: null};
    return {label: age < 60 ? `${Math.max(0, Math.floor(age))} 分鐘前` : `${(age / 60).toFixed(1)} 小時前`, fresh: age <= 180, minutes: age};
  }
  function validateMeta(meta) {
    if (!Array.isArray(meta.sources) || meta.sources.length !== 3 || new Set(meta.sources.map(s => s.id)).size !== 3) fail();
    for (const source of meta.sources) {
      if (!sources.includes(source.id) || typeof source.available !== "boolean" || !Array.isArray(source.entities) || source.entities.length > 100) fail();
      if (source.entities.some(e => typeof e.id !== "string" || typeof e.label !== "string")) fail();
    }
    return meta;
  }
  function validateSelection(meta, source, range, entity) {
    const item = meta.sources.find(s => s.id === source && s.available);
    if (!item || !ranges.includes(range) || (entity && !item.entities.some(e => e.id === entity))) throw new Error("來源、時間範圍或監測項目無效");
  }
  function validateData(data) {
    if (!Array.isArray(data.metrics) || data.metrics.length !== 4 || data.metrics.some(m => m.value !== null && !Number.isFinite(m.value))) fail();
    if (!Array.isArray(data.chart?.series) || data.chart.series.length > 8 || !Array.isArray(data.table?.rows) || data.table.rows.length > 12 || data.table.columns?.length !== 6) fail();
    if (data.table.rows.some(row => !Array.isArray(row) || row.length !== 6 || row.some(v => v !== null && !["string", "number"].includes(typeof v)))) fail();
    if (!Number.isInteger(data.record_count) || data.record_count < 0 || data.record_count > 5000) fail();
    return data;
  }
  async function open(mode, fetcher = scope.fetch.bind(scope)) {
    if (mode === "api") {
      const meta = validateMeta(await read("/api/meta", fetcher));
      return {meta, mode, async load(source, range, entity = "") {
        validateSelection(meta, source, range, entity);
        const query = new URLSearchParams({source, range, entity});
        return validateData(await read(`/api/data?${query}`, fetcher));
      }};
    }
    if (mode !== "static") fail();
    const config = await read("./config.json", fetcher);
    if (!["private", "public"].includes(config.audience) || !/^[a-f0-9]{64}$/.test(config.manifest_hash)) fail();
    const meta = validateMeta(await read("./snapshot.json", fetcher, config.manifest_hash));
    if (meta.schema_version !== "traffic-delivery/1" || meta.audience !== config.audience || !isTime(meta.reference_time) || !isTime(meta.generated_at)) fail();
    if (!["synthetic", "private-projection"].includes(meta.data_class) || (meta.audience === "public" && meta.data_class !== "synthetic")) fail();
    const cache = new Map();
    async function file(ref) {
      if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256) || ref.path !== `data/${ref.sha256}.json`) fail();
      if (!cache.has(ref.path)) cache.set(ref.path, read("./" + ref.path, fetcher, ref.sha256).catch(error => {cache.delete(ref.path); throw error;}));
      return cache.get(ref.path);
    }
    return {meta, mode, async load(source, range, entity = "") {
      validateSelection(meta, source, range, entity);
      const raw = await file(meta.views?.[source]?.[range]?.[entity || "all"]);
      if (raw.source !== source || raw.range !== range || raw.entity !== entity || raw.reference_time !== meta.reference_time) fail();
      validateData(raw);
      const series = [];
      let total = 0;
      for (const item of raw.chart.series) {
        if (!Array.isArray(item.chunks) || item.chunks.length > 1000) fail();
        const points = [];
        // Bounded batches keep large all-range views from flooding the host.
        for (let start = 0; start < item.chunks.length; start += 8) {
          for (const chunk of await Promise.all(item.chunks.slice(start, start + 8).map(file))) {
            if (!Array.isArray(chunk) || chunk.length > 256 || chunk.some(p => !isTime(p.t) || !Number.isFinite(p.v))) fail();
            total += chunk.length;
            if (total > 5000) fail();
            points.push(...chunk);
          }
        }
        series.push({name: item.name, points});
      }
      return {...raw, chart: {...raw.chart, series}};
    }};
  }
  scope.TrafficAdapter = {open, freshness, validateSelection};
})(globalThis);
