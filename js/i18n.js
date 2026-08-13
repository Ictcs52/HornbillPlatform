const T = {
  en: {
    top: { title: 'Hornbill Habitat Model × GIS', subtitle: 'A prototype tool combining MaxEnt-style habitat modeling with an interactive vector map — all on one page. Loads real occurrence data and real climate rasters by default; upload your own environmental layers, then click Run.' },
    footer: { text: 'Research prototype — not for operational conservation decisions. Occurrence data: GBIF. Climate data: TMD Climate Atlas.' },
    samples: { title: 'Samples', dropzone: 'Upload CSV (species,lon,lat), or click to upload', useSample: 'Use sample data' },
    occurrence: { validate: 'Validate Data', included: 'Included', excluded: 'Excluded' },
    envLayers: { title: 'Environmental Layers' },
    mapPanel: { title: 'Prediction Map', distribution: 'Hornbill Distribution', rainfallMap: 'Rainfall Map', temperatureMap: 'Temperature Map', forestMap: 'Forest Map', dustMap: 'PM2.5 Map', denseForest: 'Dense / primary forest', secondaryForest: 'Secondary / mixed forest', rasterNotLoaded: 'This raster hasn’t loaded yet — upload a .tif in Environmental Layers, or wait for the default to finish loading.' },
    results: { title: 'Results', responseCurves: 'Response Curves', variableImportance: 'Variable Importance', noResults: 'No results yet — load environmental layers then click Run.' },
    modelStatus: { loading: 'Loading…', running: 'Running…', complete: 'Complete', notrun: 'Not run' },
    layers: { addBtn: '+ Add Variable', ready: 'Ready', notLoaded: 'Not loaded', groups: { Topography: 'Topography', Vegetation: 'Vegetation', Climate: 'Climate', 'Human Disturbance': 'Human Disturbance', 'Land Cover': 'Land Cover' },
      loadedLabel: 'layers loaded', resolution: 'Resolution', mismatch: 'mismatch', rasterDropzone: 'Drag .tif raster files here (any number at once), or click to choose',
      chooseVariable: 'Assign to variable…', valueRange: 'Value range', extent: 'Extent', source: 'Source', pointsOutside: 'occurrence points fall outside this raster', changeFile: '🔄 Replace file',
      stationDropzone: 'Or upload station point data (.txt/.js — Latitude/Longitude/value per station) to interpolate into a raster' },
    simulation: { running: 'Running…', runAgain: 'Run Again', run: 'Run', notePipeline: 'Processing pipeline in progress', noteComplete: 'Model run complete', noteReady: 'Ready to run', noteBlocked: 'Validate occurrence data and load environmental layers first' },
    suitability: { mean: 'Mean HSI (occurrence pts):', cvAuc: 'Cross-validated AUC (5-fold):', noModel: 'No temp/rainfall/dust layer is loaded — nothing to fit a model on.' },
    map: { basemap: 'Basemap', realNote: 'Live OpenStreetMap basemap and real occurrence records from GBIF.', rasterNote: 'Real TMD Climate Atlas data (1991–2020), interpolated from weather stations — see rnd.tmd.go.th/climateatlas.', forestNote: 'Real forest cover data — Hansen Global Forest Change v1.13 (2025): year-2000 tree canopy cover minus mapped loss through 2025.', dustNote: 'Regional average PM2.5, 2014–2024 (6-region breakdown) — a coarse zonal map, not a smooth interpolated surface. Every location within a region shows that region’s average.' },
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
    footer: { text: 'ต้นแบบงานวิจัย — ไม่ใช่สำหรับการตัดสินใจอนุรักษ์จริง ข้อมูลจุดพบ: GBIF ข้อมูลภูมิอากาศ: TMD Climate Atlas' },
    samples: { title: 'ข้อมูลจุดพบ (Samples)', dropzone: 'อัปโหลดไฟล์ CSV (species,lon,lat) หรือคลิกเพื่ออัปโหลด', useSample: 'ใช้ข้อมูลตัวอย่าง' },
    occurrence: { validate: 'ตรวจสอบข้อมูล', included: 'รวมอยู่', excluded: 'ไม่รวม' },
    envLayers: { title: 'ชั้นข้อมูลสิ่งแวดล้อม' },
    mapPanel: { title: 'แผนที่ผลการทำนาย', distribution: 'การกระจายพันธุ์นกเงือก', rainfallMap: 'แผนที่ปริมาณฝน', temperatureMap: 'แผนที่อุณหภูมิ', forestMap: 'แผนที่พื้นที่ป่าไม้', dustMap: 'แผนที่ฝุ่น PM2.5', denseForest: 'ป่าดิบชื้น (หนาแน่น)', secondaryForest: 'ป่าเบญจพรรณ/รอง', rasterNotLoaded: 'ยังไม่ได้โหลดราสเตอร์นี้ — อัปโหลดไฟล์ .tif ที่การ์ดชั้นข้อมูลสิ่งแวดล้อม หรือรอให้ค่าเริ่มต้นโหลดเสร็จ' },
    results: { title: 'ผลลัพธ์', responseCurves: 'กราฟความสัมพันธ์ตัวแปร (Response Curves)', variableImportance: 'อิทธิพลของตัวแปร (Variable Importance)', noResults: 'ยังไม่มีผลลัพธ์ — โหลดชั้นข้อมูลสิ่งแวดล้อมแล้วกด Run' },
    modelStatus: { loading: 'กำลังโหลด…', running: 'กำลังประมวลผล…', complete: 'เสร็จสมบูรณ์', notrun: 'ยังไม่รัน' },
    layers: { addBtn: '+ เพิ่มตัวแปร', ready: 'พร้อม', notLoaded: 'ยังไม่โหลด', groups: { Topography: 'ภูมิประเทศ', Vegetation: 'พืชพรรณ', Climate: 'ภูมิอากาศ', 'Human Disturbance': 'สิ่งรบกวนจากมนุษย์', 'Land Cover': 'สิ่งปกคลุมดิน' },
      loadedLabel: 'ตัวแปรโหลดแล้ว', resolution: 'ความละเอียด', mismatch: 'ไม่ตรงกัน', rasterDropzone: 'ลากไฟล์ .tif มาวางที่นี่ (เลือกได้หลายไฟล์พร้อมกัน) หรือคลิกเพื่อเลือก',
      chooseVariable: 'เลือกตัวแปรที่จะผูก…', valueRange: 'ช่วงค่า', extent: 'ขอบเขต', source: 'แหล่งข้อมูล', pointsOutside: 'จุดพบนกอยู่นอกขอบเขตไฟล์นี้', changeFile: '🔄 เปลี่ยนไฟล์',
      stationDropzone: 'หรืออัปโหลดข้อมูลจุดสถานี (.txt/.js — มี Latitude/Longitude/ค่าตัวแปรต่อสถานี) เพื่อคำนวณเป็นราสเตอร์' },
    simulation: { running: 'กำลังรัน…', runAgain: 'รันอีกครั้ง', run: 'Run', notePipeline: 'กำลังประมวลผลตามขั้นตอน', noteComplete: 'รันแบบจำลองเสร็จแล้ว', noteReady: 'พร้อมรัน', noteBlocked: 'กรุณาตรวจสอบข้อมูลจุดพบและโหลดชั้นข้อมูลสิ่งแวดล้อมก่อน' },
    suitability: { mean: 'ค่าเฉลี่ย HSI (จุดพบ):', cvAuc: 'AUC จากการตรวจสอบไขว้ (5-fold):', noModel: 'ยังไม่ได้โหลดชั้นข้อมูลอุณหภูมิ/ฝน/ฝุ่นเลย จึงไม่มีข้อมูลให้ fit โมเดล' },
    map: { basemap: 'แผนที่ฐาน', realNote: 'แผนที่ฐาน OpenStreetMap จริง และข้อมูลจุดพบนกจริงจาก GBIF', rasterNote: 'ข้อมูลจริงจาก TMD Climate Atlas (พ.ศ. 2534-2563) แทรกค่าจากสถานีตรวจอากาศ — ดูที่ rnd.tmd.go.th/climateatlas', forestNote: 'ข้อมูลพื้นที่ป่าไม้จริง จาก Hansen Global Forest Change v1.13 (2025): พื้นที่ป่าปี 2000 หักลบพื้นที่ที่สูญเสียไปจนถึงปี 2025', dustNote: 'ค่าเฉลี่ยฝุ่น PM2.5 รายภาค พ.ศ. 2557-2567 (แบ่ง 6 ภาค) — เป็นแผนที่แบบโซนหยาบ ไม่ใช่พื้นผิวที่แทรกค่าละเอียด ทุกจุดในภาคเดียวกันจะแสดงค่าเฉลี่ยของภาคนั้นเหมือนกันหมด' },
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
