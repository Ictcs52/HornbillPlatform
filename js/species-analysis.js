// HornbillPlatform enhanced species-level habitat analysis.
// Keeps the original V1 interface and adds scientifically safer per-species results.
(function () {
  'use strict';

  const CFG = {
    seed: 2569,
    thinDeg: 0.025,
    backgroundN: 1200,
    minPresence: 20,
    fit: { lr: 0.22, iters: 220, l2: 0.025 },
    paths: {
      temp: './assets/rasters/mean_temp_annual_tmd_1991-2020.tif',
      rainfall: './assets/rasters/rainfall_annual_tmd_1991-2020.tif',
      dust: './assets/rasters/pm25_regional_2014-2024.tif',
      forest: './assets/rasters/forest_cover_2025_hansen.tif'
    }
  };

  const S = {
    rasters: null,
    models: [],
    map: null,
    overlay: null,
    boundary: null,
    selectedSpecies: null,
    view: 'rich-current',
    scenario: { year: 2030, temp: 0, rainfall: 0, dust: 0 },
    grid: null,
    running: false,
    ran: false
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sigmoid(z) { return z > 35 ? 1 : z < -35 ? 0 : 1 / (1 + Math.exp(-z)); }

  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function pointInGeoJSON(lat, lon, geo) {
    const g = geo && geo.type === 'Feature' ? geo.geometry : geo;
    if (!g) return true;
    if (g.type === 'Polygon') {
      if (!pointInRing(lat, lon, g.coordinates[0])) return false;
      for (let i = 1; i < g.coordinates.length; i++) if (pointInRing(lat, lon, g.coordinates[i])) return false;
      return true;
    }
    if (g.type === 'MultiPolygon') return g.coordinates.some(poly => {
      if (!pointInRing(lat, lon, poly[0])) return false;
      for (let i = 1; i < poly.length; i++) if (pointInRing(lat, lon, poly[i])) return false;
      return true;
    });
    return true;
  }

  function cleanPoints(sp) {
    const raw = (sp.points || []).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180);
    const exact = [], seen = new Set();
    raw.forEach(p => {
      const k = Number(p[0]).toFixed(6) + ',' + Number(p[1]).toFixed(6);
      if (!seen.has(k)) { seen.add(k); exact.push(p); }
    });
    const thai = exact.filter(p => pointInGeoJSON(p[0], p[1], THAILAND_BOUNDARY));
    const thinned = [], cells = new Set();
    thai.forEach(p => {
      const k = Math.floor(p[0] / CFG.thinDeg) + ':' + Math.floor(p[1] / CFG.thinDeg);
      if (!cells.has(k)) { cells.add(k); thinned.push(p); }
    });
    return { rawCount: raw.length, uniqueCount: exact.length, thailandCount: thai.length, points: thinned };
  }

  function stats(rows) {
    return rows[0].map((_, j) => {
      const vals = rows.map(r => r[j]);
      const mean = vals.reduce((a,b)=>a+b,0) / vals.length;
      const variance = vals.reduce((a,b)=>a+(b-mean)*(b-mean),0) / vals.length;
      return { mean, std: Math.sqrt(variance) || 1 };
    });
  }
  function zrow(st, row) { return row.map((v,j)=>(v-st[j].mean)/st[j].std); }
  function fitLogistic(X, y) {
    const nf = X[0].length, w = new Array(nf).fill(0); let b = 0;
    for (let it=0; it<CFG.fit.iters; it++) {
      const gw = new Array(nf).fill(0); let gb = 0;
      for (let i=0; i<X.length; i++) {
        let s=b; for (let j=0;j<nf;j++) s += w[j]*X[i][j];
        const e=sigmoid(s)-y[i]; for (let j=0;j<nf;j++) gw[j]+=e*X[i][j]; gb+=e;
      }
      for (let j=0;j<nf;j++) w[j]-=CFG.fit.lr*(gw[j]/X.length + CFG.fit.l2*w[j]);
      b-=CFG.fit.lr*gb/X.length;
    }
    return { w, b };
  }
  function predict(m,row){ let s=m.b; for(let j=0;j<row.length;j++) s+=m.w[j]*row[j]; return sigmoid(s); }
  function auc(scores,y){
    const ord=scores.map((_,i)=>i).sort((a,b)=>scores[a]-scores[b]), ranks=new Array(scores.length); let i=0;
    while(i<ord.length){let j=i+1;while(j<ord.length&&scores[ord[j]]===scores[ord[i]])j++;const avg=(i+1+j)/2;for(let k=i;k<j;k++)ranks[ord[k]]=avg;i=j;}
    let np=0,nn=0,sr=0; y.forEach((v,i)=>{if(v===1){np++;sr+=ranks[i];}else nn++;});
    return np&&nn?(sr-np*(np+1)/2)/(np*nn):null;
  }
  function shuffleIdx(n,R){const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(R()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function cvAuc(X,y,seed){
    const order=shuffleIdx(X.length,rng(seed)), size=Math.ceil(X.length/5), vals=[];
    for(let f=0;f<5;f++){
      const test=new Set(order.slice(f*size,(f+1)*size)), tx=[],ty=[],vx=[],vy=[];
      for(let i=0;i<X.length;i++) test.has(i)?(vx.push(X[i]),vy.push(y[i])):(tx.push(X[i]),ty.push(y[i]));
      if(!tx.length||!vx.length) continue;
      const m=fitLogistic(tx,ty), a=auc(vx.map(r=>predict(m,r)),vy); if(a!==null) vals.push(a);
    }
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }
  function threshold(scores,y){
    let best={t:.5,j:-9};
    for(let t=.15;t<=.85;t+=.01){let tp=0,fn=0,tn=0,fp=0;y.forEach((v,i)=>v?(scores[i]>=t?tp++:fn++):(scores[i]>=t?fp++:tn++));const j=tp/(tp+fn||1)+tn/(tn+fp||1)-1;if(j>best.j)best={t,j};}
    return best.t;
  }
  function importance(X,y,m,base,seed){
    const R=rng(seed), drops=[];
    for(let j=0;j<X[0].length;j++){
      const col=X.map(r=>r[j]);for(let i=col.length-1;i>0;i--){const k=Math.floor(R()*(i+1));[col[i],col[k]]=[col[k],col[i]];}
      const a=auc(X.map((r,i)=>predict(m,r.map((v,k)=>k===j?col[i]:v))),y);drops.push(Math.max(0,(base||.5)-(a||.5)));
    }
    const sum=drops.reduce((a,b)=>a+b,0);return sum?drops.map(v=>100*v/sum):drops.map(()=>100/drops.length);
  }

  function samplePredictors(lat,lon,ids){
    const row=[]; for(const id of ids){const v=sampleRasterAt(S.rasters[id],lat,lon);if(v===null||!isFinite(v))return null;row.push(v);} return row;
  }
  function background(ids,pres,seed){
    const R=rng(seed), ref=S.rasters[ids[0]], [w,s,e,n]=ref.bbox, used=new Set(pres.map(p=>Math.floor(p[0]/CFG.thinDeg)+':'+Math.floor(p[1]/CFG.thinDeg))), out=[];
    let tries=0; while(out.length<CFG.backgroundN && tries++<CFG.backgroundN*60){const lat=s+R()*(n-s),lon=w+R()*(e-w),k=Math.floor(lat/CFG.thinDeg)+':'+Math.floor(lon/CFG.thinDeg);if(used.has(k)||!pointInGeoJSON(lat,lon,THAILAND_BOUNDARY))continue;const r=samplePredictors(lat,lon,ids);if(!r)continue;used.add(k);out.push(r);} return out;
  }

  function fitSpecies(sp,index){
    const cleaned=cleanPoints(sp), ids=['temp','rainfall','dust','forest'], px=[];
    cleaned.points.forEach(p=>{const r=samplePredictors(p[0],p[1],ids);if(r)px.push(r);});
    if(px.length<CFG.minPresence)return{sp,cleaned,error:'Insufficient cleaned occurrence points'};
    const seed=(CFG.seed+hashString(sp.id||sp.common||index))>>>0, bg=background(ids,cleaned.points,seed);
    if(bg.length<CFG.minPresence)return{sp,cleaned,error:'Insufficient background points'};
    const raw=px.concat(bg), st=stats(raw), X=px.map(r=>zrow(st,r)).concat(bg.map(r=>zrow(st,r))), y=new Array(px.length).fill(1).concat(new Array(bg.length).fill(0));
    const model=fitLogistic(X,y), scores=X.map(r=>predict(model,r)), train=auc(scores,y), imp=importance(X,y,model,train,seed^0x85ebca6b), presP=px.map(r=>predict(model,zrow(st,r)));
    const observedMedians=ids.map((id,j)=>{const vals=px.map(r=>r[j]).sort((a,b)=>a-b),m=Math.floor(vals.length/2);return vals.length%2?vals[m]:(vals[m-1]+vals[m])/2;});
    return {sp,cleaned,ids,st,model,cvAuc:cvAuc(X,y,seed^0x9e3779b9),threshold:threshold(scores,y),importance:imp,meanHsi:presP.reduce((a,b)=>a+b,0)/presP.length,observedMedians};
  }

  async function loadRasters(){const out={};for(const [id,url] of Object.entries(CFG.paths))out[id]=await fetchGeoTiff(url,url.split('/').pop());return out;}
  function cellCenter(r,row,col){const [w,s,e,n]=r.bbox;return[n-(row+.5)/r.height*(n-s),w+(col+.5)/r.width*(e-w)];}
  function areaKm2(r,row){const[w,s,e,n]=r.bbox,lat=n-(row+.5)/r.height*(n-s),dLat=(n-s)/r.height,dLon=(e-w)/r.width;return 111.32*dLat*111.32*Math.cos(lat*Math.PI/180)*dLon;}
  function probAt(m,lat,lon){const cur=samplePredictors(lat,lon,m.ids);if(!cur)return null;const fut=cur.slice();m.ids.forEach((id,j)=>{if(id==='temp')fut[j]+=S.scenario.temp;if(id==='rainfall')fut[j]+=S.scenario.rainfall;if(id==='dust')fut[j]+=S.scenario.dust;});return{current:predict(m.model,zrow(m.st,cur)),future:predict(m.model,zrow(m.st,fut))};}
  function buildGrid(){
    const ref=S.rasters.temp,N=ref.width*ref.height,good=S.models.filter(m=>!m.error),curRich=new Uint8Array(N),futRich=new Uint8Array(N),by={};
    good.forEach(m=>by[m.sp.id]={current:new Float32Array(N),future:new Float32Array(N),area:{current:0,future:0,stable:0,loss:0,gain:0}});
    for(let row=0;row<ref.height;row++){
      const ar=areaKm2(ref,row);
      for(let col=0;col<ref.width;col++){
        const i=row*ref.width+col,[lat,lon]=cellCenter(ref,row,col);if(!pointInGeoJSON(lat,lon,THAILAND_BOUNDARY))continue;
        for(const m of good){const p=probAt(m,lat,lon);if(!p)continue;const b=by[m.sp.id];b.current[i]=p.current;b.future[i]=p.future;const c=p.current>=m.threshold,f=p.future>=m.threshold;if(c){curRich[i]++;b.area.current+=ar;}if(f){futRich[i]++;b.area.future+=ar;}if(c&&f)b.area.stable+=ar;else if(c&&!f)b.area.loss+=ar;else if(!c&&f)b.area.gain+=ar;}
      }
    }
    S.grid={ref,curRich,futRich,by};
  }

  function colorRich(v,max){if(!v)return[238,235,226,25];const t=v/Math.max(1,max);return[Math.round(245-150*t),Math.round(238-70*t),Math.round(210-135*t),205];}
  function colorSuit(v){const t=Math.max(0,Math.min(1,v));return[Math.round(245-160*t),Math.round(240-80*t),Math.round(220-125*t),210];}
  function makeImage(){
    const g=S.grid,r=g.ref,canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height;const ctx=canvas.getContext('2d'),img=ctx.createImageData(r.width,r.height),max=S.models.filter(m=>!m.error).length,id=S.selectedSpecies||(S.models.find(m=>!m.error)||{}).sp?.id,m=S.models.find(x=>x.sp.id===id);
    for(let i=0;i<r.width*r.height;i++){
      let q;
      if(S.view==='rich-current')q=colorRich(g.curRich[i],max);
      else if(S.view==='rich-future')q=colorRich(g.futRich[i],max);
      else if(S.view==='rich-change'){const d=g.futRich[i]-g.curRich[i];q=d>0?[62,132,85,210]:d<0?[185,82,67,210]:[210,204,187,65];}
      else if(S.view==='species-current')q=colorSuit(g.by[id].current[i]);
      else if(S.view==='species-future')q=colorSuit(g.by[id].future[i]);
      else {const c=g.by[id].current[i]>=m.threshold,f=g.by[id].future[i]>=m.threshold;q=c&&f?[184,171,120,180]:c&&!f?[185,82,67,210]:!c&&f?[62,132,85,210]:[0,0,0,0];}
      const p=i*4;img.data[p]=q[0];img.data[p+1]=q[1];img.data[p+2]=q[2];img.data[p+3]=q[3];
    }
    ctx.putImageData(img,0,0);return canvas.toDataURL('image/png');
  }
  function updateMap(){if(!S.grid||!S.map)return;const r=S.grid.ref,[w,s,e,n]=r.bbox;if(S.overlay)S.map.removeLayer(S.overlay);S.overlay=L.imageOverlay(makeImage(),[[s,w],[n,e]],{opacity:.82}).addTo(S.map);}

  function fmt(v,d=1){return Number(v).toFixed(d);}
  function renderResults(){
    const host=document.getElementById('speciesAnalysisResults');if(!host)return;
    if(!S.ran){host.innerHTML='<div class="sa-note">กด “วิเคราะห์พื้นที่เหมาะสม” เพื่อคำนวณโมเดลแยกตามชนิดนกเงือก</div>';return;}
    const rows=S.models.map(m=>{
      if(m.error)return`<tr><td><b>${esc(m.sp.common)}</b></td><td colspan="11">${esc(m.error)}</td></tr>`;
      const a=S.grid.by[m.sp.id].area,imp=Object.fromEntries(m.ids.map((id,j)=>[id,m.importance[j]||0])),med=Object.fromEntries(m.ids.map((id,j)=>[id,m.observedMedians[j]]));
      return`<tr><td><b>${esc(m.sp.common)}</b><br><small>${esc(m.sp.latin||'')}</small></td><td>${m.cleaned.rawCount.toLocaleString()} → ${m.cleaned.points.length.toLocaleString()}</td><td>${m.cvAuc===null?'—':fmt(m.cvAuc,2)}</td><td>${fmt(m.meanHsi,2)}</td><td>${fmt(imp.temp,0)}%</td><td>${fmt(imp.rainfall,0)}%</td><td>${fmt(imp.dust,0)}%</td><td>${fmt(imp.forest,0)}%</td><td>${fmt(med.temp,1)}°C</td><td>${fmt(med.rainfall,0)} mm</td><td>${Math.round(a.current).toLocaleString()}</td><td>${Math.round(a.future).toLocaleString()}</td></tr>`;
    }).join('');
    const changes=S.models.filter(m=>!m.error).map(m=>{const a=S.grid.by[m.sp.id].area;return`<div class="sa-change"><b>${esc(m.sp.common)}</b><span>คงเดิม ${Math.round(a.stable).toLocaleString()} km²</span><span>ลดลง ${Math.round(a.loss).toLocaleString()} km²</span><span>เพิ่มขึ้น ${Math.round(a.gain).toLocaleString()} km²</span></div>`;}).join('');
    host.innerHTML=`<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Species</th><th>GBIF raw → cleaned</th><th>5-fold AUC</th><th>Mean HSI</th><th>Temp</th><th>Rain</th><th>PM2.5</th><th>Forest</th><th>Observed median T</th><th>Observed median rain</th><th>Current km²</th><th>Scenario km²</th></tr></thead><tbody>${rows}</tbody></table></div><div class="sa-change-grid">${changes}</div><div class="sa-note"><b>การตีความ:</b> โมเดลของนกแต่ละชนิดถูกคำนวณแยกจากกัน แล้วจึงนำผลมาซ้อนเพื่อสร้าง Hornbill Richness Map. ค่าในปีอนาคตเป็น <b>Environmental Change Scenario</b> จากค่าที่กำหนด ไม่ใช่ climate projection จริง จนกว่าจะใส่ future raster จริง.</div>`;
  }
  function setStatus(t,err){const el=document.getElementById('speciesAnalysisStatus');if(el){el.textContent=t;el.classList.toggle('sa-error',!!err);}}

  async function runAll(){
    if(S.running)return;S.running=true;setStatus('กำลังโหลด Temperature, Rainfall, PM2.5 และ Forest Cover…');
    try{
      S.rasters=await loadRasters();S.models=[];
      for(let i=0;i<SPECIES.length;i++){setStatus(`กำลังสร้างโมเดล ${i+1}/${SPECIES.length}: ${SPECIES[i].common}…`);await new Promise(r=>setTimeout(r,15));S.models.push(fitSpecies(SPECIES[i],i));}
      setStatus('กำลังสร้าง Habitat Suitability Map ทั้งประเทศไทย…');await new Promise(r=>setTimeout(r,20));buildGrid();S.ran=true;S.selectedSpecies=(S.models.find(m=>!m.error)||{}).sp?.id||null;
      const sel=document.getElementById('speciesAnalysisSpecies');sel.innerHTML=S.models.filter(m=>!m.error).map(m=>`<option value="${esc(m.sp.id)}">${esc(m.sp.common)}</option>`).join('');sel.disabled=false;
      renderResults();updateMap();setStatus('วิเคราะห์เสร็จแล้ว — แยกโมเดลรายชนิดและแสดงผลรวมพร้อมกัน');
    }catch(e){console.error(e);setStatus('วิเคราะห์ไม่สำเร็จ: '+e.message,true);}finally{S.running=false;}
  }
  function applyScenario(){
    S.scenario.year=Number(document.getElementById('speciesAnalysisYear').value);S.scenario.temp=Number(document.getElementById('speciesAnalysisTemp').value)||0;S.scenario.rainfall=Number(document.getElementById('speciesAnalysisRain').value)||0;S.scenario.dust=Number(document.getElementById('speciesAnalysisDust').value)||0;
    if(S.ran){setStatus('กำลังคำนวณ scenario ใหม่…');setTimeout(()=>{buildGrid();renderResults();updateMap();setStatus('อัปเดต scenario แล้ว');},10);}
  }

  function inject(){
    if(document.getElementById('speciesAnalysis'))return;const app=document.getElementById('app');if(!app)return;
    const s=document.createElement('section');s.id='speciesAnalysis';s.className='species-analysis';s.innerHTML=`
      <div class="sa-head"><div><div class="sa-kicker">ENHANCED ANALYSIS</div><h2>Species-level Habitat Suitability & Hornbill Richness</h2><p>วิเคราะห์ปัจจัยสิ่งแวดล้อมและพื้นที่เหมาะสมของนกเงือกแต่ละชนิด โดยแสดงผลพร้อมกันทั้งหมด</p></div><button id="speciesAnalysisRun">วิเคราะห์พื้นที่เหมาะสม</button></div>
      <div class="sa-controls"><label>Scenario year<select id="speciesAnalysisYear"><option>2030</option><option>2050</option><option>2070</option></select></label><label>Temperature Δ (°C)<input id="speciesAnalysisTemp" type="number" step="0.5" value="0"></label><label>Rainfall Δ (mm)<input id="speciesAnalysisRain" type="number" step="50" value="0"></label><label>PM2.5 Δ (µg/m³)<input id="speciesAnalysisDust" type="number" step="1" value="0"></label><button id="speciesAnalysisApply">ใช้ Scenario</button></div>
      <div id="speciesAnalysisStatus" class="sa-status">พร้อมวิเคราะห์ — ระบบเดิมด้านบนยังคงใช้งานได้ตามปกติ</div>
      <div class="sa-grid"><div class="sa-card"><div class="sa-map-tools"><select id="speciesAnalysisView"><option value="rich-current">Hornbill Richness — ปัจจุบัน</option><option value="rich-future">Hornbill Richness — Scenario</option><option value="rich-change">Hornbill Richness — การเปลี่ยนแปลง</option><option value="species-current">พื้นที่เหมาะสมรายชนิด — ปัจจุบัน</option><option value="species-future">พื้นที่เหมาะสมรายชนิด — Scenario</option><option value="species-change">รายชนิด — คงเดิม / ลดลง / เพิ่มขึ้น</option></select><select id="speciesAnalysisSpecies" disabled><option>Run analysis first</option></select></div><div id="speciesAnalysisMap"></div></div><div id="speciesAnalysisResults" class="sa-card"><div class="sa-note">กด “วิเคราะห์พื้นที่เหมาะสม” เพื่อคำนวณโมเดลแยกตามชนิดนกเงือก</div></div></div>`;
    app.insertAdjacentElement('afterend',s);
    S.map=L.map('speciesAnalysisMap',{scrollWheelZoom:true,preferCanvas:true}).setView([13.1,101],5);L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; OpenStreetMap contributors &copy; CARTO',maxZoom:18}).addTo(S.map);S.boundary=L.geoJSON(THAILAND_BOUNDARY,{style:{color:'#3a4033',weight:1,fill:false,opacity:.65}}).addTo(S.map);S.map.fitBounds(S.boundary.getBounds(),{padding:[15,15]});
    document.getElementById('speciesAnalysisRun').addEventListener('click',runAll);document.getElementById('speciesAnalysisApply').addEventListener('click',applyScenario);document.getElementById('speciesAnalysisView').addEventListener('change',e=>{S.view=e.target.value;document.getElementById('speciesAnalysisSpecies').disabled=S.view.startsWith('rich');updateMap();});document.getElementById('speciesAnalysisSpecies').addEventListener('change',e=>{S.selectedSpecies=e.target.value;updateMap();});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject);else inject();
})();
