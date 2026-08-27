// Per-species results rendered inside the original Results column.
(function(){
  'use strict';
  // Keep the original student UI, but make the lower risk-map terminology match
  // what the model actually represents: habitat suitability risk by each factor.
  if (typeof T !== 'undefined') {
    if (T.en && T.en.mapPanel) {
      T.en.mapPanel.forestRiskTitle = 'Forest Cover × Habitat Risk';
      T.en.mapPanel.riskRainfall = 'Rainfall Risk';
      T.en.mapPanel.riskTemperature = 'Temperature Risk';
      T.en.mapPanel.riskDust = 'PM2.5 Risk';
    }
    if (T.th && T.th.mapPanel) {
      T.th.mapPanel.forestRiskTitle = 'พื้นที่ป่าไม้ × ความเสี่ยงต่อถิ่นอาศัย';
      T.th.mapPanel.riskRainfall = 'ความเสี่ยงจากปริมาณฝน';
      T.th.mapPanel.riskTemperature = 'ความเสี่ยงจากอุณหภูมิ';
      T.th.mapPanel.riskDust = 'ความเสี่ยงจาก PM2.5';
    }
  }

  const C={seed:2569,thin:.025,bg:900,min:20,lr:.22,it:180,l2:.025};
  const S={rasters:null,models:[],ran:false,running:false,baseline:{temp:null,rainfall:null,dust:null},timer:null};
  function hash(s){let h=2166136261>>>0;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function sig(z){return z>35?1:z<-35?0:1/(1+Math.exp(-z));}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function ring(lat,lon,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>lat)!==(yj>lat))&&lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi)inside=!inside;}return inside;}
  function inThai(lat,lon){const g=THAILAND_BOUNDARY.type==='Feature'?THAILAND_BOUNDARY.geometry:THAILAND_BOUNDARY;if(g.type==='Polygon')return ring(lat,lon,g.coordinates[0]);return g.coordinates.some(p=>ring(lat,lon,p[0]));}
  function chosen(){const rows=[...document.querySelectorAll('.species-row[data-id]')],ids=new Set(rows.filter(x=>parseFloat(x.style.opacity||'1')>.75).map(x=>x.getAttribute('data-id')));return rows.length?SPECIES.filter(s=>ids.has(s.id)):SPECIES;}
  function clean(sp){const seen=new Set(),cells=new Set(),out=[];(sp.points||[]).forEach(p=>{if(!isFinite(p[0])||!isFinite(p[1])||!inThai(p[0],p[1]))return;const k=p[0].toFixed(6)+','+p[1].toFixed(6);if(seen.has(k))return;seen.add(k);const c=Math.floor(p[0]/C.thin)+':'+Math.floor(p[1]/C.thin);if(cells.has(c))return;cells.add(c);out.push(p);});return out;}
  function median(a){if(!a.length)return null;a=a.slice().sort((x,y)=>x-y);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function sample(lat,lon){const ids=['temp','rainfall','dust','forest'],r=[];for(const id of ids){const v=sampleRasterAt(S.rasters[id],lat,lon);if(v===null||!isFinite(v))return null;r.push(v);}return r;}
  function stats(rows){return rows[0].map((_,j)=>{const v=rows.map(r=>r[j]),m=v.reduce((a,b)=>a+b,0)/v.length,va=v.reduce((a,b)=>a+(b-m)*(b-m),0)/v.length;return{mean:m,std:Math.sqrt(va)||1};});}
  function z(st,r){return r.map((v,j)=>(v-st[j].mean)/st[j].std);}
  function fit(X,y){const w=new Array(X[0].length).fill(0);let b=0;for(let it=0;it<C.it;it++){const gw=new Array(w.length).fill(0);let gb=0;for(let i=0;i<X.length;i++){let q=b;for(let j=0;j<w.length;j++)q+=w[j]*X[i][j];const e=sig(q)-y[i];for(let j=0;j<w.length;j++)gw[j]+=e*X[i][j];gb+=e;}for(let j=0;j<w.length;j++)w[j]-=C.lr*(gw[j]/X.length+C.l2*w[j]);b-=C.lr*gb/X.length;}return{w,b};}
  function pred(m,r){let q=m.b;for(let j=0;j<r.length;j++)q+=m.w[j]*r[j];return sig(q);}
  function auc(sc,y){const o=sc.map((_,i)=>i).sort((a,b)=>sc[a]-sc[b]),rk=new Array(sc.length);let i=0;while(i<o.length){let j=i+1;while(j<o.length&&sc[o[j]]===sc[o[i]])j++;const av=(i+1+j)/2;for(let k=i;k<j;k++)rk[o[k]]=av;i=j;}let p=0,n=0,s=0;y.forEach((v,i)=>v?(p++,s+=rk[i]):n++);return p&&n?(s-p*(p+1)/2)/(p*n):null;}
  function cv(X,y,seed){const R=rng(seed),idx=Array.from({length:X.length},(_,i)=>i);for(let i=idx.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}const vals=[],size=Math.ceil(idx.length/5);for(let f=0;f<5;f++){const test=new Set(idx.slice(f*size,(f+1)*size)),tx=[],ty=[],vx=[],vy=[];for(let i=0;i<X.length;i++)test.has(i)?(vx.push(X[i]),vy.push(y[i])):(tx.push(X[i]),ty.push(y[i]));if(!tx.length||!vx.length)continue;const m=fit(tx,ty),a=auc(vx.map(r=>pred(m,r)),vy);if(a!==null)vals.push(a);}return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;}
  function thresh(sc,y){let best={t:.5,j:-9};for(let t=.15;t<=.85;t+=.01){let tp=0,fn=0,tn=0,fp=0;y.forEach((v,i)=>v?(sc[i]>=t?tp++:fn++):(sc[i]>=t?fp++:tn++));const q=tp/(tp+fn||1)+tn/(tn+fp||1)-1;if(q>best.j)best={t,j:q};}return best.t;}
  function importance(X,y,m,base,seed){const R=rng(seed),d=[];for(let j=0;j<X[0].length;j++){const col=X.map(r=>r[j]);for(let i=col.length-1;i>0;i--){const k=Math.floor(R()*(i+1));[col[i],col[k]]=[col[k],col[i]];}const a=auc(X.map((r,i)=>pred(m,r.map((v,k)=>k===j?col[i]:v))),y);d.push(Math.max(0,(base||.5)-(a||.5)));}const sum=d.reduce((a,b)=>a+b,0);return sum?d.map(v=>100*v/sum):d.map(()=>25);}
  function bg(points,seed){const R=rng(seed),ref=S.rasters.temp,[w,s,e,n]=ref.bbox,out=[],used=new Set(points.map(p=>Math.floor(p[0]/C.thin)+':'+Math.floor(p[1]/C.thin)));let tries=0;while(out.length<C.bg&&tries++<C.bg*60){const lat=s+R()*(n-s),lon=w+R()*(e-w),k=Math.floor(lat/C.thin)+':'+Math.floor(lon/C.thin);if(used.has(k)||!inThai(lat,lon))continue;const r=sample(lat,lon);if(!r)continue;used.add(k);out.push(r);}return out;}
  function modelSpecies(sp,i){const pts=clean(sp),px=[];pts.forEach(p=>{const r=sample(p[0],p[1]);if(r)px.push(r);});if(px.length<C.min)return null;const seed=(C.seed+hash(sp.id||i))>>>0,b=bg(pts,seed);if(b.length<C.min)return null;const raw=px.concat(b),st=stats(raw),X=px.map(r=>z(st,r)).concat(b.map(r=>z(st,r))),y=new Array(px.length).fill(1).concat(new Array(b.length).fill(0)),m=fit(X,y),sc=X.map(r=>pred(m,r)),base=auc(sc,y),pp=px.map(r=>pred(m,z(st,r)));return{sp,st,m,threshold:thresh(sc,y),cv:cv(X,y,seed^0x9e3779b9),hsi:pp.reduce((a,b)=>a+b,0)/pp.length,imp:importance(X,y,m,base,seed^0x85ebca6b),med:px[0].map((_,j)=>median(px.map(r=>r[j])))};}
  function scenario(){const get=f=>{const e=document.querySelector(`input[data-onchange="climateAbsolute"][data-field="${f}"]`);return e?Number(e.value):null;};const t=get('tempDelta'),r=get('rainfallDelta'),d=get('dustDelta');return{temp:t===null?0:t-S.baseline.temp,rainfall:r===null?0:r-S.baseline.rainfall,dust:d===null?0:d-S.baseline.dust};}
  function areaFor(m){const ref=S.rasters.temp,[w,s,e,n]=ref.bbox,del=scenario();let cur=0,fut=0;for(let row=0;row<ref.height;row+=2){const lat=n-(row+.5)/ref.height*(n-s),dlat=(n-s)/ref.height*2,dlon=(e-w)/ref.width*2,ar=111.32*dlat*111.32*Math.cos(lat*Math.PI/180)*dlon;for(let col=0;col<ref.width;col+=2){const lon=w+(col+.5)/ref.width*(e-w);if(!inThai(lat,lon))continue;const raw=sample(lat,lon);if(!raw)continue;const p0=pred(m.m,z(m.st,raw)),p1=pred(m.m,z(m.st,[raw[0]+del.temp,raw[1]+del.rainfall,raw[2]+del.dust,raw[3]]));if(p0>=m.threshold)cur+=ar;if(p1>=m.threshold)fut+=ar;}}return{cur,fut};}
  function render(){if(!S.ran)return;const host=document.getElementById('colRightContent');if(!host)return;const th=document.getElementById('langThBtn')?.classList.contains('active'),mods=S.models.filter(m=>chosen().some(s=>s.id===m.sp.id));if(!mods.length)return;const areas=Object.fromEntries(mods.map(m=>[m.sp.id,areaFor(m)])),avg=[0,0,0,0];mods.forEach(m=>m.imp.forEach((v,i)=>avg[i]+=v));avg.forEach((_,i)=>avg[i]/=mods.length);const rows=mods.map(m=>{const a=areas[m.sp.id],diff=a.fut-a.cur,pct=a.cur?100*diff/a.cur:0;return`<div class="results-summary" style="padding:7px 0;border-bottom:1px solid #eee9db"><b style="color:#23281f">${esc(th?m.sp.thai:m.sp.common)}</b><br>Mean HSI <b>${m.hsi.toFixed(2)}</b> · CV AUC <b>${m.cv===null?'—':m.cv.toFixed(2)}</b><br>${th?'Habitat Change':'Habitat Change'}: ${Math.round(a.cur).toLocaleString()} → ${Math.round(a.fut).toLocaleString()} km² <span style="color:${diff<0?'#c1573a':diff>0?'#4f7942':'#8a8f80'}">(${pct>=0?'+':''}${pct.toFixed(1)}%)</span></div>`;}).join('');const meds=mods.map(m=>`<div class="climate-stat-row"><div class="climate-stat-label">${esc(th?m.sp.thai:m.sp.common)}</div><div class="climate-stat-value">${m.med[0].toFixed(1)}°C · ${m.med[1].toFixed(0)}mm · ${m.med[2].toFixed(1)}µg/m³ · ${m.med[3].toFixed(0)}%</div></div>`).join('');const names=['Temperature','Rainfall','PM2.5','Forest Cover'],bars=names.map((n,i)=>`<div class="contrib-row"><div class="contrib-top"><div>${n}</div><div style="font-weight:600">${avg[i].toFixed(0)}%</div></div><div class="contrib-bar-track"><div class="contrib-bar-fill" style="width:${Math.min(100,avg[i])}%"></div></div></div>`).join('');host.innerHTML=`<div class="card accent-orange"><div class="panel-head"><div class="badge badge-orange">05</div><div class="panel-title">${th?'ผลลัพธ์รายชนิด':'Species-level Results'}</div></div>${rows}<div class="climate-note">${th?'คำนวณแยกโมเดลรายชนิด ผลลัพธ์หมายถึงความเหมาะสมของถิ่นอาศัยและการเปลี่ยนแปลงพื้นที่เหมาะสมเท่านั้น ไม่ใช่จำนวนประชากร การตาย หรือการเคลื่อนที่จริงของนก หาก PM2.5 สูงแล้ว HSI เพิ่ม ต้องตีความว่าเป็นความสัมพันธ์ทางสถิติของโมเดล ไม่ใช่หลักฐานว่าฝุ่นเป็นประโยชน์ต่อนก':'Separate models per species. Results represent habitat suitability and suitable-area change only; they do not estimate population growth, mortality, or actual bird movement. Positive suitability under a high PM2.5 scenario is a statistical model response, not evidence that pollution benefits birds.'}</div></div><div class="card"><div class="results-head"><div class="results-head-title">Observed median</div></div><div class="climate-stats">${meds}</div></div><div class="card" style="margin-bottom:0"><div class="results-head"><div class="results-head-title">${th?'Variable Importance (เฉลี่ยชนิดที่เลือก)':'Variable Importance (selected-species mean)'}</div></div>${bars}</div>`;}
  async function load(){S.rasters={temp:await fetchGeoTiff('./assets/rasters/mean_temp_annual_tmd_1991-2020.tif','temp'),rainfall:await fetchGeoTiff('./assets/rasters/rainfall_annual_tmd_1991-2020.tif','rain'),dust:await fetchGeoTiff('./assets/rasters/pm25_regional_2014-2024.tif','dust'),forest:await fetchGeoTiff('./assets/rasters/forest_cover_2025_hansen.tif','forest')};const pts=SPECIES.flatMap(s=>clean(s));['temp','rainfall','dust'].forEach(id=>S.baseline[id]=median(pts.map(p=>sampleRasterAt(S.rasters[id],p[0],p[1])).filter(v=>v!==null)));}
  async function run(){if(S.running)return;S.running=true;try{if(!S.rasters)await load();S.models=[];for(let i=0;i<SPECIES.length;i++){const m=modelSpecies(SPECIES[i],i);if(m)S.models.push(m);}S.ran=!!S.models.length;setTimeout(render,3400);}catch(e){console.error('Species results:',e);}finally{S.running=false;}}
  function schedule(delay){if(!S.ran)return;clearTimeout(S.timer);S.timer=setTimeout(render,delay==null?60:delay);}
  window.HORNBILL_SPECIES_RESULTS={
    render:()=>{if(S.ran)render();},
    schedule:(delay)=>schedule(delay),
    run,
    isReady:()=>S.ran
  };
  document.addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.getAttribute('data-action');if(a==='runModel')setTimeout(run,80);if(a==='toggleSpecies'||a==='setLang')schedule(80);});
  document.addEventListener('change',e=>{if(e.target.matches('select[data-field="targetYear"],input[data-onchange="climateAbsolute"]'))schedule(100);});
  const obs=new MutationObserver(()=>{if(S.ran)schedule(40);});
  document.addEventListener('DOMContentLoaded',()=>{
    const app=document.getElementById('app');
    if(app)obs.observe(app,{subtree:true,childList:true});
    // Fit the species-level model once at startup so the 2025 baseline Results
    // appear automatically; users should not need to click the right panel.
    setTimeout(()=>run(),250);
  });
})();