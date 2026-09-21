const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const check=(value,message)=>{if(!value)throw Error(message);};
export function validate(v, audience) {
  check(v?.schema_version==='research-delivery/1'&&v.audience===audience,'受眾或格式不符');
  check(['private','public','offline'].includes(audience),'受眾無效');
  check(v.data_class===({private:'private-projection',public:'allowlist',offline:'synthetic'})[audience],'資料類別不符');
  check(/^[a-f0-9]{64}$/.test(v.sourceDigest),'程式來源識別無效');
  check(Number.isFinite(Date.parse(v.sourceObservedAt))&&Number.isFinite(Date.parse(v.generatedAt)),'時間無效');
  check(Array.isArray(v.notes)&&v.notes.length<=1000&&v.stats.notes===v.notes.length,'筆記清單無效');
  const ids=new Set();
  for(const n of v.notes){check(/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(n.id)&&!ids.has(n.id),'筆記 ID 無效');ids.add(n.id);for(const k of ['title','fileName','path','type','status','created','updated','body'])check(typeof n[k]==='string','筆記欄位無效');for(const k of ['tags','aliases','links'])check(Array.isArray(n[k])&&n[k].every(x=>typeof x==='string'),'索引無效');check(Array.isArray(n.headings)&&n.headings.every(h=>Number.isInteger(h.level)&&h.level>=1&&h.level<=6&&typeof h.id==='string'&&/^[\p{Letter}\p{Number}-]*$/u.test(h.id)&&typeof h.text==='string'),'大綱無效');check(Number.isSafeInteger(n.words)&&n.words>=0,'字數無效');}
  check(v.notes.every(n=>n.links.every(id=>ids.has(id))),'連結超出受眾');
  check(v.assets&&typeof v.assets==='object'&&!Array.isArray(v.assets),'附件清單無效');
  for(const [p,h]of Object.entries(v.assets))check(/^assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|pdf)$/.test(p)&&p.split('/')[1].split('.')[0]===h,'附件路徑無效');
  return v;
}
export async function loadVault(fetcher=fetch) {
  const c=await fetcher('./config.json',{cache:'no-store'});check(c.ok,'無法讀取快照設定');
  const config=await c.json();check(config.schema_version==='research-delivery/1'&&/^data\/[a-f0-9]{64}\.json$/.test(config.path)&&config.path===`data/${config.sha256}.json`,'快照路徑無效');
  const r=await fetcher('./'+config.path,{cache:'no-store'});check(r.ok,'無法讀取快照');const bytes=await r.arrayBuffer();check(bytes.byteLength<=12*1024*1024,'快照過大');check(await digest(bytes)===config.sha256,'快照完整性驗證失敗');
  const vault=validate(JSON.parse(new TextDecoder().decode(bytes)),config.audience);
  let total=0;
  for(const [name,sha] of Object.entries(vault.assets)) {
    const asset=await fetcher('./'+name,{cache:'no-store'});check(asset.ok,'附件缺失');const data=await asset.arrayBuffer();total+=data.byteLength;
    check(data.byteLength<=8*1024*1024&&total<=48*1024*1024&&await digest(data)===sha,'附件完整性驗證失敗');
  }
  return vault;
}
export function snapshotAge(v,now=Date.now()) {const age=now-Date.parse(v.sourceObservedAt);return age<0?'時間未驗證':age>45*60*1000?'快照已過期':'快照在 45 分鐘內';}
