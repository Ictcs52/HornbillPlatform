// Species-specific habitat engine integrated into the student's existing maps.
// No new dashboard or map is created. This script runs before app.js so it can
// capture the two existing Leaflet map instances and add model overlays to them.
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

  const E = {
    mainMap: null,
    forestMap: null,
    mainOverlay: null,
    forestOverlay: null,
    rasters: null,
    models: [],
    grids: null,
    distributionMode: 'change',
    distributionControl: null,
    shiftLayer: null,
    projectedLayer: null,
    ran: false,
    running: false,
    refreshTimer: null,
    baselineMedian: { temp: null, rainfall: null, dust: null }
  };

  // Capture the original maps without changing the HTML/UI.
  const originalLMap = L.map.bind(L);
  L.map = function (id, options) {
    const map = originalLMap(id, options);
    if (id === 'leafletMap') E.mainMap = map;
    if (id === 'forestRiskMap') E.forestMap = map;
    return map;
  };

  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
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

  function selectedSpecies() {
    // Read the application's real selection state when available. The Samples
    // panel is re-rendered often, so using DOM opacity alone can briefly return
    // stale selections and leave model overlays unchanged.
    if (window.HORNBILL_SELECTION_API && typeof window.HORNBILL_SELECTION_API.selectedIds === 'function') {
      const ids = new Set(window.HORNBILL_SELECTION_API.selectedIds());
      return SPECIES.filter(sp => ids.has(sp.id));
    }
    const rows = Array.from(document.querySelectorAll('.species-row[data-id]'));
    if (!rows.length) return SPECIES;
    const ids = new Set(rows.filter(el => parseFloat(el.style.opacity || '1') > 0.75).map(el => el.getAttribute('data-id')));
    return SPECIES.filter(sp => ids.has(sp.id));
  }

  function cleanPoints(sp) {
    const raw = (sp.points || []).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));
    const exact = [], seen = new Set();
    raw.forEach(p => {
      const k = Number(p[0]).toFixed(6) + ',' + Number(p[1]).toFixed(6);
      if (!seen.has(k)) { seen.add(k); exact.push(p); }
    });
    const thai = exact.filter(p => pointInGeoJSON(p[0], p[1], THAILAND_BOUNDARY));
    const out = [], cells = new Set();
    thai.forEach(p => {
      const k = Math.floor(p[0] / CFG.thinDeg) + ':' + Math.floor(p[1] / CFG.thinDeg);
      if (!cells.has(k)) { cells.add(k); out.push(p); }
    });
    return out;
  }

  function standardizeStats(rows) {
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
        let s = b; for (let j=0;j<nf;j++) s += w[j] * X[i][j];
        const e = sigmoid(s) - y[i];
        for (let j=0;j<nf;j++) gw[j] += e * X[i][j];
        gb += e;
      }
      for (let j=0;j<nf;j++) w[j] -= CFG.fit.lr * (gw[j] / X.length + CFG.fit.l2 * w[j]);
      b -= CFG.fit.lr * gb / X.length;
    }
    return { w, b };
  }
  function predict(m,row){ let s=m.b; for(let j=0;j<row.length;j++) s+=m.w[j]*row[j]; return sigmoid(s); }
  function auc(scores,y){
    const ord=scores.map((_,i)=>i).sort((a,b)=>scores[a]-scores[b]), ranks=new Array(scores.length); let i=0;
    while(i<ord.length){let j=i+1;while(j<ord.length&&scores[ord[j]]===scores[ord[i]])j++;const avg=(i+1+j)/2;for(let k=i;k<j;k++)ranks[ord[k]]=avg;i=j;}
    let np=0,nn=0,sr=0;y.forEach((v,i)=>{if(v===1){np++;sr+=ranks[i];}else nn++;});
    return np&&nn?(sr-np*(np+1)/2)/(np*nn):null;
  }
  function threshold(scores,y){
    let best={t:.5,j:-9};
    for(let t=.15;t<=.85;t+=.01){let tp=0,fn=0,tn=0,fp=0;y.forEach((v,i)=>v?(scores[i]>=t?tp++:fn++):(scores[i]>=t?fp++:tn++));const j=tp/(tp+fn||1)+tn/(tn+fp||1)-1;if(j>best.j)best={t,j};}
    return best.t;
  }

  function samplePredictors(lat, lon) {
    const ids = ['temp','rainfall','dust','forest'], row=[];
    for (const id of ids) {
      const v = sampleRasterAt(E.rasters[id], lat, lon);
      if (v === null || !isFinite(v)) return null;
      row.push(v);
    }
    return row;
  }
  function background(pres, seed) {
    const R=seeded(seed), ref=E.rasters.temp, [w,s,e,n]=ref.bbox;
    const used=new Set(pres.map(p=>Math.floor(p[0]/CFG.thinDeg)+':'+Math.floor(p[1]/CFG.thinDeg))), out=[];
    let tries=0;
    while(out.length<CFG.backgroundN && tries++<CFG.backgroundN*60){
      const lat=s+R()*(n-s), lon=w+R()*(e-w), k=Math.floor(lat/CFG.thinDeg)+':'+Math.floor(lon/CFG.thinDeg);
      if(used.has(k)||!pointInGeoJSON(lat,lon,THAILAND_BOUNDARY))continue;
      const r=samplePredictors(lat,lon); if(!r)continue;
      used.add(k); out.push(r);
    }
    return out;
  }

  function fitSpecies(sp, index) {
    const points=cleanPoints(sp), px=[];
    points.forEach(p=>{const r=samplePredictors(p[0],p[1]);if(r)px.push(r);});
    if(px.length<CFG.minPresence)return null;
    const seed=(CFG.seed+hashString(sp.id||index))>>>0, bg=background(points,seed);
    if(bg.length<CFG.minPresence)return null;
    const raw=px.concat(bg), st=standardizeStats(raw);
    const X=px.map(r=>zrow(st,r)).concat(bg.map(r=>zrow(st,r))), y=new Array(px.length).fill(1).concat(new Array(bg.length).fill(0));
    const model=fitLogistic(X,y), scores=X.map(r=>predict(model,r));
    const ranges=raw[0].map((_,j)=>({min:Math.min(...raw.map(r=>r[j])),max:Math.max(...raw.map(r=>r[j]))}));
    return { sp, st, model, threshold:threshold(scores,y), trainAuc:auc(scores,y), ranges };
  }

  async function loadRasters() {
    const out={};
    for(const [id,url] of Object.entries(CFG.paths)) out[id]=await fetchGeoTiff(url,url.split('/').pop());
    return out;
  }

  function median(vals) {
    if (!vals.length) return null;
    vals=vals.slice().sort((a,b)=>a-b); const m=Math.floor(vals.length/2);
    return vals.length%2?vals[m]:(vals[m-1]+vals[m])/2;
  }
  function computeBaselineMedians() {
    const pts=SPECIES.flatMap(sp=>cleanPoints(sp));
    ['temp','rainfall','dust'].forEach(id=>{
      E.baselineMedian[id]=median(pts.map(p=>sampleRasterAt(E.rasters[id],p[0],p[1])).filter(v=>v!==null&&isFinite(v)));
    });
  }

  function scenarioDeltas() {
    if(window.HORNBILL_SCENARIO_API&&typeof window.HORNBILL_SCENARIO_API.deltas==='function'){
      const d=window.HORNBILL_SCENARIO_API.deltas();
      const year=window.HORNBILL_SCENARIO_API.currentYear?window.HORNBILL_SCENARIO_API.currentYear():2025;
      return {year,temp:d.temp||0,rainfall:d.rainfall||0,dust:d.dust||0};
    }
    const yearSel=document.querySelector('select[data-field="targetYear"]');
    const year=yearSel?Number(yearSel.value):2025;
    const get = field => {
      const el=document.querySelector(`input[data-onchange="climateAbsolute"][data-field="${field}"]`);
      return el ? Number(el.value) : null;
    };
    const t=get('tempDelta'), r=get('rainfallDelta'), d=get('dustDelta');
    return {year,temp:t===null||E.baselineMedian.temp===null?0:t-E.baselineMedian.temp,rainfall:r===null||E.baselineMedian.rainfall===null?0:r-E.baselineMedian.rainfall,dust:d===null||E.baselineMedian.dust===null?0:d-E.baselineMedian.dust};
  }
  function scenarioAbsolute(){
    const get=field=>{const el=document.querySelector(`input[data-onchange="climateAbsolute"][data-field="${field}"]`);return el?Number(el.value):null;};
    return [get('tempDelta'),get('rainfallDelta'),get('dustDelta')];
  }
  function scenarioValidForModel(m){
    // Future controls describe shifts of the environmental rasters, not a
    // single local observation shared by every cell. Keep the model active;
    // extrapolation warnings remain a UI warning rather than suppressing all
    // species results and projected habitat.
    return true;
  }
  function cellCenter(r,row,col){const[w,s,e,n]=r.bbox;return[n-(row+.5)/r.height*(n-s),w+(col+.5)/r.width*(e-w)];}
  function predictAt(m,lat,lon,deltas,onlyVar) {
    const cur=samplePredictors(lat,lon); if(!cur)return null;
    const fut=cur.slice();
    const ids=['temp','rainfall','dust','forest'];
    ids.forEach((id,j)=>{
      if(id==='forest')return;
      if(onlyVar && id!==onlyVar)return;
      fut[j]+=deltas[id]||0;
    });
    const pc=predict(m.model,zrow(m.st,cur)), pf=predict(m.model,zrow(m.st,fut));
    return { current:pc, future:pf, change:pf-pc };
  }

  function buildGrids() {
    const ref=E.rasters.temp, N=ref.width*ref.height, selected=selectedSpecies(), models=E.models.filter(m=>selected.some(s=>s.id===m.sp.id));
    const deltas=scenarioDeltas();
    const richnessCur=new Uint8Array(N), richnessFut=new Uint8Array(N);
    const risk={temp:new Float32Array(N),rainfall:new Float32Array(N),dust:new Float32Array(N)};
    const speciesData=Object.fromEntries(models.map(m=>[m.sp.id,{model:m,curCount:0,futCount:0,curCells:[],futCells:[]}])) ;
    for(let row=0;row<ref.height;row++){
      for(let col=0;col<ref.width;col++){
        const i=row*ref.width+col,[lat,lon]=cellCenter(ref,row,col);
        if(!pointInGeoJSON(lat,lon,THAILAND_BOUNDARY))continue;
        let nRiskT=0,nRiskR=0,nRiskD=0;
        for(const m of models){
          const full=predictAt(m,lat,lon,deltas,null); if(!full)continue;
          const sd=speciesData[m.sp.id], valid=scenarioValidForModel(m);
          sd.valid=valid;
          if(full.current>=m.threshold){
            richnessCur[i]++; sd.curCount++;
            if(row%2===0&&col%2===0)sd.curCells.push([lat,lon,full.current]);
          }
          const futureScore=(deltas.year===2025||!valid)?full.current:full.future;
          if(futureScore>=m.threshold){
            richnessFut[i]++; sd.futCount++;
            if(row%2===0&&col%2===0&&valid&&deltas.year!==2025)sd.futCells.push([lat,lon,futureScore]);
          }
          if(valid&&deltas.year!==2025){
            const pt=predictAt(m,lat,lon,deltas,'temp'); if(pt){risk.temp[i]+=pt.change;nRiskT++;}
            const pr=predictAt(m,lat,lon,deltas,'rainfall'); if(pr){risk.rainfall[i]+=pr.change;nRiskR++;}
            const pd=predictAt(m,lat,lon,deltas,'dust'); if(pd){risk.dust[i]+=pd.change;nRiskD++;}
          }
        }
        if(nRiskT)risk.temp[i]/=nRiskT;
        if(nRiskR)risk.rainfall[i]/=nRiskR;
        if(nRiskD)risk.dust[i]/=nRiskD;
      }
    }
    E.grids={ref,richnessCur,richnessFut,risk,deltas,maxSpecies:Math.max(1,models.length),speciesData};
  }

  function rgbaRich(v,max) {
    if(!v)return[0,0,0,0];
    const t=v/Math.max(1,max);
    return [Math.round(245-150*t),Math.round(238-70*t),Math.round(210-135*t),180];
  }
  function rgbaChange(cur,fut,maxSpecies) {
    if(!cur&&!fut)return[0,0,0,0];
    // Compare species richness, not only presence/absence of "any species".
    // The old boolean comparison made Current and Change look almost identical
    // whenever at least one species remained suitable in both scenarios.
    const d=fut-cur;
    if(d===0)return[77,116,156,220];       // Stable richness
    const strength=Math.min(1,Math.abs(d)/Math.max(1,maxSpecies));
    const a=Math.round(205+40*strength);
    if(d>0)return[55,145,92,a];            // Gain
    return[193,76,59,a];                   // Loss
  }
  function suitableCentroid(m, future, deltas){
    const ref=E.rasters.temp,[w,s,e,n]=ref.bbox;
    let sw=0,slat=0,slon=0;
    const step=2;
    for(let row=0;row<ref.height;row+=step){
      const lat=n-(row+.5)/ref.height*(n-s);
      for(let col=0;col<ref.width;col+=step){
        const lon=w+(col+.5)/ref.width*(e-w);
        if(!pointInGeoJSON(lat,lon,THAILAND_BOUNDARY))continue;
        const p=predictAt(m,lat,lon,deltas,null); if(!p)continue;
        const score=future?p.future:p.current;
        if(score<m.threshold)continue;
        const wt=Math.max(0.001,score-m.threshold+0.001);
        sw+=wt;slat+=lat*wt;slon+=lon*wt;
      }
    }
    return sw?{lat:slat/sw,lon:slon/sw}:null;
  }
  function rgbaRisk(change) {
    if(Math.abs(change)<0.005)return[0,0,0,0];
    // Green = suitability improves, red = suitability declines.
    const a=Math.min(220,80+Math.round(Math.abs(change)*900));
    return change>0?[62,132,85,a]:[185,82,67,a];
  }
  function canvasUrl(kind) {
    const g=E.grids, r=g.ref, c=document.createElement('canvas'); c.width=r.width;c.height=r.height;
    const ctx=c.getContext('2d'), img=ctx.createImageData(r.width,r.height);
    for(let i=0;i<r.width*r.height;i++){
      let q;
      if(kind==='distribution'){
        if(E.distributionMode==='current') q=rgbaRich(g.richnessCur[i],g.maxSpecies);
        else if(E.distributionMode==='future') q=rgbaRich(g.richnessFut[i],g.maxSpecies);
        else q=rgbaChange(g.richnessCur[i],g.richnessFut[i],g.maxSpecies);
      }
      else q=rgbaRisk(g.risk[kind][i]);
      const p=i*4;img.data[p]=q[0];img.data[p+1]=q[1];img.data[p+2]=q[2];img.data[p+3]=q[3];
    }
    ctx.putImageData(img,0,0); return c.toDataURL('image/png');
  }

  function activeMainTab() {
    if(document.getElementById('mapTabRainfall')?.classList.contains('active'))return'rainfall';
    if(document.getElementById('mapTabTemperature')?.classList.contains('active'))return'temp';
    if(document.getElementById('mapTabDust')?.classList.contains('active'))return'dust';
    return'distribution';
  }
  function activeForestTab() {
    if(document.getElementById('riskTabTemperature')?.classList.contains('active'))return'temp';
    if(document.getElementById('riskTabDust')?.classList.contains('active'))return'dust';
    return'rainfall';
  }

  function ensureModelPanes(){
    if(!E.mainMap)return;
    if(!E.mainMap.getPane('habitatModelPane')){
      const p=E.mainMap.createPane('habitatModelPane'); p.style.zIndex=620; p.style.pointerEvents='none';
    }
    if(!E.mainMap.getPane('projectedPane')){
      const p=E.mainMap.createPane('projectedPane'); p.style.zIndex=680; p.style.pointerEvents='auto';
    }
    if(!E.mainMap.getPane('shiftPane')){
      const p=E.mainMap.createPane('shiftPane'); p.style.zIndex=700; p.style.pointerEvents='auto';
    }
  }

  function clearProjectedLayer(){
    if(E.mainMap&&E.projectedLayer&&E.mainMap.hasLayer(E.projectedLayer))E.mainMap.removeLayer(E.projectedLayer);
    E.projectedLayer=null;
  }
  function setOccurrenceVisible(visible){
    if(window.HORNBILL_MAP_API&&typeof window.HORNBILL_MAP_API.setOccurrenceVisible==='function'){
      window.HORNBILL_MAP_API.setOccurrenceVisible(visible);
    }
  }
  function representativeCells(cells,target){
    if(!cells||!cells.length||target<=0)return[];
    const n=Math.min(target,cells.length);
    // Prefer the most suitable future cells, but keep spatial separation so
    // Scenario visibly represents a new habitat pattern instead of reproducing
    // the original occurrence cloud.
    const ranked=cells.slice().sort((a,b)=>b[2]-a[2]),out=[];
    const minDist=0.22;
    for(const p of ranked){
      if(out.every(q=>Math.hypot(p[0]-q[0],p[1]-q[1])>=minDist))out.push(p);
      if(out.length>=n)break;
    }
    if(out.length<n){
      for(const p of ranked){
        if(!out.includes(p))out.push(p);
        if(out.length>=n)break;
      }
    }
    return out;
  }
  function drawProjectedPoints(){
    clearProjectedLayer();
    // 2025 is the observed/current baseline. Even if the Compare control is
    // still on Scenario/Change after switching years, keep real GBIF points
    // visible and do not replace them with projected points.
    if(!E.mainMap||!E.grids||activeMainTab()!=='distribution'||E.distributionMode==='current'||E.grids.deltas.year===2025){
      setOccurrenceVisible(true);return;
    }
    setOccurrenceVisible(false);
    const th=document.getElementById('langThBtn')?.classList.contains('active');
    const grp=L.layerGroup();
    Object.values(E.grids.speciesData||{}).forEach(sd=>{
      if(!sd.valid||E.grids.deltas.year===2025)return;
      const m=sd.model,baseObs=cleanPoints(m.sp).length;
      const baseRep=Math.max(10,Math.min(120,Math.round(Math.sqrt(Math.max(1,baseObs))*5)));
      const ratio=sd.curCount>0?sd.futCount/sd.curCount:0;
      const target=Math.max(0,Math.min(180,Math.round(baseRep*ratio)));
      representativeCells(sd.futCells,target).forEach(p=>{
        L.circleMarker([p[0],p[1]],{
          pane:'projectedPane',radius:4,color:'#fff',weight:1,fillColor:m.sp.color||'#333',fillOpacity:.88
        }).bindTooltip((th?m.sp.thai:m.sp.common)+' — '+(th?'ตำแหน่งพื้นที่เหมาะสมที่คาดการณ์':'projected suitable location')+' (HSI '+p[2].toFixed(2)+')')
          .addTo(grp);
      });
    });
    grp.addTo(E.mainMap);E.projectedLayer=grp;
  }

  function clearShiftLayer(){
    if(E.mainMap&&E.shiftLayer&&E.mainMap.hasLayer(E.shiftLayer))E.mainMap.removeLayer(E.shiftLayer);
    E.shiftLayer=null;
  }
  function drawShiftArrows(){
    clearShiftLayer();
    if(!E.mainMap||!E.ran||!E.grids||activeMainTab()!=='distribution'||E.distributionMode!=='change'||E.grids.deltas.year===2025)return;
    const selected=selectedSpecies(),models=E.models.filter(m=>selected.some(s=>s.id===m.sp.id)),del=E.grids.deltas;
    const grp=L.layerGroup();
    models.forEach(m=>{
      const a=suitableCentroid(m,false,del),b=suitableCentroid(m,true,del);
      if(!a||!b)return;
      const color=m.sp.color||'#333';
      const line=L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{pane:'shiftPane',color,weight:2.2,opacity:.9,dashArray:'6,4'}).addTo(grp);
      const ang=Math.atan2(b.lat-a.lat,(b.lon-a.lon)*Math.cos(b.lat*Math.PI/180));
      const len=.22,spread=.55,cc=Math.max(.2,Math.cos(b.lat*Math.PI/180));
      const p1=[b.lat-len*Math.sin(ang-spread),b.lon-len*Math.cos(ang-spread)/cc];
      const p2=[b.lat-len*Math.sin(ang+spread),b.lon-len*Math.cos(ang+spread)/cc];
      L.polyline([p1,[b.lat,b.lon],p2],{pane:'shiftPane',color,weight:2.2,opacity:.9}).addTo(grp);
      const th=document.getElementById('langThBtn')?.classList.contains('active');
      line.bindTooltip((th?m.sp.thai:m.sp.common)+': '+(th?'ทิศทางการเลื่อนของศูนย์กลางพื้นที่เหมาะสม':'projected suitable-area centroid shift'));
    });
    grp.addTo(E.mainMap);E.shiftLayer=grp;
  }

  function removeOverlay(map,key) {
    const layer=E[key];
    if(map&&layer&&map.hasLayer(layer))map.removeLayer(layer);
    E[key]=null;
  }
  function addOverlay(map,key,kind,opacity) {
    if(!map||!E.grids)return;
    removeOverlay(map,key);
    const r=E.grids.ref,[w,s,e,n]=r.bbox;
    const op=(kind==='distribution'&&E.distributionMode==='change')?0.86:(opacity||0.62);
    ensureModelPanes();
    E[key]=L.imageOverlay(canvasUrl(kind),[[s,w],[n,e]],{opacity:op,interactive:false,pane:'habitatModelPane'}).addTo(map);
    if(E[key].bringToFront)E[key].bringToFront();
  }

  function ensureDistributionControl() {
    if(!E.mainMap)return;
    // app.js can rebuild the map container. A cached Leaflet control may then
    // point to a detached DOM node, which is why Current/Scenario/Change
    // appeared to disappear.
    if(E.distributionControl){
      const oldEl=E.distributionControl.getContainer&&E.distributionControl.getContainer();
      if(oldEl&&oldEl.isConnected)return;
      E.distributionControl=null;
    }
    const Control=L.Control.extend({
      options:{position:'topright'},
      onAdd:function(){
        const d=L.DomUtil.create('div','habitat-compare-control');
        L.DomEvent.disableClickPropagation(d);L.DomEvent.disableScrollPropagation(d);
        d.innerHTML='<button data-mode="current">Current</button><button data-mode="future">Scenario</button><button data-mode="change">Change</button>';
        d.addEventListener('click',ev=>{const b=ev.target.closest('button[data-mode]');if(!b)return;E.distributionMode=b.dataset.mode;updateDistributionControl();scheduleRefresh(20);});
        return d;
      }
    });
    E.distributionControl=new Control().addTo(E.mainMap);
    const s=document.createElement('style');
    s.textContent='.habitat-compare-control{background:#fff;padding:4px;border-radius:6px;box-shadow:0 1px 5px rgba(0,0,0,.25);display:flex;gap:3px;align-items:center}.habitat-compare-control button{border:0;border-radius:4px;padding:5px 7px;font:600 10px sans-serif;background:#f1eee4;color:#5c6256;cursor:pointer}.habitat-compare-control button.active{background:#287f83;color:#fff}#habitatModeLabel{font:700 9px sans-serif;color:#287f83;margin-left:3px}#habitatChangeLegend{display:none;gap:6px;margin-left:4px;font:600 9px sans-serif;color:#444}#habitatChangeLegend span{display:flex;align-items:center;gap:2px}#habitatChangeLegend i{width:8px;height:8px;border-radius:2px;display:inline-block}';
    document.head.appendChild(s);
  }
  function updateDistributionControl(){
    ensureDistributionControl();
    if(!E.distributionControl)return;
    const el=E.distributionControl.getContainer(),show=activeMainTab()==='distribution';
    el.style.display=show?'flex':'none';
    el.querySelectorAll('button[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===E.distributionMode));
    let modeLabel=document.getElementById('habitatModeLabel');
    if(!modeLabel){modeLabel=document.createElement('strong');modeLabel.id='habitatModeLabel';el.appendChild(modeLabel);}
    modeLabel.textContent=E.distributionMode==='current'?'CURRENT':E.distributionMode==='future'?'SCENARIO':'CHANGE';
    let legend=document.getElementById('habitatChangeLegend');
    if(E.distributionMode==='change'&&show){
      if(!legend){
        legend=document.createElement('div'); legend.id='habitatChangeLegend';
        legend.innerHTML='<span><i style="background:#4d749c"></i>Stable</span><span><i style="background:#37915c"></i>Gain</span><span><i style="background:#c14c3b"></i>Loss</span>';
        el.appendChild(legend);
      }
      legend.style.display='flex';
    } else if(legend) legend.style.display='none';
  }

  function updateNotes(mainKind,forestKind) {
    const note=document.getElementById('mapRealNote');
    if(note&&E.ran){
      if(mainKind==='distribution'){
        if(E.distributionMode==='current')note.textContent='Current: real GBIF occurrence points over modelled baseline suitable habitat.';
        else if(E.distributionMode==='future'){
          const invalid=Object.values(E.grids.speciesData||{}).some(sd=>sd.valid===false);
          note.textContent=invalid
            ? 'Scenario projection is unavailable for species whose inputs fall outside their fitted data range; unsupported extrapolations are not plotted.'
            : 'Scenario: representative projected suitable-location points. Point count changes with modelled suitable-area change; these are not predicted bird counts.';
        }
        else note.innerHTML='Habitat change: <b style="color:#4d749c">Blue = stable species richness</b> · <b style="color:#37915c">Green = more selected species suitable</b> · <b style="color:#c14c3b">Red = fewer selected species suitable</b>. Dashed arrows show suitable-area centroid shift; this is not observed bird movement.';
      }
      else note.textContent=`Model overlay: ${mainKind==='temp'?'Temperature':mainKind==='rainfall'?'Rainfall':'PM2.5'} scenario effect on habitat suitability. Green = suitability increase; red = decrease.`;
    }
    const f=document.getElementById('forestRiskNote');
    if(f&&E.ran)f.textContent=`Forest map + modelled ${forestKind==='temp'?'Temperature':forestKind==='rainfall'?'Rainfall':'PM2.5'} suitability change. Green = increase; red = decrease.`;
  }

  function refreshMaps() {
    if(!E.ran||!E.grids)return;
    ensureModelPanes();
    // Rendering Current / Scenario / Change must use the scenario snapshot
    // calculated by the last Run. Rebuilding here made every compare-button
    // click silently recalculate from live controls and could make the three
    // modes appear identical.
    const mainKind=activeMainTab();
    updateDistributionControl();
    addOverlay(E.mainMap,'mainOverlay',mainKind,mainKind==='distribution'?0.58:0.48);
    if(mainKind==='distribution'&&E.distributionMode==='change')drawShiftArrows();else clearShiftLayer();
    if(mainKind==='distribution'&&E.grids.deltas.year!==2025&&E.distributionMode==='future'){
      drawProjectedPoints();
    } else if(mainKind==='distribution'&&E.grids.deltas.year!==2025&&E.distributionMode==='change'){
      clearProjectedLayer(); setOccurrenceVisible(false);
    } else {
      clearProjectedLayer(); setOccurrenceVisible(true);
    }
    const forestKind=activeForestTab();
    addOverlay(E.forestMap,'forestOverlay',forestKind,0.46);
    updateNotes(mainKind,forestKind);
  }
  function scheduleRefresh(delay,allowRebuild) {
    clearTimeout(E.refreshTimer);
    E.refreshTimer=setTimeout(()=>{
      try{
        // refreshMaps renders E.grids only. Grid rebuilding is performed solely
        // by runEngine(), so draft scenario edits cannot change calculations.
        refreshMaps();
      }catch(err){console.error('Species map overlay:',err);}
    },delay||120);
  }

  async function runEngine() {
    if(E.running)return;
    E.running=true;
    try{
      if(!E.rasters){E.rasters=await loadRasters();computeBaselineMedians();}
      E.models=[];
      for(let i=0;i<SPECIES.length;i++){const m=fitSpecies(SPECIES[i],i);if(m)E.models.push(m);}
      E.ran=E.models.length>0;
      if(E.ran){
        buildGrids();
        scheduleRefresh(120);
        // The original Run UI continues rendering progress after this engine
        // finishes; re-apply the completed result after that animation settles.
        scheduleRefresh(2800);
      }
    } catch(err) {
      console.error('Species habitat engine failed:',err);
    } finally { E.running=false; }
  }

  window.HORNBILL_SPECIES_MAPS = {
    refresh: (delay) => scheduleRefresh(delay == null ? 0 : delay),
    run: () => runEngine()
  };

  // Keep calculations tied to the student's original controls.
  document.addEventListener('click', e => {
    const el=e.target.closest('[data-action]'); if(!el)return;
    const action=el.getAttribute('data-action');
    // app.js re-renders immediately when Run is clicked. Wait until that render
    // has committed the current draft scenario to application state/DOM, then
    // rebuild the habitat grids from exactly those values.
    if(action==='runModel') setTimeout(runEngine,520);
    if(action==='setMapTab'||action==='setForestRiskTab'||action==='toggleSpecies') scheduleRefresh(180);
  });
  document.addEventListener('change', e => {
    const el=e.target;
    if(el.matches('select[data-field="targetYear"]')){
      const year=Number(el.value);
      if(year===2025){
        // Returning to the baseline must always restore the real occurrence map.
        // Do not leave the Compare control in Change/Scenario with hidden GBIF
        // points or old shift arrows from a future-year run.
        E.distributionMode='current';
        clearProjectedLayer();
        clearShiftLayer();
        setOccurrenceVisible(true);
        updateDistributionControl();
        setTimeout(()=>runEngine(),120);
      } else {
        // Future-year values are drafts until Run. Keep the last computed result
        // visible, but never hide the real points simply because the year changed.
        clearProjectedLayer();
        clearShiftLayer();
        setOccurrenceVisible(true);
        if(activeMainTab()==='distribution') {
          E.distributionMode='current';
          updateDistributionControl();
          scheduleRefresh(80,false);
        }
      }
    }
  });

  // Re-render the last computed overlays after DOM redraws, without using
  // newly edited future scenario values.
  const obs=new MutationObserver(()=>{if(E.ran)scheduleRefresh(90,false);});
  document.addEventListener('DOMContentLoaded',()=>{
    ensureDistributionControl();
    const app=document.getElementById('app'); if(app)obs.observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
    // Prepare the baseline habitat grids automatically so 2025 Current/Change
    // views are available without requiring a manual Run click.
    setTimeout(()=>runEngine(),300);
  });
})();
