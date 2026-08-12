const T = {
  en: {
    top: { title: 'Hornbill Habitat Model × GIS', subtitle: 'A prototype tool combining MaxEnt-style habitat modeling with an interactive vector map — all on one page. Loads real occurrence data and real climate rasters by default; upload your own environmental layers, then click Run.' },
    envLayers: { title: 'Environmental Layers' },
    mapPanel: { title: 'Prediction Map', distribution: 'Hornbill Distribution', compare: 'Compare Scenario', low: 'Low', high: 'High', denseForest: 'Dense / primary forest', secondaryForest: 'Secondary / mixed forest' },
    results: { title: 'Results', responseCurves: 'Response Curves', variableImportance: 'Variable Importance', noResults: 'No results yet — load environmental layers then click Run.' },
    modelStatus: { loading: 'Loading…', running: 'Running…', complete: 'Complete', notrun: 'Not run' },
    layers: { addBtn: '+ Add Variable', ready: 'Ready', notLoaded: 'Not loaded', groups: { Topography: 'Topography', Vegetation: 'Vegetation', Climate: 'Climate', 'Human Disturbance': 'Human Disturbance' },
      loadedLabel: 'layers loaded', resolution: 'Resolution', mismatch: 'mismatch', rasterDropzone: 'Drag .tif raster files here (any number at once), or click to choose',
      chooseVariable: 'Assign to variable…', valueRange: 'Value range', extent: 'Extent', pointsOutside: 'occurrence points fall outside this raster', changeFile: '🔄 Replace file' },
    simulation: { running: 'Running…', runAgain: 'Run Again', run: 'Run', notePipeline: 'Processing pipeline in progress', noteComplete: 'Model run complete', noteReady: 'Ready to run', noteBlocked: 'Load at least one environmental layer raster first' },
    suitability: { mean: 'Mean HSI (occurrence pts):' },
    risk: { highArea: 'High-risk occurrence points:', ofArea: 'show declining suitability under this scenario' },
    map: { basemap: 'Basemap', realNote: 'Live OpenStreetMap basemap and real occurrence records from GBIF.' },
    variables: { 'Forest Patch Size': 'Forest Patch Size', 'NDVI (Vegetation Index)': 'NDVI (Vegetation Index)', 'Canopy Density': 'Canopy Density', 'Elevation': 'Elevation', 'Distance to Road': 'Distance to Road', 'Mean Annual Rainfall': 'Mean Annual Rainfall', 'Distance to River': 'Distance to River', 'Slope': 'Slope', 'Mean Temperature': 'Mean Temperature', 'Distance to Settlement': 'Distance to Settlement', 'Mean PM2.5 (Dust)': 'Mean PM2.5 (Dust)' },
    climate: {
      title: 'Future Climate Scenario', optimalTitle: 'Optimal conditions (current)',
      projectTitle: 'Project to target year', yearLabel: 'Target year', projectedLabel: 'Projected value',
      tempLabel: 'Temperature change', rainfallLabel: 'Rainfall change', dustLabel: 'Dust (PM2.5) change',
      responseCurvesTitle: 'Response Curves (climate)', variableImportanceTitle: 'Variable Importance (climate)',
      note: 'Illustrative — reuses the same fitted model with temp/rainfall/dust shifted by the deltas below.'
    }
  },
  th: {
    top: { title: 'แบบจำลองถิ่นอาศัยนกเงือก × GIS', subtitle: 'ต้นแบบเครื่องมือที่รวมการสร้างแบบจำลองถิ่นอาศัยสไตล์ MaxEnt เข้ากับแผนที่ GIS แบบโต้ตอบในหน้าเดียว — มีข้อมูลจุดพบจริงและราสเตอร์ภูมิอากาศจริงให้พร้อมใช้ อัปโหลดชั้นข้อมูลสิ่งแวดล้อมของคุณเองแล้วกด Run' },
    envLayers: { title: 'ชั้นข้อมูลสิ่งแวดล้อม' },
    mapPanel: { title: 'แผนที่ผลการทำนาย', distribution: 'การกระจายพันธุ์นกเงือก', compare: 'เทียบสถานการณ์', low: 'ต่ำ', high: 'สูง', denseForest: 'ป่าดิบชื้น (หนาแน่น)', secondaryForest: 'ป่าเบญจพรรณ/รอง' },
    results: { title: 'ผลลัพธ์', responseCurves: 'กราฟความสัมพันธ์ตัวแปร (Response Curves)', variableImportance: 'อิทธิพลของตัวแปร (Variable Importance)', noResults: 'ยังไม่มีผลลัพธ์ — โหลดชั้นข้อมูลสิ่งแวดล้อมแล้วกด Run' },
    modelStatus: { loading: 'กำลังโหลด…', running: 'กำลังประมวลผล…', complete: 'เสร็จสมบูรณ์', notrun: 'ยังไม่รัน' },
    layers: { addBtn: '+ เพิ่มตัวแปร', ready: 'พร้อม', notLoaded: 'ยังไม่โหลด', groups: { Topography: 'ภูมิประเทศ', Vegetation: 'พืชพรรณ', Climate: 'ภูมิอากาศ', 'Human Disturbance': 'สิ่งรบกวนจากมนุษย์' },
      loadedLabel: 'ตัวแปรโหลดแล้ว', resolution: 'ความละเอียด', mismatch: 'ไม่ตรงกัน', rasterDropzone: 'ลากไฟล์ .tif มาวางที่นี่ (เลือกได้หลายไฟล์พร้อมกัน) หรือคลิกเพื่อเลือก',
      chooseVariable: 'เลือกตัวแปรที่จะผูก…', valueRange: 'ช่วงค่า', extent: 'ขอบเขต', pointsOutside: 'จุดพบนกอยู่นอกขอบเขตไฟล์นี้', changeFile: '🔄 เปลี่ยนไฟล์' },
    simulation: { running: 'กำลังรัน…', runAgain: 'รันอีกครั้ง', run: 'Run', notePipeline: 'กำลังประมวลผลตามขั้นตอน', noteComplete: 'รันแบบจำลองเสร็จแล้ว', noteReady: 'พร้อมรัน', noteBlocked: 'กรุณาโหลดชั้นข้อมูลสิ่งแวดล้อมอย่างน้อย 1 ชั้นก่อน' },
    suitability: { mean: 'ค่าเฉลี่ย HSI (จุดพบ):' },
    risk: { highArea: 'จุดพบที่มีความเสี่ยงสูง:', ofArea: 'มีความเหมาะสมลดลงในสถานการณ์นี้' },
    map: { basemap: 'แผนที่ฐาน', realNote: 'แผนที่ฐาน OpenStreetMap จริง และข้อมูลจุดพบนกจริงจาก GBIF' },
    variables: { 'Forest Patch Size': 'ขนาดผืนป่าต่อเนื่อง', 'NDVI (Vegetation Index)': 'ดัชนีพืชพรรณ (NDVI)', 'Canopy Density': 'ความหนาแน่นเรือนยอด', 'Elevation': 'ระดับความสูง', 'Distance to Road': 'ระยะห่างจากถนน', 'Mean Annual Rainfall': 'ปริมาณน้ำฝนเฉลี่ยรายปี', 'Distance to River': 'ระยะห่างจากแม่น้ำ', 'Slope': 'ความลาดชัน', 'Mean Temperature': 'อุณหภูมิเฉลี่ย', 'Distance to Settlement': 'ระยะห่างจากชุมชน', 'Mean PM2.5 (Dust)': 'ฝุ่น PM2.5 เฉลี่ย' },
    climate: {
      title: 'จำลองสถานการณ์อนาคต', optimalTitle: 'ค่าที่เหมาะสมที่สุด (ปัจจุบัน)',
      projectTitle: 'คาดการณ์ถึงปีเป้าหมาย', yearLabel: 'ปีเป้าหมาย', projectedLabel: 'ค่าที่คาดการณ์',
      tempLabel: 'อุณหภูมิเปลี่ยนแปลง', rainfallLabel: 'ปริมาณฝนเปลี่ยนแปลง', dustLabel: 'ฝุ่น (PM2.5) เปลี่ยนแปลง',
      responseCurvesTitle: 'กราฟความสัมพันธ์ (ภูมิอากาศ)', variableImportanceTitle: 'อิทธิพลของตัวแปร (ภูมิอากาศ)',
      note: 'เป็นภาพประกอบ — ใช้โมเดลเดิมที่ฟิตไว้แล้ว แทนค่า Temp/ฝน/ฝุ่นด้วยค่าที่เปลี่ยนไปตามด้านล่าง'
    }
  }
};
