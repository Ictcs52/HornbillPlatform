// 1. ตั้งค่าเริ่มต้นของแผนที่ (พิกัดกลางประเทศไทย และระดับการซูม)
const map = L.map('map').setView([13.0, 101.0], 6);

// 2. ดึงแผนที่ฐาน (Base Map) จาก OpenStreetMap หรือ CartoDB
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

// 3. กำหนดฟังก์ชันสไตล์สำหรับแต่ละพื้นที่ (แยกสีตามชื่อป่า หรือคลาสลุ่มน้ำ)
function styleFeature(feature) {
    let color = '#2E7D32'; // สีเขียวเข้มเป็นค่าเริ่มต้น

    // แยกสีตามชื่อป่า (อ้างอิงจาก Property ใน GeoJSON ของคุณ)
    if (feature.properties.name === "Western Forest Complex") {
        color = '#1B5E20';
    } else if (feature.properties.name === "Doi Inthanon–Mae Wang Highlands") {
        color = '#E65100'; // สีส้ม/แสด สำหรับโซนภูเขาสูง
    } else if (feature.properties.name === "Southern Peninsular Forest Corridor") {
        color = '#006064'; // สีเขียวอมฟ้า สำหรับผืนป่าภาคใต้
    }

    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: '#ffffff', // เส้นขอบสีขาว
        fillOpacity: 0.6
    };
}

// 4. ฟังก์ชันจัดการเมื่อผู้ใช้คลิกหรือโฮเวอร์บนพื้นที่ป่า (Interaction)
function onEachFeature(feature, layer) {
    if (feature.properties) {
        // สร้างข้อมูลที่จะแสดงใน Pop-up
        const popupContent = `
            <strong>${feature.properties.name}</strong><br/>
            ประเภท: ${feature.properties.class || 'Class 1A Watershed'}<br/>
            ขนาดพื้นที่: ${feature.properties.area || 'N/A'} ตร.กม.
        `;
        layer.bindPopup(popupContent);
    }

    // ใส่ Effect เล็กๆ เวลาเอาเมาส์มาวาง (Hover)
    layer.on({
        mouseover: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.8, weight: 3 });
        },
        mouseout: (e) => {
            const l = e.target;
            l.setStyle({ fillOpacity: 0.6, weight: 2 });
        }
    });
}

// 5. ดึงไฟล์ GeoJSON จากโฟลเดอร์ assets ด้วย Fetch API
fetch('./assets/watersheds.json')
    .then(response => {
        if (!response.ok) {
            throw new Error('ไม่สามารถโหลดไฟล์ GeoJSON ได้');
        }
        return response.json();
    })
    .then(geoJsonData => {
        // นำข้อมูลไปวาดลงบนแผนที่
        const layer = L.geoJSON(geoJsonData, {
            style: styleFeature,
            onEachFeature: onEachFeature
        }).addTo(map);

        // ปรับมุมมองแผนที่ให้พอดีกับขอบเขตของข้อมูลทั้งหมด
        map.fitBounds(layer.getBounds());
    })
    .catch(error => {
        console.error('เกิดข้อผิดพลาดในการโหลดข้อมูล:', error);
    });
