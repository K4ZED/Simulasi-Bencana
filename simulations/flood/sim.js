import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const WORLD_SIZE = 150;
const GROUND_SEGS = 80;
const HOUSE_COUNT = 24;

// ---- Renderer ----
const canvas = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8d8f0);
scene.fog = new THREE.Fog(0xa8d8f0, 120, 260);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(70, 85, 115);

// ---- Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.44;
controls.minDistance = 35;
controls.maxDistance = 220;
controls.update();

// ---- Lighting ----
const hemi = new THREE.HemisphereLight(0xdff6ff, 0x577a55, 2.0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(80, 120, 60);
scene.add(sun);

// ---- Simulation State ----
let running = false;
let simTime = 0;

const params = {
    rain: 70,
    duration: 3,
    drainage: 45,
    elevation: 35,
    simSpeed: 1.0,
};

// ---- Ground ----
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GROUND_SEGS, GROUND_SEGS);
groundGeo.rotateX(-Math.PI / 2);

const groundPos = groundGeo.attributes.position;

for (let i = 0; i < groundPos.count; i++) {
    const x = groundPos.getX(i);
    const z = groundPos.getZ(i);

    // Bentuk tanah dibuat agak cekung di tengah agar air terlihat menggenang.
    const basin = -Math.exp(-(x * x + z * z) / 3200) * 4;
    const noise = Math.sin(x * 0.12) * 1.2 + Math.cos(z * 0.16) * 1.1;
    const slope = x * 0.025;

    groundPos.setY(i, basin + noise + slope);
}

groundGeo.computeVertexNormals();

const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ color: 0x64a46c })
);
scene.add(ground);

// ---- River ----
const riverGeo = new THREE.PlaneGeometry(18, WORLD_SIZE + 10, 8, 80);
riverGeo.rotateX(-Math.PI / 2);

const river = new THREE.Mesh(
    riverGeo,
    new THREE.MeshPhongMaterial({
        color: 0x1d8fb8,
        transparent: true,
        opacity: 0.82,
        shininess: 120,
        side: THREE.DoubleSide,
    })
);

river.position.set(-35, 0.4, 0);
scene.add(river);

// ---- Flood Water ----
const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 60, 60);
waterGeo.rotateX(-Math.PI / 2);

const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshPhongMaterial({
        color: 0x2ec4ff,
        transparent: true,
        opacity: 0.45,
        shininess: 180,
        side: THREE.DoubleSide,
    })
);

water.position.y = -5;
scene.add(water);

// ---- Houses ----
const houses = [];

function createHouse(x, z) {
    const house = new THREE.Group();

    const base = new THREE.Mesh(
        new THREE.BoxGeometry(5, 4, 5),
        new THREE.MeshLambertMaterial({ color: 0xf2d6a2 })
    );
    base.position.y = 2;
    house.add(base);

    const roof = new THREE.Mesh(
        new THREE.ConeGeometry(4.2, 2.6, 4),
        new THREE.MeshLambertMaterial({ color: 0xb84a3a })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 5.3;
    house.add(roof);

    house.position.set(x, 0, z);

    scene.add(house);
    houses.push(house);
}

for (let i = 0; i < HOUSE_COUNT; i++) {
    const x = THREE.MathUtils.randFloat(-10, 55);
    const z = THREE.MathUtils.randFloatSpread(110);
    createHouse(x, z);
}

// ---- Rain Particles ----
const rainCount = 900;
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(rainCount * 3);

for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = THREE.MathUtils.randFloatSpread(WORLD_SIZE);
    rainPositions[i * 3 + 1] = THREE.MathUtils.randFloat(30, 95);
    rainPositions[i * 3 + 2] = THREE.MathUtils.randFloatSpread(WORLD_SIZE);
}

rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

const rain = new THREE.Points(
    rainGeo,
    new THREE.PointsMaterial({
        color: 0xdff8ff,
        size: 0.45,
        transparent: true,
        opacity: 0.8,
    })
);

scene.add(rain);

// ---- Flood Calculation ----
function getWaterLevel() {
    const rainFactor = params.rain / 100;
    const durationFactor = params.duration / 6;
    const drainageFactor = 1 - params.drainage / 120;
    const elevationFactor = 1 - params.elevation / 140;

    const growth = Math.min(simTime / 12, 1);

    const level = -4 + growth
        * rainFactor
        * durationFactor
        * drainageFactor
        * elevationFactor
        * 15;

    return Math.max(-4, level);
}

function getRiskLevel(level) {
    if (level < 0.5) return 'Rendah';
    if (level < 2.8) return 'Sedang';
    if (level < 5.5) return 'Tinggi';
    return 'Ekstrem';
}

function getAffectedArea(level) {
    return THREE.MathUtils.clamp((level + 2) * 12, 0, 100);
}

// ---- Visual Updates ----
function updateFloodVisuals(t) {
    const level = getWaterLevel();

    // Animasi permukaan air.
    const waterPos = waterGeo.attributes.position;

    for (let i = 0; i < waterPos.count; i++) {
        const x = waterPos.getX(i);
        const z = waterPos.getZ(i);

        const wave = Math.sin(x * 0.18 + t * 2.1) * 0.18
                   + Math.cos(z * 0.22 + t * 1.8) * 0.14;

        waterPos.setY(i, wave);
    }

    waterPos.needsUpdate = true;
    waterGeo.computeVertexNormals();

    water.position.y = level;

    // Sungai ikut naik ketika genangan bertambah.
    river.position.y = Math.max(0.35, level + 0.25);

    // Rumah berubah warna jika mulai terdampak banjir.
    houses.forEach((house) => {
        const base = house.children[0];
        const isFlooded = level > 1.2;

        base.material.color.set(isFlooded ? 0xb7a47d : 0xf2d6a2);
    });

    // Gerakan partikel hujan.
    const rainAttr = rainGeo.attributes.position;
    const rainSpeed = 0.45 + params.rain / 80;

    for (let i = 0; i < rainCount; i++) {
        let y = rainAttr.getY(i);

        y -= rainSpeed;

        if (y < 0) {
            y = THREE.MathUtils.randFloat(45, 95);
            rainAttr.setX(i, THREE.MathUtils.randFloatSpread(WORLD_SIZE));
            rainAttr.setZ(i, THREE.MathUtils.randFloatSpread(WORLD_SIZE));
        }

        rainAttr.setY(i, y);
    }

    rainAttr.needsUpdate = true;

    // Update status di panel.
    if (running) {
        const displayedLevel = Math.max(0, level).toFixed(1);
        const affectedArea = getAffectedArea(level).toFixed(0);
        const risk = getRiskLevel(level);

        document.getElementById('water-level').textContent = displayedLevel + ' m';
        document.getElementById('affected-area').textContent = affectedArea + ' %';
        document.getElementById('risk-level').textContent = risk;
    }
}

// ---- Controls ----
function bindControls() {
    const controlMap = [
        { id: 'rain', key: 'rain', dec: 0 },
        { id: 'duration', key: 'duration', dec: 0 },
        { id: 'drainage', key: 'drainage', dec: 0 },
        { id: 'elevation', key: 'elevation', dec: 0 },
        { id: 'simspeed', key: 'simSpeed', dec: 1 },
    ];

    controlMap.forEach(({ id, key, dec }) => {
        const input = document.getElementById(id);
        const valueText = document.getElementById('val-' + id);

        input.addEventListener('input', () => {
            valueText.textContent = parseFloat(input.value).toFixed(dec);
            params[key] = parseFloat(input.value);
        });
    });

    const btnStart = document.getElementById('btn-start');

    btnStart.addEventListener('click', () => {
        running = !running;

        btnStart.textContent = running ? 'Jeda' : 'Lanjut';
        document.getElementById('status-text').textContent = running ? 'Berjalan' : 'Dijeda';
    });

    const btnReset = document.getElementById('btn-reset');

    btnReset.addEventListener('click', () => {
        running = false;
        simTime = 0;

        btnStart.textContent = 'Mulai';

        document.getElementById('status-text').textContent = 'Siap';
        document.getElementById('water-level').textContent = '-- m';
        document.getElementById('affected-area').textContent = '-- %';
        document.getElementById('risk-level').textContent = '--';
        document.getElementById('sim-time').textContent = '0 s';
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

// ---- Animation Loop ----
let prevTs = 0;

function tick(ts) {
    requestAnimationFrame(tick);

    const dt = Math.min((ts - prevTs) / 1000, 0.05);
    prevTs = ts;

    if (running) {
        simTime += dt * params.simSpeed;
        document.getElementById('sim-time').textContent = simTime.toFixed(1) + ' s';
    }

    updateFloodVisuals(simTime);

    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
onResize();

window.addEventListener('resize', onResize);
requestAnimationFrame(tick);