// Keeps the habitat comparison controls bilingual with the rest of the UI.
(function () {
  'use strict';

  const TEXT = {
    en: {
      current: 'Current', scenario: 'Scenario', change: 'Change',
      modePrefix: 'MODE',
      stable: 'Stable', gain: 'Gain', loss: 'Loss', projected: 'Projected',
      noteCurrent: 'Current: real GBIF occurrence points.',
      noteScenario: 'Scenario: yellow-ring points are projected suitable locations after the last Run; they are not bird counts.',
      noteChange: 'Change: blue = stable · green = gain · red = loss. Yellow-ring points are projected suitable locations; dashed arrows show centroid shift.'
    },
    th: {
      current: 'ปัจจุบัน', scenario: 'สถานการณ์จำลอง', change: 'การเปลี่ยนแปลง',
      modePrefix: 'โหมด',
      stable: 'คงเดิม', gain: 'เพิ่มขึ้น', loss: 'ลดลง', projected: 'จุดคาดการณ์',
      noteCurrent: 'ปัจจุบัน: แสดงตำแหน่งที่พบนกจริงจากข้อมูล GBIF',
      noteScenario: 'สถานการณ์จำลอง: จุดที่มีวงสีเหลืองคือพื้นที่เหมาะสมที่แบบจำลองคาดการณ์หลังการกด Run ไม่ใช่จำนวนตัวนก',
      noteChange: 'การเปลี่ยนแปลง: สีน้ำเงิน = คงเดิม · สีเขียว = เพิ่มขึ้น · สีแดง = ลดลง จุดวงสีเหลืองคือพื้นที่เหมาะสมที่คาดการณ์ และเส้นประแสดงการเลื่อนของศูนย์กลางพื้นที่เหมาะสม'
    }
  };

  function lang() {
    return document.getElementById('langThBtn')?.classList.contains('active') ? 'th' : 'en';
  }
  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }
  function activeMode(bar) {
    return bar.querySelector('button[data-mode].active')?.dataset.mode || 'current';
  }
  function apply() {
    const bar = document.getElementById('habitatCompareBar');
    if (!bar) return;
    const L = TEXT[lang()];
    const labels = { current: L.current, scenario: L.scenario, change: L.change };
    bar.querySelectorAll('button[data-mode]').forEach(btn => setText(btn, labels[btn.dataset.mode] || btn.dataset.mode));

    const mode = activeMode(bar);
    const modeLabel = bar.querySelector('#habitatModeLabel');
    if (modeLabel) setText(modeLabel, L.modePrefix + ': ' + (labels[mode] || mode));

    const legend = bar.querySelector('#habitatCompareLegend');
    if (legend) {
      const spans = legend.querySelectorAll('span');
      const legendText = [L.stable, L.gain, L.loss, L.projected];
      spans.forEach((span, i) => {
        const icon = span.querySelector('i');
        if (!icon || i >= legendText.length) return;
        Array.from(span.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
        span.appendChild(document.createTextNode(legendText[i]));
      });
    }

    if (document.getElementById('mapTabDist')?.classList.contains('active')) {
      const note = document.getElementById('mapRealNote');
      if (note) {
        const txt = mode === 'change' ? L.noteChange : mode === 'scenario' ? L.noteScenario : L.noteCurrent;
        setText(note, txt);
      }
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#langThBtn,#langEnBtn,#habitatCompareBar')) setTimeout(apply, 80);
  });

  const observer = new MutationObserver(() => setTimeout(apply, 0));
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const app = document.getElementById('app');
    if (app) observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
})();
