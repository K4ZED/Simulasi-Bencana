import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Constants ----
const TERRAIN_W  = 160;
const TERRAIN_D  = 140;
const TERRAIN_SW = 80;
const TERRAIN_SD = 70;
const MAX_DEBRIS  = 1800;
const MAX_DUST    = 280;

// ---- Renderer ----
const canvas = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8faabc);
scene.fog = new THREE.Fog(0x8faabc, 160, 300);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(-30, 90, 130);

// ---- Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 10, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 40;
controls.maxDistance = 260;
controls.update();

// ---- Lighting ----
const hemi = new THREE.HemisphereLight(0xc8dde8, 0x4a3820, 1.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(-60, 120, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 350;
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
scene.add(sun);

// ---- Seeded RNG ----
function makeRng(seed) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
const rng = makeRng(42);

// ---- Params ----
const params = {
    slope:      35,
    saturation: 50,
    material:   0,   // 0=Tanah, 1=Pasir, 2=Batuan
    simSpeed:   1.0,
};

const MATERIAL_NAMES = ['Tanah', 'Pasir', 'Batuan'];

// Base cohesion & friction per material (affects speed and instability)
const MAT_PROPS = [
    { friction: 0.38, cohesion: 12, color: 0x8b5e3c },  // Tanah
    { friction: 0.30, cohesion:  4, color: 0xc8aa70 },  // Pasir
    { friction: 0.45, cohesion: 18, color: 0x7a6a5a },  // Batuan
];

// ---- Terrain geometry ----
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, TERRAIN_SW, TERRAIN_SD);
terrainGeo.rotateX(-Math.PI / 2);

const tp     = terrainGeo.attributes.position;
const tpOrig = new Float32Array(tp.array);  // store original for reset

// Build base slope + noise heightmap
function buildTerrain(slopeDeg) {
    const slopeRad = slopeDeg * Math.PI / 180;
    const slopeK   = Math.tan(slopeRad);
    for (let i = 0; i < tp.count; i++) {
        const ox = tpOrig[i * 3];
        const oz = tpOrig[i * 3 + 2];
        // Slope rises steeply from back (negative x) down to front flat valley
        const baseH = Math.max(0, (-ox + TERRAIN_W * 0.15) * slopeK);
        const noise  = Math.sin(ox * 0.14 + oz * 0.11) * 2.2
                     + Math.cos(ox * 0.07 - oz * 0.09) * 1.6
                     + Math.sin((ox + oz) * 0.06) * 3.0;
        tp.setY(i, baseH + Math.max(0, noise));
    }
    tp.needsUpdate = true;
    terrainGeo.computeVertexNormals();
}

buildTerrain(params.slope);

// ---- Terrain vertex colors (green top, brown mid, beige valley) ----
const vtxCount = tp.count;
const colorBuf  = new Float32Array(vtxCount * 3);
const colorAttr = new THREE.BufferAttribute(colorBuf, 3);
terrainGeo.setAttribute('color', colorAttr);

function updateTerrainColors(erosionMap) {
    for (let i = 0; i < vtxCount; i++) {
        const h = tp.getY(i);
        const maxH = params.slope * 0.8;
        let t = Math.min(1, h / Math.max(1, maxH));

        let r, g, b;
        if (t < 0.15) {
            // Valley floor — sandy beige
            r = 0.75; g = 0.70; b = 0.52;
        } else if (t < 0.45) {
            // Lower slope — brown
            const f = (t - 0.15) / 0.30;
            r = 0.75 - f * 0.20; g = 0.70 - f * 0.32; b = 0.52 - f * 0.18;
        } else {
            // Upper slope — green vegetation
            const f = Math.min(1, (t - 0.45) / 0.55);
            r = 0.55 - f * 0.29; g = 0.38 + f * 0.27; b = 0.34 - f * 0.12;
        }

        // Eroded patches turn darker brown
        if (erosionMap && erosionMap[i] > 0) {
            const ef = Math.min(1, erosionMap[i]);
            r = r * (1 - ef) + 0.42 * ef;
            g = g * (1 - ef) + 0.28 * ef;
            b = b * (1 - ef) + 0.18 * ef;
        }

        colorBuf[i * 3]     = r;
        colorBuf[i * 3 + 1] = g;
        colorBuf[i * 3 + 2] = b;
    }
    colorAttr.needsUpdate = true;
}

const erosionMap = new Float32Array(vtxCount);
updateTerrainColors(null);

const terrainMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 8,
    specular: 0x111111,
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

// ---- Flat valley floor ----
const valleyGeo = new THREE.PlaneGeometry(TERRAIN_W * 0.55, TERRAIN_D);
valleyGeo.rotateX(-Math.PI / 2);
const valley = new THREE.Mesh(
    valleyGeo,
    new THREE.MeshLambertMaterial({ color: 0xb8a878 })
);
valley.position.set(TERRAIN_W * 0.30, 0.05, 0);
valley.receiveShadow = true;
scene.add(valley);

// ---- Trees on upper slope ----
const treeGroup = new THREE.Group();
scene.add(treeGroup);

function buildTrees() {
    while (treeGroup.children.length) treeGroup.remove(treeGroup.children[0]);

    const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x4a3020 });
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x2d6a30 });
    const treeRng   = makeRng(77);

    for (let k = 0; k < 60; k++) {
        const tx = treeRng() * TERRAIN_W * 0.55 - TERRAIN_W * 0.48;
        const tz = (treeRng() - 0.5) * TERRAIN_D * 0.85;

        // Sample terrain height at this position
        const nx = (tx + TERRAIN_W / 2) / TERRAIN_W * TERRAIN_SW;
        const nz = (tz + TERRAIN_D / 2) / TERRAIN_D * TERRAIN_SD;
        const ix = Math.floor(nx) + Math.floor(nz) * (TERRAIN_SW + 1);
        const idx = Math.min(ix, vtxCount - 1);
        const gy  = tp.getY(idx);
        if (gy < 8) continue;  // no trees in valley

        const h    = 2.5 + treeRng() * 2.5;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 5), trunkMat);
        trunk.position.set(tx, gy + h / 2, tz);
        treeGroup.add(trunk);

        const foliage = new THREE.Mesh(new THREE.ConeGeometry(1.4 + treeRng() * 0.6, h * 1.1, 6), foliageMat);
        foliage.position.set(tx, gy + h + (h * 0.4), tz);
        treeGroup.add(foliage);
    }
}
buildTrees();

// ---- Debris particle system ----
const debrisPositions = new Float32Array(MAX_DEBRIS * 3);
const debrisColors    = new Float32Array(MAX_DEBRIS * 3);
const debrissizes     = new Float32Array(MAX_DEBRIS);
const debrisGeo = new THREE.BufferGeometry();
debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
debrisGeo.setAttribute('color',    new THREE.BufferAttribute(debrisColors,    3));
debrisGeo.setAttribute('size',     new THREE.BufferAttribute(debrissizes,     1));
debrisGeo.setDrawRange(0, 0);

const debrisMat = new THREE.PointsMaterial({
    size:         1.8,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
});
const debrisPoints = new THREE.Points(debrisGeo, debrisMat);
scene.add(debrisPoints);

// ---- Dust particle system ----
const dustPos    = new Float32Array(MAX_DUST * 3);
const dustColors = new Float32Array(MAX_DUST * 3);
const dustGeo    = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos,    3));
dustGeo.setAttribute('color',    new THREE.BufferAttribute(dustColors, 3));
dustGeo.setDrawRange(0, 0);

const dustMat = new THREE.PointsMaterial({
    size:         3.5,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
});
const dustPoints = new THREE.Points(dustGeo, dustMat);
scene.add(dustPoints);

// ---- Debris particle state ----
const debrisData = Array.from({ length: MAX_DEBRIS }, () => ({
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1,
    r: 0, g: 0, b: 0,
}));

const dustData = Array.from({ length: MAX_DUST }, () => ({
    active: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1,
}));

let activeDebris = 0;
let activeDust   = 0;
let debrisAccum  = 0;
let dustAccum    = 0;

// ---- Sim state ----
let running  = false;
let simTime  = 0;
let totalVol = 0;

// ---- Terrain height sampler ----
function sampleTerrainY(wx, wz) {
    const nx = (wx + TERRAIN_W / 2) / TERRAIN_W * TERRAIN_SW;
    const nz = (wz + TERRAIN_D / 2) / TERRAIN_D * TERRAIN_SD;
    const ix = Math.max(0, Math.min(TERRAIN_SW, Math.floor(nx)));
    const iz = Math.max(0, Math.min(TERRAIN_SD, Math.floor(nz)));
    return tp.getY(iz * (TERRAIN_SW + 1) + ix);
}

// ---- Slope direction at a point (downhill vector) ----
function slopeDir(wx, wz) {
    const step = TERRAIN_W / TERRAIN_SW;
    const hy = sampleTerrainY(wx, wz);
    const hx = sampleTerrainY(wx + step, wz) - hy;
    const hz = sampleTerrainY(wx, wz + step) - hy;
    return { dx: -hx, dz: -hz };   // downhill = negative gradient
}

// ---- Spawn debris particle ----
function spawnDebris(wx, wz) {
    for (let i = 0; i < MAX_DEBRIS; i++) {
        const d = debrisData[i];
        if (d.active) continue;

        const gy = sampleTerrainY(wx, wz);
        const sd = slopeDir(wx, wz);
        const mat = MAT_PROPS[params.material];

        // Slide speed scales with slope, saturation, material
        const slopeRad = params.slope * Math.PI / 180;
        const satFactor = 1 + params.saturation / 100 * 2.0;
        const speed = Math.max(0.5, Math.sin(slopeRad) * 18 * satFactor / (mat.friction * 3));

        const spread = (rng() - 0.5) * 6;
        d.active  = true;
        d.x  = wx + (rng() - 0.5) * 5;
        d.y  = gy + 0.4;
        d.z  = wz + spread;
        d.vx = sd.dx * speed * (0.8 + rng() * 0.4);
        d.vy = 0.5 + rng() * 0.8;
        d.vz = sd.dz * speed * (0.8 + rng() * 0.4) + (rng() - 0.5) * speed * 0.3;
        d.life    = 0;
        d.maxLife = 4.0 + rng() * 6.0;

        // Color per material + variation
        const base = mat.color;
        const br = ((base >> 16) & 0xff) / 255;
        const bg = ((base >> 8)  & 0xff) / 255;
        const bb = (base & 0xff)         / 255;
        const jitter = (rng() - 0.5) * 0.15;
        d.r = Math.max(0, Math.min(1, br + jitter));
        d.g = Math.max(0, Math.min(1, bg + jitter * 0.8));
        d.b = Math.max(0, Math.min(1, bb + jitter * 0.6));
        return;
    }
}

// ---- Spawn dust ----
function spawnDust(wx, wy, wz) {
    for (let i = 0; i < MAX_DUST; i++) {
        const d = dustData[i];
        if (d.active) continue;
        d.active  = true;
        d.x  = wx + (rng() - 0.5) * 8;
        d.y  = wy + rng() * 2;
        d.z  = wz + (rng() - 0.5) * 8;
        d.vx = (rng() - 0.5) * 1.5;
        d.vy = 0.8 + rng() * 1.2;
        d.vz = (rng() - 0.5) * 1.5;
        d.life    = 0;
        d.maxLife = 2.5 + rng() * 2.0;
        return;
    }
}

// ---- Landslide trigger zone (upper portion of slope) ----
function getSlideOriginBounds() {
    const slopeRad = params.slope * Math.PI / 180;
    const maxH     = Math.tan(slopeRad) * TERRAIN_W * 0.3;
    const threshold = maxH * 0.45;
    const xLeft  = -TERRAIN_W / 2 + 5;
    const xRight = -TERRAIN_W / 2 + TERRAIN_W * 0.5;
    return { xLeft, xRight, threshold };
}

// ---- Flow speed for display ----
function computeFlowSpeed() {
    const slopeRad = params.slope * Math.PI / 180;
    const mat      = MAT_PROPS[params.material];
    const sat      = params.saturation / 100;
    return Math.max(0.1, Math.sin(slopeRad) * 12 * (1 + sat * 1.8) / mat.friction).toFixed(1);
}

// ---- Update debris ----
function updateDebris(dt) {
    let count = 0;
    let dustCount = 0;

    for (let i = 0; i < MAX_DEBRIS; i++) {
        const d = debrisData[i];
        if (!d.active) continue;
        d.life += dt;
        if (d.life > d.maxLife) { d.active = false; continue; }

        // Gravity
        d.vy -= 9.8 * dt;

        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;

        // Terrain collision — slide along surface
        const gy = sampleTerrainY(d.x, d.z);
        if (d.y <= gy + 0.3) {
            d.y  = gy + 0.3;
            d.vy = Math.abs(d.vy) * 0.15;  // bounce damp

            // redirect along slope
            const sd = slopeDir(d.x, d.z);
            const slopeMag = Math.sqrt(sd.dx * sd.dx + sd.dz * sd.dz);
            if (slopeMag > 0.001) {
                const friction = MAT_PROPS[params.material].friction;
                const satBoost = 1 + params.saturation / 100 * 1.4;
                const frFactor = Math.max(0.02, friction / satBoost);
                d.vx += sd.dx * 0.9 * dt;
                d.vz += sd.dz * 0.9 * dt;
                d.vx *= (1 - frFactor * dt * 1.5);
                d.vz *= (1 - frFactor * dt * 1.5);
            } else {
                // flat — stop
                d.vx *= 0.85;
                d.vz *= 0.85;
            }

            // Erode terrain at contact
            const ni = Math.floor((d.x + TERRAIN_W / 2) / TERRAIN_W * TERRAIN_SW);
            const nj = Math.floor((d.z + TERRAIN_D / 2) / TERRAIN_D * TERRAIN_SD);
            const ei = Math.max(0, Math.min(vtxCount - 1, nj * (TERRAIN_SW + 1) + ni));
            erosionMap[ei] = Math.min(1, (erosionMap[ei] || 0) + dt * 0.08);

            // Spawn dust near leading edge at valley
            if (d.x > 10 && dustCount < 3) {
                dustAccum += dt * 4;
                if (dustAccum > 1) { spawnDust(d.x, d.y, d.z); dustAccum--; dustCount++; }
            }
        }

        debrisPositions[count * 3]     = d.x;
        debrisPositions[count * 3 + 1] = d.y;
        debrisPositions[count * 3 + 2] = d.z;
        debrisColors[count * 3]     = d.r;
        debrisColors[count * 3 + 1] = d.g;
        debrisColors[count * 3 + 2] = d.b;
        count++;
    }

    activeDebris = count;
    debrisGeo.setDrawRange(0, count);
    debrisGeo.attributes.position.needsUpdate = true;
    debrisGeo.attributes.color.needsUpdate    = true;

    // Dust update
    let dc = 0;
    for (let i = 0; i < MAX_DUST; i++) {
        const d = dustData[i];
        if (!d.active) continue;
        d.life += dt;
        if (d.life > d.maxLife) { d.active = false; continue; }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.vy *= 0.98;
        const alpha = 1 - d.life / d.maxLife;
        dustPos[dc * 3]     = d.x;
        dustPos[dc * 3 + 1] = d.y;
        dustPos[dc * 3 + 2] = d.z;
        dustColors[dc * 3]     = 0.78 * alpha;
        dustColors[dc * 3 + 1] = 0.68 * alpha;
        dustColors[dc * 3 + 2] = 0.54 * alpha;
        dc++;
    }
    activeDust = dc;
    dustGeo.setDrawRange(0, dc);
    dustGeo.attributes.position.needsUpdate = true;
    dustGeo.attributes.color.needsUpdate    = true;
}

// ---- Spawn new debris from slide zone ----
function spawnDebrisFromSlope(dt) {
    const mat = MAT_PROPS[params.material];
    const slopeRad = params.slope * Math.PI / 180;
    const satFactor = 1 + params.saturation / 100 * 2.5;

    // Spawn rate based on slope, saturation, material cohesion
    const rate = Math.max(0, (Math.sin(slopeRad) - mat.friction * 0.5) * satFactor * 40)
               / (mat.cohesion * 0.1 + 1);

    debrisAccum += rate * dt;
    const bounds = getSlideOriginBounds();

    while (debrisAccum >= 1) {
        const wx = bounds.xLeft + rng() * (bounds.xRight - bounds.xLeft);
        const wz = (rng() - 0.5) * TERRAIN_D * 0.75;
        const gy = sampleTerrainY(wx, wz);
        if (gy > bounds.threshold) {
            spawnDebris(wx, wz);
            totalVol += 0.4;
        }
        debrisAccum--;
    }
}

// ---- Status update ----
function syncStatus() {
    if (running) {
        document.getElementById('debris-volume').textContent = Math.round(totalVol) + ' m³';
        document.getElementById('flow-speed').textContent    = computeFlowSpeed() + ' m/s';
    }
}

// ---- Terrain colors (periodic) ----
let colorTimer = 0;
function maybeUpdateColors(dt) {
    colorTimer += dt;
    if (colorTimer > 0.5) {
        updateTerrainColors(erosionMap);
        colorTimer = 0;
    }
}

// ---- Controls ----
function bindControls() {
    const map = [
        { id: 'slope',      key: 'slope',      dec: 0, label: null },
        { id: 'saturation', key: 'saturation', dec: 0, label: null },
        { id: 'simspeed',   key: 'simSpeed',   dec: 1, label: null },
    ];
    map.forEach(({ id, key, dec }) => {
        const el  = document.getElementById(id);
        const val = document.getElementById('val-' + id);
        el.addEventListener('input', () => {
            val.textContent = parseFloat(el.value).toFixed(dec);
            params[key]     = parseFloat(el.value);
            if (key === 'slope' && !running) {
                buildTerrain(params.slope);
                updateTerrainColors(null);
                buildTrees();
            }
        });
    });

    // Material slider — discrete 0/1/2
    const matEl  = document.getElementById('material');
    const matVal = document.getElementById('val-material');
    matEl.addEventListener('input', () => {
        params.material = Math.round(parseFloat(matEl.value));
        matVal.textContent = MATERIAL_NAMES[params.material];
    });

    const btnStart = document.getElementById('btn-start');
    btnStart.addEventListener('click', () => {
        running = !running;
        btnStart.textContent = running ? 'Jeda' : 'Lanjut';
        document.getElementById('status-text').textContent = running ? 'Berjalan' : 'Dijeda';
        if (running) {
            document.getElementById('flow-speed').textContent = computeFlowSpeed() + ' m/s';
        }
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
        running  = false;
        simTime  = 0;
        totalVol = 0;
        debrisAccum = 0;
        dustAccum   = 0;
        debrisData.forEach(d => { d.active = false; });
        dustData.forEach(d => { d.active = false; });
        erosionMap.fill(0);
        activeDebris = 0;
        activeDust   = 0;
        debrisGeo.setDrawRange(0, 0);
        dustGeo.setDrawRange(0, 0);
        buildTerrain(params.slope);
        updateTerrainColors(null);
        buildTrees();
        btnStart.textContent = 'Mulai';
        document.getElementById('status-text').textContent  = 'Siap';
        document.getElementById('debris-volume').textContent = '-- m³';
        document.getElementById('flow-speed').textContent   = '-- m/s';
        document.getElementById('sim-time').textContent     = '0 s';
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
        const sdt = dt * params.simSpeed;
        simTime  += sdt;
        document.getElementById('sim-time').textContent = simTime.toFixed(1) + ' s';
        spawnDebrisFromSlope(sdt);
        updateDebris(sdt);
        maybeUpdateColors(sdt);
        syncStatus();
    }

    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
onResize();
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
