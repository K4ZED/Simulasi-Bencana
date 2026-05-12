import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const WORLD_SIZE = 150;
const GROUND_SEGS = 90;
const TREE_COUNT = 28;

// ---- Renderer ----
const canvas = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0c987);
scene.fog = new THREE.Fog(0xf0c987, 120, 260);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(70, 80, 120);

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
const hemi = new THREE.HemisphereLight(0xffefd4, 0x8b6f3f, 2.0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2c2, 2.7);
sun.position.set(90, 140, 70);
scene.add(sun);

// ---- Simulation State ----
let running = false;
let simTime = 0;

const params = {
    rainfall: 35,
    temperature: 34,
    evaporation: 70,
    groundwater: 45,
    simSpeed: 1.0,
};

// ---- Ground with Vertex Colors ----
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GROUND_SEGS, GROUND_SEGS);
groundGeo.rotateX(-Math.PI / 2);

const groundPos = groundGeo.attributes.position;
const groundColors = new Float32Array(groundPos.count * 3);
groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));

for (let i = 0; i < groundPos.count; i++) {
    const x = groundPos.getX(i);
    const z = groundPos.getZ(i);

    const y = Math.sin(x * 0.09) * 1.1
            + Math.cos(z * 0.12) * 1.0
            + Math.sin((x + z) * 0.05) * 0.8;

    groundPos.setY(i, y);
}

groundGeo.computeVertexNormals();

const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
    })
);

scene.add(ground);

// ---- Reservoir / Waduk ----
const reservoirGeo = new THREE.CylinderGeometry(22, 24, 1.4, 48);

const reservoir = new THREE.Mesh(
    reservoirGeo,
    new THREE.MeshPhongMaterial({
        color: 0x2e9cca,
        transparent: true,
        opacity: 0.8,
        shininess: 120,
    })
);

reservoir.position.set(-38, 0.2, -28);
scene.add(reservoir);

// ---- Dry Riverbed ----
const riverbedGeo = new THREE.PlaneGeometry(14, WORLD_SIZE + 10, 8, 80);
riverbedGeo.rotateX(-Math.PI / 2);

const riverbed = new THREE.Mesh(
    riverbedGeo,
    new THREE.MeshLambertMaterial({
        color: 0x8b6a3e,
        side: THREE.DoubleSide,
    })
);

riverbed.position.set(35, 0.12, 0);
scene.add(riverbed);

// ---- Cracks ----
const cracks = new THREE.Group();
scene.add(cracks);

function createCrack(x, z, length, rotation) {
    const crack = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.08, 0.35),
        new THREE.MeshBasicMaterial({ color: 0x3d2a16 })
    );

    crack.position.set(x, 0.18, z);
    crack.rotation.y = rotation;
    crack.visible = false;

    cracks.add(crack);
}

for (let i = 0; i < 45; i++) {
    createCrack(
        THREE.MathUtils.randFloatSpread(120),
        THREE.MathUtils.randFloatSpread(120),
        THREE.MathUtils.randFloat(3, 11),
        THREE.MathUtils.randFloat(0, Math.PI)
    );
}

// ---- Trees / Vegetation ----
const trees = [];

function createTree(x, z) {
    const tree = new THREE.Group();

    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.6, 5, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a4b25 })
    );
    trunk.position.y = 2.5;
    tree.add(trunk);

    const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 16, 16),
        new THREE.MeshLambertMaterial({ color: 0x4d9f45 })
    );
    leaves.position.y = 5.8;
    tree.add(leaves);

    tree.position.set(x, 0, z);

    scene.add(tree);
    trees.push({ tree, leaves });
}

for (let i = 0; i < TREE_COUNT; i++) {
    createTree(
        THREE.MathUtils.randFloat(-10, 60),
        THREE.MathUtils.randFloatSpread(110)
    );
}

// ---- Dust Particles ----
const dustCount = 450;
const dustGeo = new THREE.BufferGeometry();
const dustPositions = new Float32Array(dustCount * 3);

for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = THREE.MathUtils.randFloatSpread(WORLD_SIZE);
    dustPositions[i * 3 + 1] = THREE.MathUtils.randFloat(2, 35);
    dustPositions[i * 3 + 2] = THREE.MathUtils.randFloatSpread(WORLD_SIZE);
}

dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
        color: 0xd9a441,
        size: 0.42,
        transparent: true,
        opacity: 0.0,
    })
);

scene.add(dust);

// ---- Drought Calculation ----
function getDryness() {
    const lowRainfall = 1 - params.rainfall / 250;
    const heatFactor = (params.temperature - 24) / 21;
    const evaporationFactor = params.evaporation / 100;
    const lowGroundwater = 1 - params.groundwater / 100;

    const timeFactor = Math.min(simTime / 14, 1);

    const dryness = (
        lowRainfall * 0.32 +
        heatFactor * 0.25 +
        evaporationFactor * 0.23 +
        lowGroundwater * 0.20
    ) * timeFactor;

    return THREE.MathUtils.clamp(dryness, 0, 1);
}

function getSoilMoisture(dryness) {
    return Math.round((1 - dryness) * 100);
}

function getReservoirLevel(dryness) {
    const level = params.groundwater
        - dryness * 75
        + params.rainfall * 0.08;

    return THREE.MathUtils.clamp(level, 0, 100);
}

function getRiskLevel(dryness) {
    if (dryness < 0.25) return 'Rendah';
    if (dryness < 0.50) return 'Sedang';
    if (dryness < 0.75) return 'Tinggi';
    return 'Ekstrem';
}

// ---- Visual Updates ----
function updateDroughtVisuals(t) {
    const dryness = getDryness();
    const soilMoisture = getSoilMoisture(dryness);
    const reservoirLevel = getReservoirLevel(dryness);

    // Warna tanah berubah dari hijau kecokelatan menjadi kuning kering.
    for (let i = 0; i < groundPos.count; i++) {
        const x = groundPos.getX(i);
        const z = groundPos.getZ(i);

        const variation = (Math.sin(x * 0.12 + z * 0.08) + 1) * 0.04;

        const wetR = 0.36;
        const wetG = 0.58;
        const wetB = 0.28;

        const dryR = 0.76 + variation;
        const dryG = 0.53 + variation;
        const dryB = 0.25;

        groundColors[i * 3] = wetR * (1 - dryness) + dryR * dryness;
        groundColors[i * 3 + 1] = wetG * (1 - dryness) + dryG * dryness;
        groundColors[i * 3 + 2] = wetB * (1 - dryness) + dryB * dryness;
    }

    groundGeo.attributes.color.needsUpdate = true;

    // Waduk menyusut saat kondisi semakin kering.
    const reservoirScale = THREE.MathUtils.clamp(reservoirLevel / 100, 0.08, 1);

    reservoir.scale.set(
        reservoirScale,
        0.25 + reservoirScale * 0.75,
        reservoirScale
    );

    reservoir.material.opacity = 0.35 + reservoirScale * 0.5;

    // Retakan tanah muncul bertahap sesuai tingkat kekeringan.
    const visibleCracks = Math.floor(dryness * cracks.children.length);

    cracks.children.forEach((crack, index) => {
        crack.visible = index < visibleCracks;
        crack.scale.x = 0.6 + dryness * 1.4;
    });

    // Vegetasi berubah warna dan sedikit mengecil.
    trees.forEach(({ tree, leaves }) => {
        if (dryness > 0.65) {
            leaves.material.color.set(0x9a7a2f);
        } else if (dryness > 0.40) {
            leaves.material.color.set(0xb5a642);
        } else {
            leaves.material.color.set(0x4d9f45);
        }

        const scaleY = 1 - dryness * 0.35;
        tree.scale.set(1, scaleY, 1);
    });

    // Debu semakin terlihat ketika tanah makin kering.
    dust.material.opacity = dryness * 0.65;

    const dustAttr = dustGeo.attributes.position;

    for (let i = 0; i < dustCount; i++) {
        let x = dustAttr.getX(i);
        let y = dustAttr.getY(i);
        let z = dustAttr.getZ(i);

        x += 0.06 + dryness * 0.18;
        z += Math.sin(t + i) * 0.015;
        y += Math.sin(t * 1.5 + i) * 0.015;

        if (x > WORLD_SIZE / 2) {
            x = -WORLD_SIZE / 2;
            y = THREE.MathUtils.randFloat(2, 35);
            z = THREE.MathUtils.randFloatSpread(WORLD_SIZE);
        }

        dustAttr.setXYZ(i, x, y, z);
    }

    dustAttr.needsUpdate = true;

    // Update status di panel.
    if (running) {
        document.getElementById('soil-moisture').textContent = soilMoisture + ' %';
        document.getElementById('reservoir-level').textContent = Math.round(reservoirLevel) + ' %';
        document.getElementById('risk-level').textContent = getRiskLevel(dryness);
    }
}

// ---- Controls ----
function bindControls() {
    const controlMap = [
        { id: 'rainfall', key: 'rainfall', dec: 0 },
        { id: 'temperature', key: 'temperature', dec: 0 },
        { id: 'evaporation', key: 'evaporation', dec: 0 },
        { id: 'groundwater', key: 'groundwater', dec: 0 },
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
        document.getElementById('soil-moisture').textContent = '-- %';
        document.getElementById('reservoir-level').textContent = '-- %';
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

    updateDroughtVisuals(simTime);

    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
onResize();

window.addEventListener('resize', onResize);
requestAnimationFrame(tick);