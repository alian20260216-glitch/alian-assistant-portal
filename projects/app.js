const $=id=>document.getElementById(id);
const labels={healthy:'正常運作',paused:'排程暫停',stale:'摘要過期',unverified:'未驗證',success:'完成',skipped:'略過',partial:'部分完成',failed:'失敗',uncertain:'結果不確定',timeout_uncertain:'逾時／結果未確認',interrupted_uncertain:'中斷／結果未確認',pending:'等待執行',running:'執行中',missed:'漏槽',skipped_disabled:'已停用',skipped_overlap:'工作重疊',skipped_coalesced:'已合併',sent:'已送出',sending:'傳送中',fresh:'來源已檢查',updated:'已更新',queried:'已查詢',unchanged:'無變更',pushed_unverified:'已推送／部署未驗證',published:'已發布',not_applicable:'不適用',managed:'平台管理',on_demand:'人工按需',expected_off:'預期關閉（政策）',event_driven:'事件觸發',design_library:'設計範例庫',test_only:'隔離測試',verified:'已查驗'};
const text=v=>labels[v]||v||'—';
const fmt=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚無紀錄';
function el(tag,value,cls){const n=document.createElement(tag);if(value!=null)n.textContent=value;if(cls)n.className=cls;return n;}
function badge(value){const kind=['healthy','success','sent','fresh','verified'].includes(value)?'good':['failed','uncertain','missed','stale','partial','timeout_uncertain','interrupted_uncertain'].includes(value)?'bad':['running','pending','sending'].includes(value)?'wait':'';return el('span',text(value),'badge '+kind);}
function cell(row,...children){const td=el('td');for(const c of children)td.append(typeof c==='string'?document.createTextNode(c):c);row.append(td);}
function render(data,clock=Date.now()){const s=data.scheduler,jobs=s.jobs;$('connection').replaceChildren(badge(s.status));$('observed').textContent='心跳 '+fmt(s.heartbeat_at);$('project-count').textContent=data.projects.length;$('job-count').textContent=jobs.filter(j=>j.enabled).length;$('failure-count').textContent=jobs.reduce((a,j)=>a+(j.daily_failures||0),0);$('missed-count').textContent=jobs.reduce((a,j)=>a+(j.missed_count||0),0);$('stale-note').textContent=s.status==='stale'?'摘要已過期；下表保留最後觀測結果，不能視為目前健康狀態。':s.status==='unverified'?'尚未取得排程摘要。':'時間：台北。資料新鮮度由來源回報；「未驗證」保留原意。';
 const body=$('jobs-body');body.replaceChildren();for(const j of jobs){const r=el('tr');cell(r,el('strong',j.id),el('small',j.owner));cell(r,badge(j.enabled===false?'skipped_disabled':j.status));cell(r,badge(j.source_freshness),el('small',text(j.data_status)+' / '+text(j.publish_status)));cell(r,badge(j.notification_status));cell(r,fmt(j.last_success_at));cell(r,j.next_due_at?fmt(j.next_due_at):'—',el('small',j.next_due_at&&Date.parse(j.next_due_at)<=clock?'安排時間已過；需較新摘要確認':''));cell(r,`${j.daily_failures||0} / ${j.missed_count||0}`);body.append(r);}if(!jobs.length){const r=el('tr');cell(r,'尚未取得工作清單');r.firstChild.colSpan=7;body.append(r);}
 const grid=$('project-grid');grid.replaceChildren();for(const p of data.projects){const card=el('article',null,'project');card.append(el('h3',p.id),el('p',p.role),badge(p.policy));grid.append(card);}
 if(!data.projects.length)grid.append(el('p','尚無專案資料。'));const reports=$('reports');reports.replaceChildren();for(const [id,title] of [['inventory','每週專案盤點'],['versions','每月版本檢查']]){const report=data.maintenance[id],card=el('article');const outdated=report.observed_at&&(clock-new Date(report.observed_at).getTime())>(id==='inventory'?8:40)*86400000;card.append(el('h3',title),el('p',report.observed_at?'更新於 '+fmt(report.observed_at):'尚未產生報告'),badge(DashboardModel.reportStatus(report.observed_at,id==='inventory'?8:40,clock)));if(report.observed_at)card.append(el('p',id==='inventory'?`${report.project_count} 個專案 · ${report.warnings} 項提醒`:`${report.checked} 項已查驗 · ${report.unverified} 項待查驗`));reports.append(card);}
 const versions=$('versions-body');versions.replaceChildren();for(const d of data.maintenance.versions.dependencies){const row=el('tr');for(const v of [d.project,d.name,d.declared,d.latest])cell(row,v||'—');cell(row,badge(d.check));versions.append(row);}if(!versions.children.length){const r=el('tr');cell(r,'尚未產生版本報告');r.firstChild.colSpan=5;versions.append(r);}
}

const M=DashboardModel;
let config,lastSnapshot,busy=false,readFailed=false;
const clock=()=>config?.reference_time?M.stamp(config.reference_time):Date.now();
function renderSnapshot(s){
 const status=M.schedulerStatus(s,clock());
 render({...s.payload,scheduler:{...s.payload.scheduler,status:readFailed?'unverified':status}},clock());
 $('mode').textContent=config.mode==='live'?'本機即時摘要':config.target==='pages'?'公開示範快照':config.target==='offline'?'本機離線快照':'私人 Sites 快照';
 $('audience').textContent=s.audience==='public'?'公開示範 · 僅合成資料':'私人管理 · 唯讀';
 $('data-note').textContent=(s.data_class==='synthetic'?'合成示範資料，不代表真實專案狀態。':'私人安全摘要；不含業務資料庫、Vault 或憑證。')+(config.reference_time?' 固定測試時鐘：'+fmt(config.reference_time)+'。':'')+(config.mode==='live'?' 每 15 秒讀取本機摘要。':' 靜態快照不會自動同步；Mac 關機後仍可讀最後版本。');
 if(readFailed)$('stale-note').textContent='讀取失敗；保留最後成功快照，下表不能视為目前健康狀態。';
 else if(status==='unverified')$('stale-note').textContent='來源時間缺失、晚於目前時鐘或狀態未驗證。';
 $('snapshot-meta').textContent='摘要讀取 '+fmt(s.source_observed_at)+' · 匯出 '+fmt(s.generated_at)+' · '+s.snapshot_id;
}
async function readJSON(path){
 const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('讀取失敗');const body=await r.text();if(body.length>2000000)throw Error('資料過大');return JSON.parse(body);
}
async function update(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{
  if(!config){const c=await readJSON('./config.json');if(!['offline','sites','pages'].includes(c.target)||!['snapshot','live'].includes(c.mode)||!['private','public'].includes(c.audience)||(c.mode==='live'&&c.target!=='offline'))throw Error('設定無效');if(c.reference_time&&(c.target!=='offline'||!Number.isFinite(M.stamp(c.reference_time))))throw Error('測試時鐘不能部署');config=c;}
  const s=await M.verify(await readJSON(config.mode==='live'?'./api/snapshot':'./snapshot.json'),config.audience);
  if(config.reference_time&&s.data_class!=='synthetic')throw Error('真實資料不能使用測試時鐘');
  lastSnapshot=s;readFailed=false;$('error').hidden=true;renderSnapshot(s);
 }catch{
  readFailed=true;$('error').hidden=false;$('error').textContent='無法讀取有效快照（連線、版本、受眾或完整性檢查失敗）。不會改連其他資料來源。';
  if(lastSnapshot)renderSnapshot(lastSnapshot);else $('connection').replaceChildren(badge('unverified'));
 }finally{busy=false;$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',update);
update();setInterval(()=>{if(config?.mode==='live')update();else if(lastSnapshot)renderSnapshot(lastSnapshot);},15000);
