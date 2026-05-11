import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Renderer ----
const canvas   = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8956a);
scene.fog = new THREE.Fog(0xc4a07a, 160, 320);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(0, 55, 95);

// ---- Orbit Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 12, 0);
controls.maxPolarAngle = Math.PI * 0.50;
controls.minDistance   = 30;
controls.maxDistance   = 220;
controls.update();

// ---- Lighting ----
scene.add(new THREE.HemisphereLight(0xffd4a0, 0x3a2810, 2.2));
const sun = new THREE.DirectionalLight(0xffe8c0, 2.8);
sun.position.set(-70, 130, 60);
scene.add(sun);
const lavaLight = new THREE.PointLight(0xff5500, 5, 70);
lavaLight.position.set(0, 38, 0);
scene.add(lavaLight);

// ---- Ground plane ----
const groundGeo = new THREE.PlaneGeometry(260, 260);
groundGeo.rotateX(-Math.PI / 2);
scene.add(new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x3a2820 })));

// Ground grid overlay
const gridGeo = new THREE.PlaneGeometry(260, 260, 28, 28);
gridGeo.rotateX(-Math.PI / 2);
gridGeo.translate(0, 0.1, 0);
scene.add(new THREE.Mesh(gridGeo, new THREE.MeshBasicMaterial({
    color: 0x5a4030, wireframe: true, transparent: true, opacity: 0.14, depthWrite: false,
})));

// ---- Volcano mountain — truncated frustum (CylinderGeometry) ----
// Wide base, wide open crater at top — realistic stratovolcano proportions
const CONE_H      = 34;   // height — shorter so not too pointy
const CONE_R      = 44;   // base radius — wide
const CONE_TOP_R  = 8;    // crater rim radius — open hole at top
const HALF_H      = CONE_H / 2; // 17

// CylinderGeometry(topRadius, bottomRadius, height, radialSegs, heightSegs, openEnded)
const coneGeo = new THREE.CylinderGeometry(CONE_TOP_R, CONE_R, CONE_H, 48, 22, true);
const cp      = coneGeo.attributes.position;
const colArr  = new Float32Array(cp.count * 3);

for (let i = 0; i < cp.count; i++) {
    const lx = cp.getX(i);
    const ly = cp.getY(i); // -17 (base) to +17 (crater rim)
    const lz = cp.getZ(i);

    const ht    = (ly + HALF_H) / CONE_H; // 0 at base, 1 at crater rim
    const r     = Math.sqrt(lx * lx + lz * lz);
    const theta = Math.atan2(lz, lx);

    // Radial displacement: ridges along the slope, fade near crater rim
    if (r > 0.01) {
        const ridge = (
            Math.sin(theta * 4 + ht * 3.0) * 3.2
          + Math.cos(theta * 7 - ht * 2.2) * 1.6
          + Math.sin(theta * 11 + ht * 5.0) * 0.7
        ) * (1 - ht * 0.7);

        cp.setX(i, lx + (lx / r) * ridge);
        cp.setZ(i, lz + (lz / r) * ridge);
    }

    // Y displacement for uneven ridge heights
    cp.setY(i, ly + Math.sin(theta * 5 + ht * 4) * 1.5 * (1 - ht));

    // Vertex color by height
    let cr, cg, cb;
    if (ht < 0.12) {
        cr = 0.28; cg = 0.20; cb = 0.14;           // base: dark earth
    } else if (ht < 0.48) {
        const s = (ht - 0.12) / 0.36;
        cr = 0.28 + s * 0.18; cg = 0.20 + s * 0.07; cb = 0.14 + s * 0.04;
    } else if (ht < 0.80) {
        const s = (ht - 0.48) / 0.32;
        cr = 0.46 - s * 0.22; cg = 0.27 - s * 0.12; cb = 0.18 - s * 0.08;
    } else {
        cr = 0.16; cg = 0.10; cb = 0.07;           // crater rim: dark volcanic rock
    }
    colArr[i*3] = cr; colArr[i*3+1] = cg; colArr[i*3+2] = cb;
}

coneGeo.computeVertexNormals();
coneGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

const volcanoCone = new THREE.Mesh(coneGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
volcanoCone.position.y = HALF_H; // base at y=0, crater rim at y=CONE_H
scene.add(volcanoCone);


// Skirt at base for natural ground transition
const skirtGeo = new THREE.CylinderGeometry(CONE_R - 2, CONE_R + 14, 6, 48, 3, true);
const skirtCp  = skirtGeo.attributes.position;
for (let i = 0; i < skirtCp.count; i++) {
    const lx = skirtCp.getX(i), lz = skirtCp.getZ(i);
    const r = Math.sqrt(lx*lx + lz*lz), theta = Math.atan2(lz, lx);
    if (r > 0.01) {
        const bump = Math.sin(theta * 6 + 1.1) * 2.0 + Math.cos(theta * 9 - 0.4) * 1.0;
        skirtCp.setX(i, lx + (lx/r) * bump);
        skirtCp.setZ(i, lz + (lz/r) * bump);
    }
}
skirtGeo.computeVertexNormals();
scene.add(new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ color: 0x332010 })));

// ---- Crater fill — glowing lava pool inside the open top ----
const CRATER_WORLD_Y = CONE_H - 1.5; // slightly below crater rim
const craterGeo = new THREE.CircleGeometry(CONE_TOP_R - 0.5, 32);
craterGeo.rotateX(-Math.PI / 2);
const craterMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
const craterDisc = new THREE.Mesh(craterGeo, craterMat);
craterDisc.position.set(0, CRATER_WORLD_Y, 0);
scene.add(craterDisc);

// ---- Smoke sprite texture (procedural canvas) ----
const smkCvs = document.createElement('canvas');
smkCvs.width = smkCvs.height = 64;
const smkCtx  = smkCvs.getContext('2d');
const smkGrad = smkCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
smkGrad.addColorStop(0,   'rgba(175,150,130,0.95)');
smkGrad.addColorStop(0.4, 'rgba(145,120,100,0.50)');
smkGrad.addColorStop(1,   'rgba(100, 82, 68, 0.0)');
smkCtx.fillStyle = smkGrad;
smkCtx.fillRect(0, 0, 64, 64);
const smokeTex = new THREE.CanvasTexture(smkCvs);

// ---- Particle buffers ----
const MAX_LAVA  = 350;
const MAX_ASH   = 700;
const MAX_SMOKE = 28;

function makeBuf(n) {
    const b = { pos: new Float32Array(n*3), vel: new Float32Array(n*3),
                age: new Float32Array(n).fill(1), life: new Float32Array(n).fill(1) };
    for (let i = 0; i < n; i++) b.pos[i*3+1] = -9999;
    return b;
}

const lavaBuf = makeBuf(MAX_LAVA);
const lavaGeo = new THREE.BufferGeometry();
lavaGeo.setAttribute('position', new THREE.BufferAttribute(lavaBuf.pos, 3));
const lavaColBuf = new Float32Array(MAX_LAVA * 3);
for (let i = 0; i < MAX_LAVA; i++) {
    const c = new THREE.Color().setHSL(0.02 + Math.random() * 0.09, 1.0, 0.50 + Math.random() * 0.2);
    lavaColBuf[i*3] = c.r; lavaColBuf[i*3+1] = c.g; lavaColBuf[i*3+2] = c.b;
}
lavaGeo.setAttribute('color', new THREE.BufferAttribute(lavaColBuf, 3));
scene.add(new THREE.Points(lavaGeo, new THREE.PointsMaterial({
    size: 2.4, vertexColors: true, transparent: true, opacity: 1.0, sizeAttenuation: true,
})));

const ashBuf = makeBuf(MAX_ASH);
const ashGeo = new THREE.BufferGeometry();
ashGeo.setAttribute('position', new THREE.BufferAttribute(ashBuf.pos, 3));
scene.add(new THREE.Points(ashGeo, new THREE.PointsMaterial({
    size: 1.1, color: 0x998880, transparent: true, opacity: 0.65, sizeAttenuation: true,
})));

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
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.5;
    lavaBuf.pos[i*3] = Math.sin(a)*r; lavaBuf.pos[i*3+1] = CRATER_WORLD_Y+0.5; lavaBuf.pos[i*3+2] = Math.cos(a)*r;
    const up = 9 + Math.random() * params.pressure * 2.0;
    const h  = 0.6 + Math.random() * params.pressure * 0.4;
    lavaBuf.vel[i*3] = Math.sin(a)*h; lavaBuf.vel[i*3+1] = up; lavaBuf.vel[i*3+2] = Math.cos(a)*h;
    lavaBuf.life[i] = 1.0 + Math.random() * 1.5; lavaBuf.age[i] = 0;
}

function spawnAsh(i) {
    const a = Math.random() * Math.PI * 2;
    const wRad = params.windDir * Math.PI / 180;
    ashBuf.pos[i*3] = Math.sin(a)*2.5*Math.random(); ashBuf.pos[i*3+1] = CRATER_WORLD_Y+2+Math.random()*5; ashBuf.pos[i*3+2] = Math.cos(a)*2.5*Math.random();
    ashBuf.vel[i*3] = (Math.random()-0.5)*2 + Math.sin(wRad)*params.windSpeed*0.06;
    ashBuf.vel[i*3+1] = 0.8 + Math.random()*params.pressure*0.25;
    ashBuf.vel[i*3+2] = (Math.random()-0.5)*2 + Math.cos(wRad)*params.windSpeed*0.06;
    ashBuf.life[i] = 7 + Math.random()*10; ashBuf.age[i] = 0;
}

function spawnSmoke(sp) {
    const a = Math.random() * Math.PI * 2;
    const wRad = params.windDir * Math.PI / 180;
    sp.position.set(Math.sin(a)*1.5, CRATER_WORLD_Y+2, Math.cos(a)*1.5);
    sp.userData.active=true; sp.userData.age=0;
    sp.userData.life=5+Math.random()*6;
    sp.userData.vy=1.3+Math.random()*params.pressure*0.22;
    sp.userData.vx=Math.sin(wRad)*params.windSpeed*0.04;
    sp.userData.vz=Math.cos(wRad)*params.windSpeed*0.04;
    sp.userData.scale0=5+Math.random()*9;
}

// ---- Particle update ----
function updateParticles(dt) {
    const GRAV_LAVA = 18, GRAV_ASH = 0.9;
    const wRad = params.windDir * Math.PI / 180;
    const wX = Math.sin(wRad)*params.windSpeed*0.04, wZ = Math.cos(wRad)*params.windSpeed*0.04;

    if (running) {
        accum.lava  += params.pressure * params.volume * 1.4 * dt;
        accum.ash   += params.pressure * params.volume * 3.5 * dt;
        accum.smoke += dt;
    }

    for (let i = 0; i < MAX_LAVA; i++) {
        if (lavaBuf.age[i] >= lavaBuf.life[i]) {
            if (accum.lava >= 1) { spawnLava(i); accum.lava--; } else lavaBuf.pos[i*3+1] = -9999;
            continue;
        }
        lavaBuf.age[i] += dt;
        lavaBuf.vel[i*3+1] -= GRAV_LAVA * dt;
        lavaBuf.pos[i*3]   += lavaBuf.vel[i*3]   * dt;
        lavaBuf.pos[i*3+1] += lavaBuf.vel[i*3+1] * dt;
        lavaBuf.pos[i*3+2] += lavaBuf.vel[i*3+2] * dt;
        if (lavaBuf.pos[i*3+1] < 0) { lavaBuf.pos[i*3+1] = -9999; lavaBuf.age[i] = lavaBuf.life[i]; }
    }
    lavaGeo.attributes.position.needsUpdate = true;

    for (let i = 0; i < MAX_ASH; i++) {
        if (ashBuf.age[i] >= ashBuf.life[i]) {
            if (accum.ash >= 1) { spawnAsh(i); accum.ash--; } else ashBuf.pos[i*3+1] = -9999;
            continue;
        }
        ashBuf.age[i] += dt;
        ashBuf.vel[i*3] += wX*dt; ashBuf.vel[i*3+2] += wZ*dt; ashBuf.vel[i*3+1] -= GRAV_ASH*dt;
        ashBuf.pos[i*3]   += ashBuf.vel[i*3]   * dt;
        ashBuf.pos[i*3+1] += ashBuf.vel[i*3+1] * dt;
        ashBuf.pos[i*3+2] += ashBuf.vel[i*3+2] * dt;
        if (ashBuf.pos[i*3+1] < -2) { ashBuf.pos[i*3+1] = -9999; ashBuf.age[i] = ashBuf.life[i]; }
    }
    ashGeo.attributes.position.needsUpdate = true;

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

// ---- FX ----
function updateFX(t) {
    const flicker = 0.65 + 0.35*Math.sin(t*9.3) + 0.12*Math.sin(t*17.7) + 0.08*Math.sin(t*4.4);
    const intensity = params.pressure / 10;
    craterMat.color.setRGB(1.0, 0.22 + 0.38*intensity*flicker, 0.0);
    lavaLight.intensity = intensity * 7 * flicker;
    scene.background.setRGB(0.72 + intensity*0.16, 0.59 - intensity*0.14, 0.42 - intensity*0.18);
}

// ---- Status ----
function syncStatus() {
    document.getElementById('ejection-height').textContent = Math.round(20 + params.pressure*13) + ' m';
    document.getElementById('ash-range').textContent       = Math.round(params.windSpeed*params.pressure*1.8) + ' km';
}

// ---- Controls ----
function bindControls() {
    [
        { id:'pressure', key:'pressure', dec:1 },
        { id:'volume',   key:'volume',   dec:1 },
        { id:'winddir',  key:'windDir',  dec:0 },
        { id:'windspeed',key:'windSpeed',dec:0 },
        { id:'simspeed', key:'simSpeed', dec:1 },
    ].forEach(({ id, key, dec }) => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            document.getElementById('val-'+id).textContent = parseFloat(el.value).toFixed(dec);
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
        for (let i = 0; i < MAX_LAVA; i++) { lavaBuf.age[i]=1; lavaBuf.pos[i*3+1]=-9999; }
        for (let i = 0; i < MAX_ASH;  i++) { ashBuf.age[i]=1;  ashBuf.pos[i*3+1]=-9999; }
        lavaGeo.attributes.position.needsUpdate = true;
        ashGeo.attributes.position.needsUpdate  = true;
        smokePool.forEach(s => { s.userData.active=false; s.position.y=-9999; });
    });
}

// ---- Resize ----
function onResize() {
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
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
