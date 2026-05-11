import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Renderer ----
const canvas   = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8956a);
scene.fog = new THREE.Fog(0xc4a07a, 140, 300);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(0, 65, 100);

// ---- Orbit Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 15, 0);
controls.maxPolarAngle = Math.PI * 0.50;
controls.minDistance   = 30;
controls.maxDistance   = 220;
controls.update();

// ---- Lighting ----
scene.add(new THREE.HemisphereLight(0xffd4a0, 0x3a2810, 2.2));
const sun = new THREE.DirectionalLight(0xffe8c0, 2.8);
sun.position.set(-70, 130, 60);
scene.add(sun);

// Point light at crater — flickers to simulate lava glow
const lavaLight = new THREE.PointLight(0xff5500, 5, 70);
lavaLight.position.set(0, 48, 0);
scene.add(lavaLight);

// ---- Mountain terrain (Gaussian heightmap + noise) ----
const T_SIZE = 220;
const T_SEGS = 90;
const PEAK_H = 42;    // volcano peak height in scene units
const SIGMA  = 22;    // controls how wide/steep the mountain is
const CRATER_Y = 38;  // approximate y of crater interior (peak - crater depth)

const terrainGeo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEGS, T_SEGS);
terrainGeo.rotateX(-Math.PI / 2);

const tPos    = terrainGeo.attributes.position;
const tColArr = new Float32Array(tPos.count * 3);

for (let i = 0; i < tPos.count; i++) {
    const x    = tPos.getX(i);
    const z    = tPos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);

    // Primary Gaussian peak — creates the main volcano cone
    const gauss = PEAK_H * Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA));

    // Terrain noise scaled by local height (flat stays flat, slopes have texture)
    const noiseScale = Math.min(1, gauss / 8);
    const noise = (
        Math.sin(x * 0.13 + z * 0.10) * 2.8
      + Math.cos(x * 0.07 - z * 0.12) * 2.2
      + Math.sin(x * 0.21 + z * 0.18) * 1.0
      + Math.cos((x + z) * 0.05) * 3.8
      + Math.sin(x * 0.35 - z * 0.28) * 0.6
    ) * noiseScale;

    // Secondary rolling hills around the base
    const hill1 = 7 * Math.exp(-((x-50)*(x-50) + (z-30)*(z-30)) / 500);
    const hill2 = 5 * Math.exp(-((x+40)*(x+40) + (z-55)*(z-55)) / 420);
    const hill3 = 4 * Math.exp(-((x-35)*(x-35) + (z+60)*(z+60)) / 380);

    // Crater depression at peak
    const craterR  = 5.5;
    const craterFd = Math.max(0, 1 - dist / craterR);
    const crater   = -4.5 * craterFd * craterFd;

    const y = gauss + noise + hill1 + hill2 + hill3 + crater;
    tPos.setY(i, y);

    // Vertex colors by height — dark earth → volcanic brown → dark rock → crater
    const t = Math.max(0, Math.min(1, y / PEAK_H));
    let r, g, b;
    if (t < 0.06) {
        // flat surroundings: dark earth
        r = 0.26; g = 0.21; b = 0.15;
    } else if (t < 0.30) {
        const s = (t - 0.06) / 0.24;
        // lower slopes: earthy brown
        r = 0.26 + s * 0.18; g = 0.21 + s * 0.08; b = 0.15 + s * 0.04;
    } else if (t < 0.65) {
        const s = (t - 0.30) / 0.35;
        // mid slopes: medium volcanic rock
        r = 0.44 + s * 0.04; g = 0.29 - s * 0.04; b = 0.19 - s * 0.04;
    } else if (t < 0.88) {
        const s = (t - 0.65) / 0.23;
        // upper slopes: darkening rock
        r = 0.48 - s * 0.20; g = 0.25 - s * 0.10; b = 0.15 - s * 0.06;
    } else {
        // crater zone: very dark volcanic rock
        r = 0.16; g = 0.10; b = 0.07;
    }
    tColArr[i*3] = r; tColArr[i*3+1] = g; tColArr[i*3+2] = b;
}

terrainGeo.computeVertexNormals();
terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColArr, 3));
scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));

// Low-res grid overlay on flat ground (reference grid, stops at mountain base)
const gridGeo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, 28, 28);
gridGeo.rotateX(-Math.PI / 2);
gridGeo.translate(0, 0.12, 0);
scene.add(new THREE.Mesh(gridGeo, new THREE.MeshBasicMaterial({
    color: 0x6a5040, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false,
})));

// ---- Crater glow disc ----
const craterGeo = new THREE.CircleGeometry(3.0, 32);
craterGeo.rotateX(-Math.PI / 2);
const craterMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
const craterDisc = new THREE.Mesh(craterGeo, craterMat);
craterDisc.position.set(0, CRATER_Y + 0.2, 0);
scene.add(craterDisc);

// ---- Smoke sprite texture (procedural) ----
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = smokeCanvas.height = 64;
const sCtx  = smokeCanvas.getContext('2d');
const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
sGrad.addColorStop(0,   'rgba(175,150,130,0.95)');
sGrad.addColorStop(0.4, 'rgba(145,120,100,0.50)');
sGrad.addColorStop(1,   'rgba(100, 82, 68, 0.0)');
sCtx.fillStyle = sGrad;
sCtx.fillRect(0, 0, 64, 64);
const smokeTex = new THREE.CanvasTexture(smokeCanvas);

// ---- Particle buffers ----
const MAX_LAVA  = 350;
const MAX_ASH   = 700;
const MAX_SMOKE = 28;

function makeBuf(n) {
    const buf = {
        pos:  new Float32Array(n * 3),
        vel:  new Float32Array(n * 3),
        age:  new Float32Array(n).fill(1),
        life: new Float32Array(n).fill(1),
    };
    for (let i = 0; i < n; i++) buf.pos[i*3+1] = -9999;
    return buf;
}

// Lava
const lavaBuf  = makeBuf(MAX_LAVA);
const lavaGeo  = new THREE.BufferGeometry();
lavaGeo.setAttribute('position', new THREE.BufferAttribute(lavaBuf.pos, 3));

const lavaColArr = new Float32Array(MAX_LAVA * 3);
for (let i = 0; i < MAX_LAVA; i++) {
    const hue = 0.02 + Math.random() * 0.09; // red → orange → yellow
    const col = new THREE.Color().setHSL(hue, 1.0, 0.50 + Math.random() * 0.2);
    lavaColArr[i*3] = col.r; lavaColArr[i*3+1] = col.g; lavaColArr[i*3+2] = col.b;
}
lavaGeo.setAttribute('color', new THREE.BufferAttribute(lavaColArr, 3));
const lavaPts = new THREE.Points(lavaGeo, new THREE.PointsMaterial({
    size: 2.4, vertexColors: true, transparent: true, opacity: 1.0, sizeAttenuation: true,
}));
scene.add(lavaPts);

// Ash
const ashBuf = makeBuf(MAX_ASH);
const ashGeo = new THREE.BufferGeometry();
ashGeo.setAttribute('position', new THREE.BufferAttribute(ashBuf.pos, 3));
const ashPts = new THREE.Points(ashGeo, new THREE.PointsMaterial({
    size: 1.1, color: 0x998880, transparent: true, opacity: 0.65, sizeAttenuation: true,
}));
scene.add(ashPts);

// Smoke sprites
const smokePool = Array.from({ length: MAX_SMOKE }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
    }));
    sp.userData = { active: false, age: 0, life: 0, vy: 0, vx: 0, vz: 0, scale0: 1 };
    sp.position.y = -9999;
    scene.add(sp);
    return sp;
});

// ---- Sim state ----
let running = false;
let simTime = 0;
const params = { pressure: 5, volume: 5, windDir: 45, windSpeed: 10, simSpeed: 1.0 };
const accum  = { lava: 0, ash: 0, smoke: 0 };

// ---- Spawn helpers ----
function spawnLava(i) {
    const angle = Math.random() * Math.PI * 2;
    const r     = Math.random() * 1.5;
    lavaBuf.pos[i*3]   = Math.sin(angle) * r;
    lavaBuf.pos[i*3+1] = CRATER_Y + 1;
    lavaBuf.pos[i*3+2] = Math.cos(angle) * r;
    const up = 9 + Math.random() * params.pressure * 2.0;
    const h  = 0.6 + Math.random() * params.pressure * 0.40;
    lavaBuf.vel[i*3]   = Math.sin(angle) * h;
    lavaBuf.vel[i*3+1] = up;
    lavaBuf.vel[i*3+2] = Math.cos(angle) * h;
    lavaBuf.life[i] = 1.0 + Math.random() * 1.5;
    lavaBuf.age[i]  = 0;
}

function spawnAsh(i) {
    const angle  = Math.random() * Math.PI * 2;
    const wRad   = params.windDir * Math.PI / 180;
    ashBuf.pos[i*3]   = Math.sin(angle) * (Math.random() * 2.5);
    ashBuf.pos[i*3+1] = CRATER_Y + 2 + Math.random() * 5;
    ashBuf.pos[i*3+2] = Math.cos(angle) * (Math.random() * 2.5);
    ashBuf.vel[i*3]   = (Math.random() - 0.5) * 2 + Math.sin(wRad) * params.windSpeed * 0.06;
    ashBuf.vel[i*3+1] = 0.8 + Math.random() * params.pressure * 0.25;
    ashBuf.vel[i*3+2] = (Math.random() - 0.5) * 2 + Math.cos(wRad) * params.windSpeed * 0.06;
    ashBuf.life[i] = 7 + Math.random() * 10;
    ashBuf.age[i]  = 0;
}

function spawnSmoke(sp) {
    const angle = Math.random() * Math.PI * 2;
    const wRad  = params.windDir * Math.PI / 180;
    sp.position.set(Math.sin(angle) * 1.5, CRATER_Y + 2, Math.cos(angle) * 1.5);
    sp.userData.active = true;
    sp.userData.age    = 0;
    sp.userData.life   = 5 + Math.random() * 6;
    sp.userData.vy     = 1.3 + Math.random() * params.pressure * 0.22;
    sp.userData.vx     = Math.sin(wRad) * params.windSpeed * 0.04;
    sp.userData.vz     = Math.cos(wRad) * params.windSpeed * 0.04;
    sp.userData.scale0 = 5 + Math.random() * 9;
}

// ---- Particle update ----
function updateParticles(dt) {
    const GRAV_LAVA = 18;
    const GRAV_ASH  = 0.9;
    const wRad  = params.windDir * Math.PI / 180;
    const windX = Math.sin(wRad) * params.windSpeed * 0.04;
    const windZ = Math.cos(wRad) * params.windSpeed * 0.04;

    if (running) {
        accum.lava  += params.pressure * params.volume * 1.4 * dt;
        accum.ash   += params.pressure * params.volume * 3.5 * dt;
        accum.smoke += dt;
    }

    // Lava
    for (let i = 0; i < MAX_LAVA; i++) {
        if (lavaBuf.age[i] >= lavaBuf.life[i]) {
            if (accum.lava >= 1) { spawnLava(i); accum.lava--; }
            else lavaBuf.pos[i*3+1] = -9999;
            continue;
        }
        lavaBuf.age[i]     += dt;
        lavaBuf.vel[i*3+1] -= GRAV_LAVA * dt;
        lavaBuf.pos[i*3]   += lavaBuf.vel[i*3]   * dt;
        lavaBuf.pos[i*3+1] += lavaBuf.vel[i*3+1] * dt;
        lavaBuf.pos[i*3+2] += lavaBuf.vel[i*3+2] * dt;
        if (lavaBuf.pos[i*3+1] < 0) {
            lavaBuf.pos[i*3+1] = -9999;
            lavaBuf.age[i] = lavaBuf.life[i];
        }
    }
    lavaGeo.attributes.position.needsUpdate = true;

    // Ash
    for (let i = 0; i < MAX_ASH; i++) {
        if (ashBuf.age[i] >= ashBuf.life[i]) {
            if (accum.ash >= 1) { spawnAsh(i); accum.ash--; }
            else ashBuf.pos[i*3+1] = -9999;
            continue;
        }
        ashBuf.age[i]     += dt;
        ashBuf.vel[i*3]   += windX * dt;
        ashBuf.vel[i*3+2] += windZ * dt;
        ashBuf.vel[i*3+1] -= GRAV_ASH * dt;
        ashBuf.pos[i*3]   += ashBuf.vel[i*3]   * dt;
        ashBuf.pos[i*3+1] += ashBuf.vel[i*3+1] * dt;
        ashBuf.pos[i*3+2] += ashBuf.vel[i*3+2] * dt;
        if (ashBuf.pos[i*3+1] < -2) {
            ashBuf.pos[i*3+1] = -9999;
            ashBuf.age[i] = ashBuf.life[i];
        }
    }
    ashGeo.attributes.position.needsUpdate = true;

    // Smoke
    const smokeInterval = Math.max(0.25, 1.1 - params.pressure * 0.08);
    if (accum.smoke >= smokeInterval) {
        accum.smoke = 0;
        const free = smokePool.find(s => !s.userData.active);
        if (free && running) spawnSmoke(free);
    }
    smokePool.forEach(sp => {
        if (!sp.userData.active) return;
        sp.userData.age += dt;
        const t = sp.userData.age / sp.userData.life;
        if (t >= 1) { sp.userData.active = false; sp.position.y = -9999; return; }
        sp.position.x += sp.userData.vx * dt;
        sp.position.y += sp.userData.vy * dt;
        sp.position.z += sp.userData.vz * dt;
        sp.scale.setScalar(sp.userData.scale0 * (1 + t * 3.5));
        sp.material.opacity = (1 - t) * 0.42;
    });
}

// ---- FX: crater flicker + sky tint ----
function updateFX(t) {
    const flicker = 0.65 + 0.35 * Math.sin(t * 9.3) + 0.12 * Math.sin(t * 17.7) + 0.08 * Math.sin(t * 4.4);
    const intensity = params.pressure / 10;

    craterMat.color.setRGB(1.0, 0.22 + 0.38 * intensity * flicker, 0.0);
    lavaLight.intensity = intensity * 7 * flicker;

    // Background shifts warmer/redder as pressure rises
    scene.background.setRGB(
        0.72 + intensity * 0.16,
        0.59 - intensity * 0.14,
        0.42 - intensity * 0.18
    );
}

// ---- Status ----
function syncStatus() {
    document.getElementById('ejection-height').textContent = Math.round(20 + params.pressure * 13) + ' m';
    document.getElementById('ash-range').textContent       = Math.round(params.windSpeed * params.pressure * 1.8) + ' km';
}

// ---- Controls ----
function bindControls() {
    [
        { id: 'pressure',  key: 'pressure',  dec: 1 },
        { id: 'volume',    key: 'volume',    dec: 1 },
        { id: 'winddir',   key: 'windDir',   dec: 0 },
        { id: 'windspeed', key: 'windSpeed', dec: 0 },
        { id: 'simspeed',  key: 'simSpeed',  dec: 1 },
    ].forEach(({ id, key, dec }) => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            document.getElementById('val-' + id).textContent = parseFloat(el.value).toFixed(dec);
            params[key] = parseFloat(el.value);
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
        running = false; simTime = 0;
        accum.lava = accum.ash = accum.smoke = 0;
        btnStart.textContent = 'Mulai';
        document.getElementById('status-text').textContent = 'Siap';
        document.getElementById('sim-time').textContent    = '0 s';
        for (let i = 0; i < MAX_LAVA; i++) { lavaBuf.age[i] = 1; lavaBuf.pos[i*3+1] = -9999; }
        for (let i = 0; i < MAX_ASH;  i++) { ashBuf.age[i]  = 1; ashBuf.pos[i*3+1]  = -9999; }
        lavaGeo.attributes.position.needsUpdate = true;
        ashGeo.attributes.position.needsUpdate  = true;
        smokePool.forEach(s => { s.userData.active = false; s.position.y = -9999; });
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
    updateParticles(dt * params.simSpeed);
    updateFX(simTime);
    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
syncStatus();
onResize();
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
