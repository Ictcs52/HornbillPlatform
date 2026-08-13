// HornbillPlatform species-level analysis engine.
// IMPORTANT: this file adds no UI and creates no map. It only augments the
// original student-designed Leaflet maps and reacts to the original controls.
(function () {
  'use strict';

  const CFG = {
    seed: 2569, thinDeg: 0.025, backgroundN: 1200, minPresence: 20,
    fit: { lr: 0.22, iters: 220, l2: 0.025 },
    paths: {
      temp: './assets/rasters/mean_temp_annual_tmd_1991-2020.tif',
      rainfall: './assets/rasters/rainfall_annual_tmd_1991-2020.tif',
      dust: './assets/rasters/pm25_regional_2014-2024.tif',
      forest: './assets/rasters/forest_cover_2025_hansen.tif'
    }
  };

  const E = { maps:{}, rasters:null, models:[], grid:null, overlay:null, riskOverlay:null,
    running:false, ready:false, selected:new Set(SPECIES.map(s=>s.id)),
    scenario:{year:2025,temp:0,rainfall:0,dust:0}, tab:'distribution' };

  // Capture the existing Leaflet instances created later by app.js. No extra maps.
  const originalLMap = L.map.bind(L);
  L.map = function (id, options) {
    const m = originalLMap(id, options);
    const key = typeof id === 'string' ? id : (id && id.id);
    if (key) E.maps[key] = m;
    return m;
  };

  function hash(s){let h=2166136261>>>0;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
  function sig(z){return z>35?1:z<-35?0:1/(1+Math.exp(-z));}
  function inRing(lat,lon,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>lat)!==(yj>lat))&&lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi)inside=!inside;}return inside;}
  function inGeo(lat,lon,geo){const g=geo&&geo.type==='Feature'?geo.geometry:geo;if(!g)return true;const poly=p=>{if(!inRing(lat,lon,p[0]))return false;for(let i=1;i<p.length;i++)if(inRing(lat,lon,p[i]))return false;return true;};return g.type==='Polygon'?poly(g.coordinates):g.type==='MultiPolygon'?g.coordinates.some(poly):true;}
  function clean(sp){const raw=(sp.points||[]).filter(p=>Array.isArray(p)&&isFinite(p[0])&&isFinite(p[1]));const exact=[],seen=new Set();for(const p of raw){const k=(+p[0]).toFixed(6)+','+(+p[1]).toFixed(6);if(!seen.has(k)){seen.add(k);exact.push(p);}}const cells=new Set(),out=[];for(const p of exact){if(!inGeo(p[0],p[1],THAILAND_BOUNDARY))continue;const k=Math.floor(p[0]/CFG.thinDeg)+':'+Math.floor(p[1]/CFG.thinDeg);if(!cells.has(k)){cells.add(k);out.push(p);}}return out;}
  function stats(rows){return rows[0].map((_,j)=>{const v=rows.map(r=>r[j]),mean=v.reduce((a,b)=>a+b,0)/v.length,vr=v.reduce((a,b)=>a+(b-mean)**2,0)/v.length;return{mean,std:Math.sqrt(vr)||1};});}
  function zrow(st,row){return row.map((v,j)=>(v-st[j].mean)/st[j].std);}
  function fitLR(X,y){const w=new Array(X[0].length).fill(0);let b=0;for(let it=0;it<CFG.fit.iters;it++){const gw=w.map(()=>0);let gb=0;for(let i=0;i<X.length;i++){let s=b;for(let j=0;j<w.length;j++)s+=w[j]*X[i][j];const e=sig(s)-y[i];for(let j=0;j<w.length;j++)gw[j]+=e*X[i][j];gb+=e;}for(let j=0;j<w.length;j++)w[j]-=CFG.fit.lr*(gw[j]/X.length+CFG.fit.l2*w[j]);b-=CFG.fit.lr*gb/X.length;}return{w,b};}
  function pred(m,row){let s=m.b;for(let j=0;j<row.length;j++)s+=m.w[j]*row[j];return sig(s);}
  function auc(scores,y){const o=scores.map((_,i)=>i).sort((a,b)=>scores[a]-scores[b]),r=new Array(scores.length);let i=0;while(i<o.length){let j=i+1;while(j<o.length&&scores[o[j]]===scores[o[i]])j++;const av=(i+1+j)/2;for(let k=i;k<j;k++)r[o[k]]=av;i=j;}let np=0,nn=0,sr=0;y.forEach((v,i)=>{if(v){np++;sr+=r[i];}else nn++;});return np&&nn?(sr-np*(np+1)/2)/(np*nn):null;}
  function shuffle(n,R){const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i;i--){const j=Math.floor(R()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function cv(X,y,seed){const o=shuffle(X.length,rng(seed)),sz=Math.ceil(X.length/5),aa=[];for(let f=0;f<5;f++){const test=new Set(o.slice(f*sz,(f+1)*sz)),tx=[],ty=[],vx=[],vy=[];for(let i=0;i<X.length;i++)test.has(i)?(vx.push(X[i]),vy.push(y[i])):(tx.push(X[i]),ty.push(y[i]));if(!tx.length||!vx.length)continue;const m=fitLR(tx,ty),a=auc(vx.map(r=>pred(m,r)),vy);if(a!==null)aa.push(a);}return aa.length?aa.reduce((a,b)=>a+b,0)/aa.length:null;}
  function threshold(scores,y){let best={t:.5,j:-9};for(let t=.15;t<=.85;t+=.01){let tp=0,fn=0,tn=0,fp=0;y.forEach((v,i)=>v?(scores[i]>=t?tp++:fn++):(scores[i]>=t?fp++:tn++));const j=tp/(tp+fn||1)+tn/(tn+fp||1)-1;if(j>best.j)best={t,j};}return best.t;}
  function sample(lat,lon,ids){const a=[];for(const id of ids){const v=sampleRasterAt(E.rasters[id],lat,lon);if(v===null||!isFinite(v))return null;a.push(v);}return a;}
  function bg(ids,pres,seed){const R=rng(seed),r=E.rasters.temp,[w,s,e,n]=r.bbox,used=new Set(pres.map(p=>Math.floor(p[0]/CFG.thinDeg)+':'+Math.floor(p[1]/CFG.thinDeg))),out=[];let tries=0;while(out.length<CFG.backgroundN&&tries++<CFG.backgroundN*60){const lat=s+R()*(n-s),lon=w+R()*(e-w),k=Math.floor(lat/CFG.thinDeg)+':'+Math.floor(lon/CFG.thinDeg);if(used.has(k)||!inGeo(lat,lon,THAILAND_BOUNDARY))continue;const row=sample(lat,lon,ids);if(row){used.add(k);out.push(row);}}return out;}
  function fitSpecies(sp){const pts=clean(sp),ids=['temp','rainfall','dust','forest'],px=[];pts.forEach(p=>{const r=sample(p[0],p[1],ids);if(r)px.push(r);});if(px.length<CFG.minPresence)return{sp,error:true};const seed=(CFG.seed+hash(sp.id))>>>0,b=bg(ids,pts,seed),raw=px.concat(b),st=stats(raw),X=raw.map(r=>zrow(st,r)),y=new Array(px.length).fill(1).concat(new Array(b.length).fill(0)),model=fitLR(X,y),scores=X.map(r=>pred(model,r));return{sp,ids,st,model,threshold:threshold(scores,y),cvAuc:cv(X,y,seed^0x9e3779b9)};}
  function center(r,row,col){const[w,s,e,n]=r.bbox;return[n-(row+.5)/r.height*(n-s),w+(col+.5)/r.width*(e-w)];}
  function prob(m,lat,lon){const cur=sample(lat,lon,m.ids);if(!cur)return null;const fut=cur.slice();m.ids.forEach((id,j)=>{if(id==='temp')fut[j]+=E.scenario.temp;if(id==='rainfall')fut[j]+=E.scenario.rainfall;if(id==='dust')fut[j]+=E.scenario.dust;});return{cur:pred(m.model,zrow(m.st,cur)),fut:pred(m.model,zrow(m.st,fut))};}
  function buildGrid(){const ref=E.rasters.temp,N=ref.width*ref.height,good=E.models.filter(m=>!m.error),cur=new Uint8Array(N),fut=new Uint8Array(N),by={};good.forEach(m=>by[m.sp.id]={cur:new Float32Array(N),fut:new Float32Array(N)});for(let row=0;row<ref.height;row++)for(let col=0;col<ref.width;col++){const i=row*ref.width+col,[lat,lon]=center(ref,row,col);if(!inGeo(lat,lon,THAILAND_BOUNDARY))continue;for(const m of good){const p=prob(m,lat,lon);if(!p)continue;by[m.sp.id].cur[i]=p.cur;by[m.sp.id].fut[i]=p.fut;if(p.cur>=m.threshold)cur[i]++;if(p.fut>=m.threshold)fut[i]++;}}E.grid={ref,cur,fut,by};}
  function rgbaRich(v,max){if(!v)return[0,0,0,0];const t=v/Math.max(1,max);return[Math.round(245-150*t),Math.round(238-70*t),Math.round(210-135*t),190];}
  function rgbaDiff(d){return d>0?[62,132,85,195]:d<0?[185,82,67,195]:[0,0,0,0];}
  function image(mode){const g=E.grid,r=g.ref,c=document.createElement('canvas');c.width=r.width;c.height=r.height;const x=c.getContext('2d'),im=x.createImageData(r.width,r.height),max=E.models.filter(m=>!m.error&&E.selected.has(m.sp.id)).length;for(let i=0;i<r.width*r.height;i++){let a;if(mode==='change')a=rgbaDiff(g.fut[i]-g.cur[i]);else{let count=0;for(const m of E.models)if(!m.error&&E.selected.has(m.sp.id)){const q=g.by[m.sp.id][mode==='future'?'fut':'cur'][i];if(q>=m.threshold)count++;}a=rgbaRich(count,max);}const p=i*4;im.data[p]=a[0];im.data[p+1]=a[1];im.data[p+2]=a[2];im.data[p+3]=a[3];}x.putImageData(im,0,0);return c.toDataURL('image/png');}
  function shiftedRasterImage(id,delta){const r=E.rasters[id],ramp=RASTER_RAMPS[id==='temp'?'temperature':id],classes=RASTER_CLASSES[id==='temp'?'temperature':id];if(!r||!ramp)return null;const copy={...r,data:r.data.map(v=>(v===r.nodata||!isFinite(v))?v:v+delta)};return renderRasterToDataUrl(copy,ramp,THAILAND_BOUNDARY,classes?classes.breaks:null);}
  function clearOverlay(which){const map=E.maps[which],key=which==='leafletMap'?'overlay':'riskOverlay';if(map&&E[key]){map.removeLayer(E[key]);E[key]=null;}}
  function paintOriginalMap(){const map=E.maps.leafletMap;if(!map||!E.ready)return;clearOverlay('leafletMap');const r=E.grid.ref,[w,s,e,n]=r.bbox;let url=null;
    if(E.tab==='distribution') url=image(E.scenario.year===2025?'current':'future');
    else if(E.tab==='temperature') url=shiftedRasterImage('temp',E.scenario.temp);
    else if(E.tab==='rainfall') url=shiftedRasterImage('rainfall',E.scenario.rainfall);
    else if(E.tab==='dust') url=shiftedRasterImage('dust',E.scenario.dust);
    if(url)E.overlay=L.imageOverlay(url,[[s,w],[n,e]],{opacity:E.tab==='distribution'?.48:.72,interactive:false}).addTo(map);
  }
  function paintRiskMap(){const map=E.maps.forestRiskMap;if(!map||!E.ready)return;clearOverlay('forestRiskMap');const r=E.grid.ref,[w,s,e,n]=r.bbox;E.riskOverlay=L.imageOverlay(image('change'),[[s,w],[n,e]],{opacity:.42,interactive:false}).addTo(map);}
  async function run(){if(E.running)return;E.running=true;try{if(!E.rasters){E.rasters={};for(const[id,url]of Object.entries(CFG.paths))E.rasters[id]=await fetchGeoTiff(url,url.split('/').pop());}E.models=SPECIES.map(fitSpecies);buildGrid();E.ready=true;paintOriginalMap();paintRiskMap();}catch(err){console.error('Species analysis engine:',err);}finally{E.running=false;}}
  function readScenario(){const year=document.querySelector('[data-onchange="setting"][data-field="targetYear"]');E.scenario.year=year?Number(year.value):2025;const fields={temp:'tempDelta',rainfall:'rainfallDelta',dust:'dustDelta'};for(const[id,field]of Object.entries(fields)){const input=document.querySelector(`[data-onchange="climateAbsolute"][data-field="${field}"]`);if(!input)continue;const m=E.models.find(x=>!x.error),j=m?m.ids.indexOf(id):-1;const baseline=m&&j>=0?m.st[j].mean:Number(input.value);E.scenario[id]=Number(input.value)-baseline;}}
  function scheduleScenario(){setTimeout(()=>{readScenario();if(E.ready){buildGrid();paintOriginalMap();paintRiskMap();}},80);}

  document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action,id=el.dataset.id;if(a==='toggleSpecies'){E.selected.has(id)?E.selected.delete(id):E.selected.add(id);setTimeout(paintOriginalMap,50);}else if(a==='setMapTab'){E.tab=id;setTimeout(paintOriginalMap,50);}else if(a==='runModel'){setTimeout(run,60);}else if(a==='setForestRiskTab'){setTimeout(paintRiskMap,50);}});
  document.addEventListener('change',e=>{const el=e.target;if(el.matches('[data-onchange="climateAbsolute"],[data-onchange="setting"][data-field="targetYear"]'))scheduleScenario();});

  // Public read-only diagnostic hook for development; no visible UI is added.
  window.HornbillSpeciesEngine={run,get ready(){return E.ready;},get models(){return E.models;},get scenario(){return{...E.scenario};}};
})();
