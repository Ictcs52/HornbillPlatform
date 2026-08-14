// Scenario-aware environmental maps for the original student UI.
(function(){
  'use strict';
  const M={main:null,rasters:null,overlay:null,baseline:{temp:null,rainfall:null,dust:null},panel:null,ready:false,panelCollapsed:false,refreshTimer:null};
  const oldMap=L.map.bind(L);
  L.map=function(id,opt){const m=oldMap(id,opt);if(id==='leafletMap')M.main=m;return m;};

  function median(a){if(!a.length)return null;a=a.slice().sort((x,y)=>x-y);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
  function activeTab(){if(document.getElementById('mapTabTemperature')?.classList.contains('active'))return'temp';if(document.getElementById('mapTabRainfall')?.classList.contains('active'))return'rainfall';if(document.getElementById('mapTabDust')?.classList.contains('active'))return'dust';return'distribution';}
  function input(field){const e=document.querySelector(`input[data-onchange="climateAbsolute"][data-field="${field}"]`);return e?Number(e.value):null;}
  function deltas(){const t=input('tempDelta'),r=input('rainfallDelta'),d=input('dustDelta');return{temp:t===null?0:t-M.baseline.temp,rainfall:r===null?0:r-M.baseline.rainfall,dust:d===null?0:d-M.baseline.dust};}

  function insideRing(lat,lon,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>lat)!==(yj>lat))&&lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi)inside=!inside;}return inside;}
  function inside(lat,lon){const g=typeof THAILAND_BOUNDARY!=='undefined'?THAILAND_BOUNDARY:null;if(!g)return true;const x=g.type==='Feature'?g.geometry:g;if(x.type==='Polygon')return insideRing(lat,lon,x.coordinates[0]);if(x.type==='MultiPolygon')return x.coordinates.some(p=>insideRing(lat,lon,p[0]));return true;}

  function observedMedian(r){const vals=[];SPECIES.forEach(sp=>sp.points.forEach(p=>{const v=sampleRasterAt(r,p[0],p[1]);if(v!==null&&isFinite(v))vals.push(v);}));return median(vals);}
  function shiftedUrl(kind){const src=M.rasters[kind],mapId=kind==='temp'?'temperature':kind,delta=deltas()[kind],band=new Float32Array(src.band.length);let min=Infinity,max=-Infinity;for(let i=0;i<src.band.length;i++){const v=src.band[i];if(src.nodata!==null&&v===src.nodata){band[i]=v;continue;}const nv=v+delta;band[i]=nv;if(nv<min)min=nv;if(nv>max)max=nv;}return renderRasterToDataUrl({...src,band,min,max},RASTER_RAMPS[mapId],THAILAND_BOUNDARY,RASTER_CLASSES[mapId].breaks);}

  function updateMap(){if(!M.ready||!M.main)return;const tab=activeTab();if(M.overlay&&M.main.hasLayer(M.overlay)){M.main.removeLayer(M.overlay);M.overlay=null;}if(tab==='distribution'){updatePanel(false);return;}const r=M.rasters[tab],[w,s,e,n]=r.bbox;M.overlay=L.imageOverlay(shiftedUrl(tab),[[s,w],[n,e]],{opacity:.9,interactive:false}).addTo(M.main);if(M.overlay.bringToFront)M.overlay.bringToFront();const d=deltas()[tab],note=document.getElementById('mapRealNote');if(note){const name=tab==='temp'?'Temperature':tab==='rainfall'?'Rainfall':'PM2.5',unit=tab==='temp'?'°C':tab==='rainfall'?'mm':'µg/m³';note.textContent=`${name} scenario = current raster ${d>=0?'+':''}${d.toFixed(tab==='rainfall'?0:1)} ${unit}`;}updatePanel(tab==='dust');}

  const REG=[{id:'N',th:'ภาคเหนือ',en:'North'},{id:'NE',th:'ภาคตะวันออกเฉียงเหนือ',en:'Northeast'},{id:'C',th:'ภาคกลาง',en:'Central'},{id:'E',th:'ภาคตะวันออก',en:'East'},{id:'S',th:'ภาคใต้',en:'South'}];
  function pmColor(v){if(v<15)return'#2b98d1';if(v<25)return'#46aa78';if(v<37.5)return'#d3a91d';if(v<75)return'#ef6b2e';return'#c2185b';}
  function region(lat,lon){if(lat<10.8)return'S';if(lat>=15.4&&lon<101.7)return'N';if(lat>=14&&lon>=101.7)return'NE';if(lat<14.7&&lon>=100.8)return'E';return'C';}
  function calcRegional(){const r=M.rasters.dust,sums={N:0,NE:0,C:0,E:0,S:0},cnt={N:0,NE:0,C:0,E:0,S:0},[w,s,e,n]=r.bbox;for(let row=0;row<r.height;row++){const lat=n-(row+.5)/r.height*(n-s);for(let col=0;col<r.width;col++){const i=row*r.width+col,v=r.band[i];if(!isFinite(v)||(r.nodata!==null&&v===r.nodata))continue;const lon=w+(col+.5)/r.width*(e-w);if(!inside(lat,lon))continue;const id=region(lat,lon);sums[id]+=v;cnt[id]++;}}M.regional=Object.fromEntries(REG.map(x=>[x.id,cnt[x.id]?sums[x.id]/cnt[x.id]:null]));}

  function ensurePanel(){if(M.panel)return;const wrap=document.getElementById('mapWrap');if(!wrap)return;M.panel=document.createElement('aside');M.panel.className='pm25-region-panel';wrap.appendChild(M.panel);}
  function togglePanel(){M.panelCollapsed=!M.panelCollapsed;updatePanel(true);}
  function updatePanel(show){
    ensurePanel();if(!M.panel)return;
    M.panel.style.display=show?'block':'none';
    if(!show||!M.regional)return;
    const th=document.getElementById('langThBtn')?.classList.contains('active'),delta=deltas().dust;
    const rows=REG.map(r=>{const val=M.regional[r.id]===null?null:Math.max(0,M.regional[r.id]+delta),c=val===null?'#8a8f80':pmColor(val);return`<div class="pm25-region-row"><b style="color:${c}">${r.id}</b><span>${th?r.th:r.en}</span><strong style="color:${c};border-color:${c}">${val===null?'—':val.toFixed(1)}</strong></div>`;}).join('');
    M.panel.classList.toggle('collapsed',M.panelCollapsed);
    M.panel.innerHTML=`<div class="pm25-region-head"><div class="pm25-region-title">${th?'ค่าฝุ่น PM2.5 เฉลี่ยรายภาค':'Regional average PM2.5'} <span>(µg/m³)</span></div><button type="button" class="pm25-region-toggle" aria-label="${M.panelCollapsed?'Expand':'Collapse'}" title="${M.panelCollapsed?'Expand':'Collapse'}">${M.panelCollapsed?'‹':'›'}</button></div><div class="pm25-region-body">${rows}<div class="pm25-region-note">${th?'คำนวณจาก raster และปรับตาม PM2.5 Scenario':'Raster mean adjusted by PM2.5 scenario'}</div></div>`;
    const btn=M.panel.querySelector('.pm25-region-toggle');if(btn)btn.addEventListener('click',togglePanel);
  }

  function styles(){const s=document.createElement('style');s.textContent=`#forestRiskScaleLabels{display:none!important}.pm25-region-panel{position:absolute;right:10px;top:54px;z-index:1200;width:225px;background:#fff;border:1px solid #e9e4d6;border-radius:8px;padding:11px;box-shadow:0 2px 7px rgba(0,0,0,.16);transition:width .18s ease,padding .18s ease}.pm25-region-head{display:flex;align-items:flex-start;gap:7px}.pm25-region-title{font-size:11.5px;font-weight:700;line-height:1.35;flex:1}.pm25-region-title span{color:#8a8f80}.pm25-region-toggle{width:25px;height:25px;flex:0 0 25px;border:1px solid #d8d2bf;border-radius:5px;background:#fff;color:#6b7062;font-size:16px;line-height:1;cursor:pointer}.pm25-region-toggle:hover{background:#f2ede3}.pm25-region-row{display:grid;grid-template-columns:28px 1fr 52px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid #f0ede1;font-size:10.5px}.pm25-region-row span{color:#6b7062}.pm25-region-row strong{text-align:center;border:1px solid;border-radius:5px;padding:4px;background:#fff}.pm25-region-note{font-size:9.5px;color:#8a8f80;line-height:1.4;margin-top:8px}.pm25-region-panel.collapsed{width:42px;padding:8px}.pm25-region-panel.collapsed .pm25-region-title,.pm25-region-panel.collapsed .pm25-region-body{display:none}.pm25-region-panel.collapsed .pm25-region-head{justify-content:center}@media(max-width:700px){.pm25-region-panel{right:8px;top:54px;width:200px}}`;document.head.appendChild(s);}

  function schedule(delay){clearTimeout(M.refreshTimer);M.refreshTimer=setTimeout(updateMap,delay||180);}
  document.addEventListener('click',e=>{if(e.target.closest('[data-action="setMapTab"],[data-action="setLang"],[data-action="runModel"]'))schedule(180);});
  document.addEventListener('change',e=>{if(e.target.matches('select[data-field="targetYear"],input[data-onchange="climateAbsolute"]'))schedule(220);});
  document.addEventListener('DOMContentLoaded',async()=>{styles();try{M.rasters={temp:await fetchGeoTiff('./assets/rasters/mean_temp_annual_tmd_1991-2020.tif','temperature'),rainfall:await fetchGeoTiff('./assets/rasters/rainfall_annual_tmd_1991-2020.tif','rainfall'),dust:await fetchGeoTiff('./assets/rasters/pm25_regional_2014-2024.tif','pm25')};M.baseline.temp=observedMedian(M.rasters.temp);M.baseline.rainfall=observedMedian(M.rasters.rainfall);M.baseline.dust=observedMedian(M.rasters.dust);calcRegional();M.ready=true;schedule(100);}catch(err){console.error('Scenario maps:',err);}});
})();