// Visual policy: upper environmental tabs show environmental raster values only.
// Habitat-risk overlays remain on the lower Forest Cover × Habitat Risk map.
(function(){
  'use strict';

  function activeUpperTab(){
    if(document.getElementById('mapTabTemperature')?.classList.contains('active')) return 'temperature';
    if(document.getElementById('mapTabRainfall')?.classList.contains('active')) return 'rainfall';
    if(document.getElementById('mapTabDust')?.classList.contains('active')) return 'dust';
    return 'distribution';
  }

  function currentScenarioText(tab){
    const field = tab==='temperature'?'tempDelta':tab==='rainfall'?'rainfallDelta':'dustDelta';
    const el=document.querySelector(`input[data-onchange="climateAbsolute"][data-field="${field}"]`);
    const val=el?Number(el.value):null;
    if(val===null||!isFinite(val)) return null;
    const name=tab==='temperature'?'Temperature':tab==='rainfall'?'Rainfall':'PM2.5';
    const unit=tab==='temperature'?'°C':tab==='rainfall'?'mm':'µg/m³';
    return `${name} Map — scenario value ${val.toLocaleString(undefined,{maximumFractionDigits:1})} ${unit}. Colors represent ${name.toLowerCase()} values, not bird risk.`;
  }

  function enforceUpperMap(){
    const tab=activeUpperTab();
    const map=document.getElementById('leafletMap');
    if(!map) return;

    // On environmental-value tabs, keep the high-opacity scenario raster and
    // hide lower-opacity model/risk image overlays that can otherwise be added
    // by the species engine. This keeps Temperature/Rainfall/PM2.5 maps as
    // environmental value maps rather than risk maps.
    const imgs=map.querySelectorAll('.leaflet-overlay-pane img.leaflet-image-layer');
    imgs.forEach(img=>{
      if(tab==='distribution'){
        if(img.dataset.hornbillDisplayHidden==='1'){
          img.style.display='';
          delete img.dataset.hornbillDisplayHidden;
        }
        return;
      }
      const opacity=parseFloat(img.style.opacity||getComputedStyle(img).opacity||'1');
      if(opacity < 0.8){
        img.style.display='none';
        img.dataset.hornbillDisplayHidden='1';
      } else if(img.dataset.hornbillDisplayHidden==='1'){
        img.style.display='';
        delete img.dataset.hornbillDisplayHidden;
      }
    });

    if(tab!=='distribution'){
      const note=document.getElementById('mapRealNote');
      const txt=currentScenarioText(tab);
      if(note&&txt) note.textContent=txt;
    }
  }

  function fixRiskLabels(){
    const title=document.getElementById('forestRiskPanelTitle');
    const th=document.getElementById('langThBtn')?.classList.contains('active');
    if(title) title.textContent=th?'พื้นที่ป่าไม้ × ความเสี่ยงต่อถิ่นอาศัย':'Forest Cover × Habitat Risk';
    const a=document.getElementById('riskTabRainfall');
    const b=document.getElementById('riskTabTemperature');
    const c=document.getElementById('riskTabDust');
    if(a) a.textContent=th?'ความเสี่ยงจากปริมาณฝน':'Rainfall Risk';
    if(b) b.textContent=th?'ความเสี่ยงจากอุณหภูมิ':'Temperature Risk';
    if(c) c.textContent=th?'ความเสี่ยงจาก PM2.5':'PM2.5 Risk';
    const scale=document.getElementById('forestRiskScaleLabels');
    if(scale) scale.style.display='none';
  }

  let timer;
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{enforceUpperMap();fixRiskLabels();},80);}

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-action="setMapTab"],[data-action="setForestRiskTab"],[data-action="setLang"],[data-action="runModel"],[data-action="toggleSpecies"]')){
      schedule();setTimeout(schedule,350);setTimeout(schedule,900);
    }
  });
  document.addEventListener('change',e=>{
    if(e.target.matches('select[data-field="targetYear"],input[data-onchange="climateAbsolute"]')){
      schedule();setTimeout(schedule,450);
    }
  });
  document.addEventListener('DOMContentLoaded',()=>{
    schedule();
    const map=document.getElementById('leafletMap');
    if(map){
      const obs=new MutationObserver(schedule);
      obs.observe(map,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});
    }
  });
})();