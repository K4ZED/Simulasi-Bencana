import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const OCEAN_SIZE = 180;
const OCEAN_SEGS = 90;
const WIRE_SEGS  = 32;   // separate low-res grid for clean wireframe lines
const COAST_X    = 52;

// ---- Renderer ----
const canvas = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7eb8d8);
scene.fog = new THREE.Fog(0xadd8f0, 140, 270);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(0, 85, 115);

// ---- Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.target.set(8, 0, 0);
controls.maxPolarAngle  = Math.PI * 0.42;
controls.minDistance    = 30;
controls.maxDistance    = 220;
controls.update();

// ---- Lighting ----
// Hemisphere: sky above, ground below — gives natural look without dark patches
const hemi = new THREE.HemisphereLight(0xd6eeff, 0x5a8040, 2.0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff8ee, 2.4);
sun.position.set(80, 140, 70);
scene.add(sun);

// ---- Ocean — vertex colors encode wave height (dark blue → cyan → white) ----
const oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGS, OCEAN_SEGS);
oceanGeo.rotateX(-Math.PI / 2);

const posAttr  = oceanGeo.attributes.position;
const origPos  = new Float32Array(posAttr.array);
const vtxCount = posAttr.count;

// Color buffer: updated every frame to reflect wave height
const colorBuf  = new Float32Array(vtxCount * 3);
const colorAttr = new THREE.BufferAttribute(colorBuf, 3);
oceanGeo.setAttribute('color', colorAttr);

const oceanMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    specular:     0xffffff,
    shininess:    260,
    transparent:  true,
    opacity:      0.92,
    side:         THREE.DoubleSide,
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
scene.add(ocean);

// ---- Grid wireframe overlay (separate low-res geometry — avoids blob artifacts) ----
const wireGeo     = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, WIRE_SEGS, WIRE_SEGS);
wireGeo.rotateX(-Math.PI / 2);
const wirePosAttr = wireGeo.attributes.position;
const wireOrigPos = new Float32Array(wirePosAttr.array);

const oceanWire = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
    color:      0x48cae4,
    wireframe:  true,
    transparent: true,
    opacity:    0.22,
    depthWrite: false,
}));
oceanWire.position.y = 0.08;
scene.add(oceanWire);

// ---- Seafloor ----
const floorGeo = new THREE.PlaneGeometry(OCEAN_SIZE + 80, OCEAN_SIZE);
floorGeo.rotateX(-Math.PI / 2);
const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshLambertMaterial({ color: 0x0a4a6e })
);
floor.position.y = -20;
scene.add(floor);

// ---- Terrain ----
const terrainGeo = new THREE.PlaneGeometry(100, OCEAN_SIZE, 55, 80);
terrainGeo.rotateX(-Math.PI / 2);
const tp = terrainGeo.attributes.position;
for (let i = 0; i < tp.count; i++) {
    const lx = tp.getX(i);
    const lz = tp.getZ(i);
    const d   = lx + 50;
    tp.setY(i,
        Math.max(0, d * 0.22)
        + Math.sin(lx * 0.18 + lz * 0.13) * 2.2
        + Math.cos(lx * 0.09 - lz * 0.15) * 1.8
        + Math.sin((lx + lz) * 0.07) * 3.0
    );
}
terrainGeo.computeVertexNormals();
const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshLambertMaterial({ color: 0x52b788 })
);
terrain.position.x = COAST_X + 50;
scene.add(terrain);

// Sandy beach
const beachGeo = new THREE.PlaneGeometry(10, OCEAN_SIZE);
beachGeo.rotateX(-Math.PI / 2);
const beach = new THREE.Mesh(
    beachGeo,
    new THREE.MeshLambertMaterial({ color: 0xd4b86a })
);
beach.position.set(COAST_X + 5, 0.08, 0);
scene.add(beach);

// ---- Epicenter marker — small red sphere floating above water + rings ----
const epiSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff2200 })
);
epiSphere.position.y = 4;
scene.add(epiSphere);

// Thin vertical line from sphere down to seafloor
const epiLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 24, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.5 })
);
epiLine.position.y = -8;
scene.add(epiLine);

// Expanding surface rings
const RING_COUNT = 4;
const pulseRings = Array.from({ length: RING_COUNT }, (_, i) => {
    const rg = new THREE.RingGeometry(1, 1.8, 48);
    rg.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color:       0xff4400,
        transparent: true,
        opacity:     0.7,
        side:        THREE.DoubleSide,
        depthWrite:  false,
    }));
    mesh.userData.phase = i / RING_COUNT;
    mesh.position.y = 0.3;
    scene.add(mesh);
    return mesh;
});

// ---- Sim state ----
let running = false;
let simTime = 0;
const params = {
    magnitude: 7.5,
    depth:     20,
    distance:  80,
    simSpeed:  1.0,
};

// ---- Wave math ----
function sech2(x) {
    const ax = Math.min(Math.abs(x), 20);
    const c  = Math.cosh(ax);
    return 1 / (c * c);
}

function getEpicenterX() {
    return COAST_X - params.distance * 0.52;
}

function getSceneWaveSpeed() {
    return Math.sqrt(params.depth) * 0.78;
}

function getAmplitude() {
    // amplitude in scene units; grows with magnitude
    return Math.pow(Math.max(0, params.magnitude - 5.5), 1.7) * 0.55;
}

// ---- Ocean update ----
function updateOcean(t) {
    const epicX     = getEpicenterX();
    const waveFront = epicX + getSceneWaveSpeed() * t;
    const amplitude = getAmplitude();
    const waveLen   = params.depth * 1.1 + 18;

    let peakH = 0;

    for (let i = 0; i < vtxCount; i++) {
        const ox = origPos[i * 3];
        const oz = origPos[i * 3 + 2];

        // ambient ocean chop
        const chop = 0.42 * Math.sin(ox * 0.26 + t * 1.7)
                   + 0.26 * Math.cos(oz * 0.22 + t * 1.25)
                   + 0.14 * Math.sin((ox - oz) * 0.17 + t * 2.1);

        // shoaling near coast
        const shallowStart = COAST_X - 28;
        let shoal = 1.0;
        if (ox > shallowStart) {
            const dr = Math.max(0.04, 1.0 - (ox - shallowStart) / 32);
            shoal = Math.min(5.5, Math.pow(1.0 / dr, 0.38));
        }

        const landFade = ox < COAST_X ? 1.0 : Math.max(0, 1 - (ox - COAST_X) * 0.18);
        const dx       = ox - waveFront;
        const tsunamiY = amplitude * shoal * sech2(dx / waveLen * 2.2) * landFade;

        const finalY = chop + tsunamiY;
        posAttr.setY(i, finalY);

        // vertex color: dark blue (trough) → bright cyan/white (crest)
        const tn = Math.max(0, Math.min(1, (finalY + 0.5) / 10));
        colorBuf[i * 3]     = tn * 0.85;               // R
        colorBuf[i * 3 + 1] = 0.28 + tn * 0.62;        // G
        colorBuf[i * 3 + 2] = 0.55 + tn * 0.45;        // B

        if (Math.abs(oz) < 4) peakH = Math.max(peakH, tsunamiY);
    }

    posAttr.needsUpdate   = true;
    colorAttr.needsUpdate = true;
    oceanGeo.computeVertexNormals();

    // Update low-res wireframe grid using same wave function
    for (let i = 0; i < wirePosAttr.count; i++) {
        const wx = wireOrigPos[i * 3];
        const wz = wireOrigPos[i * 3 + 2];

        const wChop = 0.42 * Math.sin(wx * 0.26 + t * 1.7)
                    + 0.26 * Math.cos(wz * 0.22 + t * 1.25)
                    + 0.14 * Math.sin((wx - wz) * 0.17 + t * 2.1);

        let wShoal = 1.0;
        const shallowStart = COAST_X - 28;
        if (wx > shallowStart) {
            const dr = Math.max(0.04, 1.0 - (wx - shallowStart) / 32);
            wShoal = Math.min(5.5, Math.pow(1.0 / dr, 0.38));
        }
        const wLandFade = wx < COAST_X ? 1.0 : Math.max(0, 1 - (wx - COAST_X) * 0.18);
        const wDx       = wx - waveFront;
        const wTsunami  = amplitude * wShoal * sech2(wDx / waveLen * 2.2) * wLandFade;

        wirePosAttr.setY(i, wChop + wTsunami);
    }
    wirePosAttr.needsUpdate = true;

    if (running) {
        document.getElementById('wave-height').textContent = (peakH * 3).toFixed(1) + ' m';
    }
}

// ---- Epicenter viz ----
function updateEpicenter(t) {
    const ex = getEpicenterX();
    epiSphere.position.x = ex;
    epiLine.position.x   = ex;

    pulseRings.forEach(ring => {
        const phase = (t * 0.45 + ring.userData.phase) % 1;
        ring.scale.setScalar(1 + phase * 22);
        ring.material.opacity = (1 - phase) * 0.6;
        ring.position.x = ex;
    });
}

// ---- Status ----
function syncStatus() {
    const speedMs  = Math.sqrt(9.81 * params.depth * 1000);
    const speedKmh = Math.round(speedMs * 3.6);
    document.getElementById('wave-speed').textContent = speedKmh.toLocaleString('id') + ' km/jam';
}

// ---- Controls ----
function bindControls() {
    const map = [
        { id: 'magnitude', key: 'magnitude', dec: 1 },
        { id: 'depth',     key: 'depth',     dec: 0 },
        { id: 'distance',  key: 'distance',  dec: 0 },
        { id: 'simspeed',  key: 'simSpeed',  dec: 1 },
    ];
    map.forEach(({ id, key, dec }) => {
        const el  = document.getElementById(id);
        const val = document.getElementById('val-' + id);
        el.addEventListener('input', () => {
            val.textContent = parseFloat(el.value).toFixed(dec);
            params[key]     = parseFloat(el.value);
            syncStatus();
        });
    });

    const btnStart = document.getElementById('btn-start');
    btnStart.addEventListener('click', () => {
        running = !running;
        btnStart.textContent = running ? 'Jeda' : 'Lanjut';
        document.getElementById('status-text').textContent = running ? 'Berjalan' : 'Dijeda';
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        running  = false;
        simTime  = 0;
        btnStart.textContent = 'Mulai';
        document.getElementById('status-text').textContent = 'Siap';
        document.getElementById('wave-height').textContent = '-- m';
        document.getElementById('sim-time').textContent    = '0 s';
    });
}

// ---- Resize ----
function onResize() {
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

// ---- Loop ----
let prevTs = 0;
function tick(ts) {
    requestAnimationFrame(tick);
    const dt = Math.min((ts - prevTs) / 1000, 0.05);
    prevTs = ts;

    if (running) {
        simTime += dt * params.simSpeed;
        document.getElementById('sim-time').textContent = simTime.toFixed(1) + ' s';
    }

    updateOcean(simTime);
    updateEpicenter(simTime);
    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
syncStatus();
onResize();
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
