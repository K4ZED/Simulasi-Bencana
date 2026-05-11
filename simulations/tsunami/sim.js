import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const OCEAN_SIZE = 180;
const OCEAN_SEGS = 90;
const COAST_X    = 52;

// ---- Renderer ----
const canvas = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93c5e8); // light sky blue

// subtle haze toward horizon
scene.fog = new THREE.Fog(0xb8d8f0, 120, 260);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
camera.position.set(-5, 70, 110);

// ---- Orbit Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.target.set(8, 0, 0);
controls.maxPolarAngle  = Math.PI * 0.44;
controls.minDistance    = 30;
controls.maxDistance    = 220;
controls.update();

// ---- Lighting ----
// hemisphere: sky light from above, ground bounce from below
const hemi = new THREE.HemisphereLight(0xc9e8ff, 0x4a7040, 1.8);
scene.add(hemi);

// main sun
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(60, 120, 60);
scene.add(sun);

// soft fill from opposite side
const fill = new THREE.DirectionalLight(0x88bbff, 0.5);
fill.position.set(-80, 30, -40);
scene.add(fill);

// ---- Ocean surface mesh ----
const oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGS, OCEAN_SEGS);
oceanGeo.rotateX(-Math.PI / 2);

const posAttr = oceanGeo.attributes.position;
const origPos = new Float32Array(posAttr.array);

const oceanMat = new THREE.MeshPhongMaterial({
    color:       0x0077b6,
    emissive:    0x002a44,
    specular:    0x90e0ef,
    shininess:   200,
    transparent: true,
    opacity:     0.82,
    side:        THREE.DoubleSide,
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
scene.add(ocean);

// Wireframe overlay on ocean — makes wave shape clearly visible
const wireMat = new THREE.MeshBasicMaterial({
    color:       0x48cae4,
    wireframe:   true,
    transparent: true,
    opacity:     0.18,
});
const oceanWire = new THREE.Mesh(oceanGeo, wireMat); // shares geometry
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
    const d    = lx + 50;
    const base = Math.max(0, d * 0.22);
    const bump = Math.sin(lx * 0.18 + lz * 0.13) * 2.2
               + Math.cos(lx * 0.09 - lz * 0.15) * 1.8
               + Math.sin((lx + lz) * 0.07) * 3.0;
    tp.setY(i, base + bump);
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

// ---- Epicenter marker ----
const epicenterMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 28, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.8 })
);
epicenterMesh.position.y = -6;
scene.add(epicenterMesh);

const RING_COUNT = 4;
const pulseRings = Array.from({ length: RING_COUNT }, (_, i) => {
    const rg = new THREE.RingGeometry(1, 1.6, 40);
    rg.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color:       0xff5500,
        transparent: true,
        opacity:     0.6,
        side:        THREE.DoubleSide,
    }));
    mesh.userData.phase = i / RING_COUNT;
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
    const c = Math.cosh(Math.min(Math.abs(x), 20));
    return 1 / (c * c);
}

function getEpicenterX() {
    return COAST_X - params.distance * 0.52;
}

function getSceneWaveSpeed() {
    return Math.sqrt(params.depth) * 0.78;
}

function getAmplitude() {
    return Math.pow(Math.max(0, params.magnitude - 5.5), 1.7) * 0.45;
}

// ---- Ocean update ----
function updateOcean(t) {
    const epicX     = getEpicenterX();
    const waveFront = epicX + getSceneWaveSpeed() * t;
    const amplitude = getAmplitude();
    const waveLen   = params.depth * 1.1 + 18;

    let peakH = 0;

    for (let i = 0; i < posAttr.count; i++) {
        const ox = origPos[i * 3];
        const oz = origPos[i * 3 + 2];

        // background chop
        const chop = 0.42 * Math.sin(ox * 0.26 + t * 1.7)
                   + 0.26 * Math.cos(oz * 0.22 + t * 1.25)
                   + 0.14 * Math.sin((ox - oz) * 0.17 + t * 2.1);

        // shoaling
        const shallowStart = COAST_X - 28;
        let shoal = 1.0;
        if (ox > shallowStart) {
            const depthRatio = Math.max(0.04, 1.0 - (ox - shallowStart) / 32);
            shoal = Math.min(5.5, Math.pow(1.0 / depthRatio, 0.38));
        }

        const landFade = ox < COAST_X ? 1.0 : Math.max(0, 1 - (ox - COAST_X) * 0.18);
        const dx       = ox - waveFront;
        const tsunamiY = amplitude * shoal * sech2(dx / waveLen * 2.2) * landFade;

        posAttr.setY(i, chop + tsunamiY);

        if (Math.abs(oz) < 4) peakH = Math.max(peakH, tsunamiY);
    }

    posAttr.needsUpdate = true;
    oceanGeo.computeVertexNormals();

    if (running) {
        document.getElementById('wave-height').textContent = (peakH * 3).toFixed(1) + ' m';
    }
}

// ---- Epicenter viz ----
function updateEpicenter(t) {
    const ex = getEpicenterX();
    epicenterMesh.position.x = ex;
    pulseRings.forEach(ring => {
        const phase = (t * 0.45 + ring.userData.phase) % 1;
        ring.scale.setScalar(1 + phase * 20);
        ring.material.opacity = (1 - phase) * 0.55;
        ring.position.set(ex, 0.3, 0);
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
            val.textContent  = parseFloat(el.value).toFixed(dec);
            params[key]      = parseFloat(el.value);
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

// ---- Render loop ----
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
