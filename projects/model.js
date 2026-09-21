'use strict';
(function(root) {
  function sorted(v) { if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(sorted);return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])); }
  const canonical=v=>JSON.stringify(sorted(v));
  const stamp=v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
  function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error('欄位不符');}
  function record(v,spec){exact(v,Object.keys(spec));for(const[k,kind]of Object.entries(spec)){const x=v[k];if(x===null)continue;const ok=kind==='time'?Number.isFinite(stamp(x)):kind==='count'?Number.isSafeInteger(x)&&x>=0&&x<=1e9:kind==='bool'?typeof x==='boolean':typeof x==='string'&&(kind==='code'?/^[a-z][a-z0-9_-]{0,79}$/.test(x):kind==='id'?/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(x):x.length<=240&&!/[\u0000-\u001f]/.test(x));if(!ok)throw Error('欄位型別不符');}}
  function records(v,spec,max){if(!Array.isArray(v)||v.length>max)throw Error('集合不符');v.forEach(x=>record(x,spec));}
  const JOB={id:'id',owner:'id',enabled:'bool',status:'code',notification_status:'code',last_attempt_at:'time',last_success_at:'time',next_due_at:'time',daily_failures:'count',missed_count:'count',source_freshness:'code',data_status:'code',publish_status:'code',skip_reason:'code'};
  async function verify(s,audience){
    exact(s,['schema_version','snapshot_id','audience','data_class','source_observed_at','generated_at','expires_at','content_hash','coverage','payload']);
    if(s.schema_version!=='1.1'||s.audience!==audience||!['private','public'].includes(audience)||!['synthetic','private-projection'].includes(s.data_class)||(audience==='public'&&s.data_class!=='synthetic')||!/^management-[0-9a-f]{24}$/.test(s.snapshot_id))throw Error('版本或受眾不符');
    const times=[s.source_observed_at,s.generated_at,s.expires_at].map(stamp);if(!times.every(Number.isFinite)||times[0]>times[1]||times[2]<=times[0])throw Error('時間無效');
    exact(s.coverage,['start','end','truncated']);if(typeof s.coverage.truncated!=='boolean'||!(stamp(s.coverage.start)<=stamp(s.coverage.end)&&stamp(s.coverage.end)<=times[0]))throw Error('涵蓋範圍無效');
    const p=s.payload;exact(p,['kind','scheduler','projects','maintenance']);if(p.kind!=='management/v1')throw Error('內容不符');
    exact(p.scheduler,['status','heartbeat_at','jobs']);record({status:p.scheduler.status,heartbeat_at:p.scheduler.heartbeat_at},{status:'code',heartbeat_at:'time'});records(p.scheduler.jobs,JOB,200);records(p.projects,{id:'id',role:'text',policy:'code'},100);
    exact(p.maintenance,['inventory','versions']);record(p.maintenance.inventory,{observed_at:'time',project_count:'count',warnings:'count'});
    const v=p.maintenance.versions;exact(v,['observed_at','checked','unverified','dependencies']);record({observed_at:v.observed_at,checked:v.checked,unverified:v.unverified},{observed_at:'time',checked:'count',unverified:'count'});records(v.dependencies,{project:'id',ecosystem:'code',name:'text',declared:'text',latest:'text',check:'code'},1000);
    const{content_hash,...unsigned}=s;const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(unsigned))));if(content_hash!=='sha256:'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''))throw Error('快照完整性不符');return s;
  }
  function schedulerStatus(s,now){const h=stamp(s.payload.scheduler.heartbeat_at);if(!Number.isFinite(h)||now<h||now<stamp(s.source_observed_at))return'unverified';if(now-h>=90000||now>=stamp(s.expires_at))return'stale';return s.payload.scheduler.status||'unverified';}
  function reportStatus(time,days,now){const t=stamp(time);return!Number.isFinite(t)||t>now?'unverified':now-t>days*86400000?'stale':'success';}
  const api={verify,canonical,schedulerStatus,reportStatus,stamp};root.DashboardModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
