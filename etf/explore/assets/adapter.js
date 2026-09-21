// One interface for the existing local API and immutable, verified static shards.
export class DataAdapter {
  constructor() { this.mode = document.documentElement.dataset.mode; this.manifest = null; }
  async json(path, hash = null) {
    const response = await fetch(path, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`讀取失敗（${response.status}）；保留上次成功內容`);
    const bytes = await response.arrayBuffer();
    if (hash) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (digest !== hash) throw new Error('快照完整性驗證失敗；保留上次成功內容');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async init() {
    if (this.mode !== 'static') return;
    const config = await this.json('./config.json');
    if (!['private', 'public'].includes(config.audience) || !/^[a-f0-9]{64}$/.test(config.manifest_hash)) throw new Error('無效的受眾或版本設定');
    const manifest = await this.json('./snapshot.json', config.manifest_hash);
    if (manifest.schema_version !== 'etf-delivery/1' || manifest.audience !== config.audience || !['private-holdings', 'public-changes'].includes(manifest.kind) || (manifest.audience === 'public' && manifest.kind !== 'public-changes')) throw new Error('快照格式或受眾不符');
    this.manifest = manifest;
  }
  async shard(key) {
    const item = this.manifest.files[key];
    if (!item || !/^data\/[a-f0-9]{64}\.json$/.test(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('此日期未匯出；不會回退至其他日期');
    return this.json('./' + item.path, item.sha256);
  }
  async dashboard() { return this.manifest ? this.manifest.dashboard : this.json('/api/v1/dashboard'); }
  dates(code) { return this.manifest ? Promise.resolve({source_dates: this.manifest.dates[code] || []}) : this.json(`/api/v1/etfs/${encodeURIComponent(code)}/dates`); }
  async detail(code, date) {
    if (this.manifest) {
      const result = await this.shard(`${code}/${date}`);
      const h = result?.holdings, c = result?.changes;
      if (h?.etf_code !== code || c?.etf_code !== code || h.source_date !== c.to_source_date || (!this.publicOnly && h.source_date !== date) || !Array.isArray(h.holdings) || typeof h.disclosure_scope !== 'string' || !c.summary || !['added','removed','changed'].every(k => Array.isArray(c[k]) && Number.isInteger(c.summary[k]) && c.summary[k] === c[k].length) || (this.publicOnly && h.holdings.length)) throw new Error('快照內容格式不符；保留上次成功內容');
      return result;
    }
    const [holdings, changes] = await Promise.all([
      this.json(`/api/v1/etfs/${encodeURIComponent(code)}/holdings?date=${encodeURIComponent(date)}`),
      this.json(`/api/v1/etfs/${encodeURIComponent(code)}/changes?to=${encodeURIComponent(date)}`),
    ]);
    return {holdings, changes};
  }
  get publicOnly() { return this.manifest?.kind === 'public-changes'; }
  notice() {
    if (!this.manifest) return '本機唯讀資料庫；瀏覽不會觸發採集或發布。';
    const m = this.manifest, age = Date.now() - Date.parse(m.source_observed_at);
    const freshness = !Number.isFinite(age) || age < 0 ? '摘要時間未驗證' : age > 86400000 ? '匯出快照已超過 24 小時' : '已保存快照（非即時行情）';
    return `${m.data_class === 'synthetic' ? '合成示範，非真實行情。' : ''}${freshness}；觀測 ${m.source_observed_at}，匯出 ${m.generated_at}。${m.kind === 'public-changes' ? '僅公開每日變化；日期選單為報告日，不含完整持股。' : `每檔最多 ${m.coverage.limit} 個來源日，窗口外日期未匯出。`} 字卡行情固定於上方交易日；不會自動同步。`;
  }
}
