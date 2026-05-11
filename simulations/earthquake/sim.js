import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Renderer ----
const canvas   = document.getElementById('sim-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c8d8);
scene.fog = new THREE.Fog(0xc0cedd, 130, 290);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(0, 90, 130);

// ---- Orbit Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 4, 0);
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance   = 30;
controls.maxDistance   = 260;
controls.update();

// ---- Lighting ----
scene.add(new THREE.HemisphereLight(0xd0e4f4, 0x504840, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(80, 140, 60);
scene.add(sun);

// ---- Ground ----
const G_SIZE = 240;
const G_SEGS = 60;
const groundGeo = new THREE.PlaneGeometry(G_SIZE, G_SIZE, G_SEGS, G_SEGS);
groundGeo.rotateX(-Math.PI / 2);
const gPos    = groundGeo.attributes.position;
const gOrig   = new Float32Array(gPos.array);
const ground  = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: 0x8a8474 }));
scene.add(ground);

// Ground grid
const gridGeo = new THREE.PlaneGeometry(G_SIZE, G_SIZE, 22, 22);
gridGeo.rotateX(-Math.PI / 2);
gridGeo.translate(0, 0.18, 0);
scene.add(new THREE.Mesh(gridGeo, new THREE.MeshBasicMaterial({
    color: 0x706858, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false,
})));

// ---- Road grid ----
const roadMat = new THREE.MeshLambertMaterial({ color: 0x585858 });
for (let i = -3; i <= 3; i++) {
    const rh = new THREE.Mesh(new THREE.PlaneGeometry(G_SIZE, 3.5), roadMat);
    rh.rotateX(-Math.PI / 2); rh.position.set(0, 0.12, i * 18);
    scene.add(rh);
    const rv = new THREE.Mesh(new THREE.PlaneGeometry(3.5, G_SIZE), roadMat);
    rv.rotateX(-Math.PI / 2); rv.position.set(i * 18, 0.12, 0);
    scene.add(rv);
}

// ---- Buildings ----
const buildings = [];
const BLOCK   = 18;
const bldMats = [
    new THREE.MeshLambertMaterial({ color: 0x7888a0 }),
    new THREE.MeshLambertMaterial({ color: 0x909080 }),
    new THREE.MeshLambertMaterial({ color: 0xa09070 }),
    new THREE.MeshLambertMaterial({ color: 0x6878a8 }),
    new THREE.MeshLambertMaterial({ color: 0x9888a0 }),
    new THREE.MeshLambertMaterial({ color: 0x808878 }),
];

const rng = (() => { let s = 42; return () => { s=(s*1664525+1013904223)>>>0; return s/4294967296; }; })(); // seeded rand

for (let bx = -3; bx <= 3; bx++) {
    for (let bz = -3; bz <= 3; bz++) {
        const cx = bx * BLOCK;
        const cz = bz * BLOCK;
        const n  = 1 + Math.floor(rng() * 3); // 1-3 buildings per block
        for (let k = 0; k < n; k++) {
            const px = cx + (rng() - 0.5) * 10;
            const pz = cz + (rng() - 0.5) * 10;
            if (Math.abs(px) < 3 && Math.abs(pz) < 3) continue; // skip near roads
            const h  = 4 + rng() * 24;
            const w  = 3 + rng() * 5;
            const d  = 3 + rng() * 5;
            const geo = new THREE.BoxGeometry(w, h, d);
            geo.translate(0, h / 2, 0); // pivot at base
            const mesh = new THREE.Mesh(geo, bldMats[Math.floor(rng() * bldMats.length)]);
            mesh.position.set(px, 0, pz);
            mesh.userData = {
                baseX: px, baseZ: pz, height: h,
                phase: rng() * Math.PI * 2,
                collapseAt: 5.5 + rng() * 3.0, // magnitude at which this building collapses
                collapsed: false,
            };
            scene.add(mesh);
            buildings.push(mesh);
        }
    }
}

// ---- Epicenter marker ----
const epiMarkerGeo = new THREE.CircleGeometry(3, 32);
epiMarkerGeo.rotateX(-Math.PI / 2);
const epiMarker = new THREE.Mesh(epiMarkerGeo, new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.85 }));
epiMarker.position.y = 0.3;
scene.add(epiMarker);

// Cross lines at epicenter
const crossMat = new THREE.LineBasicMaterial({ color: 0xff2200 });
const crossH = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6,0.4,0), new THREE.Vector3(6,0.4,0)]), crossMat);
const crossV = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0.4,-6), new THREE.Vector3(0,0.4,6)]), crossMat);
scene.add(crossH); scene.add(crossV);

// ---- Seismic wave rings ----
const P_SPEED      = 13;  // scene units/s (P-wave)
const S_SPEED      = 7.5; // scene units/s (S-wave)
const RING_COUNT   = 7;

function makeRings(color, count) {
    return Array.from({ length: count }, (_, i) => {
        const geo = new THREE.RingGeometry(1, 1.9, 72);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0,
            side: THREE.DoubleSide, depthWrite: false,
        }));
        mesh.userData.idx = i;
        mesh.position.y = 0.5;
        scene.add(mesh);
        return mesh;
    });
}

const pRings = makeRings(0x4499ee, RING_COUNT); // blue — P-wave
const sRings = makeRings(0xff5533, RING_COUNT); // red  — S-wave

// ---- Dust particles ----
const MAX_DUST = 300;
const dustPos  = new Float32Array(MAX_DUST * 3);
const dustVel  = new Float32Array(MAX_DUST * 3);
const dustAge  = new Float32Array(MAX_DUST).fill(1);
const dustLife = new Float32Array(MAX_DUST).fill(1);
for (let i = 0; i < MAX_DUST; i++) dustPos[i*3+1] = -9999;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 1.8, color: 0xc0b098, transparent: true, opacity: 0.7, sizeAttenuation: true,
})));

// ---- Sim state ----
let running = false;
let simTime = 0;
const params = { magnitude: 7.0, depth: 15, distance: 40, simSpeed: 1.0 };

function getEpiX() { return -params.distance * 0.42; }

// ---- Update epicenter marker ----
function updateEpiMarker() {
    const ex = getEpiX();
    epiMarker.position.x = ex;
    crossH.position.x    = ex;
    crossV.position.x    = ex;
}

// ---- Seismic wave rings ----
function updateRings(t) {
    const ex  = getEpiX();
    const gap = 1.8; // seconds between waves

    pRings.forEach((r, i) => {
        const rt = t - i * gap;
        if (rt <= 0) { r.material.opacity = 0; return; }
        const radius = rt * P_SPEED;
        r.scale.setScalar(radius);
        r.material.opacity = Math.max(0, (1 - radius / 180)) * 0.7;
        r.position.x = ex;
    });

    sRings.forEach((r, i) => {
        const rt = t - i * gap * 1.2;
        if (rt <= 0) { r.material.opacity = 0; return; }
        const radius = rt * S_SPEED;
        r.scale.setScalar(radius);
        r.material.opacity = Math.max(0, (1 - radius / 140)) * 0.65;
        r.position.x = ex;
    });
}

// ---- Ground shaking ----
function updateGround(t) {
    const ex   = getEpiX();
    const amp  = Math.pow(10, (params.magnitude - 4.5) * 0.45) * 0.06;
    const freq = 3.5 + params.magnitude * 0.35;

    for (let i = 0; i < gPos.count; i++) {
        const ox   = gOrig[i*3] - ex;
        const oz   = gOrig[i*3 + 2];
        const dist = Math.sqrt(ox*ox + oz*oz);

        const arrival = dist / S_SPEED;
        if (t < arrival) { gPos.setY(i, 0); continue; }

        const ts    = t - arrival;
        const atten = amp / (1 + dist * 0.03);
        const decay = Math.exp(-ts * 0.14);
        gPos.setY(i, atten * decay * Math.sin(ts * freq * Math.PI * 2 + ox * 0.08 + oz * 0.06));
    }
    gPos.needsUpdate = true;
    groundGeo.computeVertexNormals();
}

// ---- Building shaking + collapse ----
function spawnDust(x, z) {
    for (let n = 0; n < 12; n++) {
        const idx = dustAge.findIndex((a, i) => a >= dustLife[i]);
        if (idx < 0) return;
        const angle = Math.random() * Math.PI * 2;
        dustPos[idx*3]   = x + (Math.random()-0.5)*4;
        dustPos[idx*3+1] = 1;
        dustPos[idx*3+2] = z + (Math.random()-0.5)*4;
        dustVel[idx*3]   = Math.cos(angle)*(1+Math.random()*4);
        dustVel[idx*3+1] = 3 + Math.random()*6;
        dustVel[idx*3+2] = Math.sin(angle)*(1+Math.random()*4);
        dustLife[idx] = 2 + Math.random()*2;
        dustAge[idx]  = 0;
    }
}

function updateBuildings(t) {
    const ex   = getEpiX();
    const amp  = Math.pow(10, (params.magnitude - 4.5) * 0.45) * 0.06;
    const freq = 3.5 + params.magnitude * 0.35;

    buildings.forEach(b => {
        const dx   = b.userData.baseX - ex;
        const dz   = b.userData.baseZ;
        const dist = Math.sqrt(dx*dx + dz*dz);

        const arrival = dist / S_SPEED;
        if (t < arrival) return;

        const ts    = t - arrival;
        const atten = amp / (1 + dist * 0.025);
        const decay = Math.exp(-ts * 0.1);
        const shake = atten * decay * 0.18;
        const ph    = b.userData.phase;

        if (b.userData.collapsed) return;

        const sx = shake * Math.sin(ts * freq * Math.PI * 2 + ph);
        const sz = shake * Math.cos(ts * freq * Math.PI * 1.7 + ph + 1.1);

        b.position.x = b.userData.baseX + sx;
        b.position.z = b.userData.baseZ + sz;
        b.rotation.z =  sx * 0.002 / b.userData.height;
        b.rotation.x = -sz * 0.002 / b.userData.height;

        // Collapse: triggered by magnitude threshold + duration of shaking
        // Higher magnitude = collapses faster; buildings further away take longer
        const collapseTime = 2.5 + (b.userData.collapseAt - params.magnitude) * 2.5;
        if (params.magnitude >= b.userData.collapseAt && ts > collapseTime) {
            b.userData.collapsed = true;
            b.scale.y = 0.12;
            b.rotation.z = (Math.random()-0.5) * 1.0;
            b.rotation.x = (Math.random()-0.5) * 0.6;
            b.position.y = -(b.userData.height * 0.88 * 0.5);
            spawnDust(b.userData.baseX, b.userData.baseZ);
        }
    });
}

// ---- Dust update ----
function updateDust(dt) {
    for (let i = 0; i < MAX_DUST; i++) {
        if (dustAge[i] >= dustLife[i]) { dustPos[i*3+1] = -9999; continue; }
        dustAge[i]     += dt;
        dustVel[i*3+1] -= 4 * dt;
        dustPos[i*3]   += dustVel[i*3]   * dt;
        dustPos[i*3+1] += dustVel[i*3+1] * dt;
        dustPos[i*3+2] += dustVel[i*3+2] * dt;
        if (dustPos[i*3+1] < 0) { dustPos[i*3+1] = -9999; dustAge[i] = dustLife[i]; }
    }
    dustGeo.attributes.position.needsUpdate = true;
}

// ---- Status ----
function syncStatus() {
    const m   = params.magnitude;
    const pga = (Math.pow(10, (m - 4.5) * 0.72) * 0.018).toFixed(3);
    const mmi = Math.min(12, Math.max(1, Math.round(m * 1.3 - 1.5)));
    document.getElementById('pga').textContent = pga + ' g';
    document.getElementById('mmi').textContent = mmi + ' MMI';
}

// ---- Reset ----
function resetSim() {
    running  = false;
    simTime  = 0;
    document.getElementById('btn-start').textContent        = 'Mulai';
    document.getElementById('status-text').textContent      = 'Siap';
    document.getElementById('sim-time').textContent         = '0 s';

    buildings.forEach(b => {
        b.userData.collapsed = false;
        b.scale.y = 1;
        b.rotation.set(0, 0, 0);
        b.position.set(b.userData.baseX, 0, b.userData.baseZ);
    });

    for (let i = 0; i < gPos.count; i++) gPos.setY(i, 0);
    gPos.needsUpdate = true;

    for (let i = 0; i < MAX_DUST; i++) { dustAge[i] = 1; dustPos[i*3+1] = -9999; }
    dustGeo.attributes.position.needsUpdate = true;

    [...pRings, ...sRings].forEach(r => { r.scale.setScalar(0.001); r.material.opacity = 0; });

    updateEpiMarker();
}

// ---- Controls ----
function bindControls() {
    [
        { id: 'magnitude', key: 'magnitude', dec: 1 },
        { id: 'depth',     key: 'depth',     dec: 0 },
        { id: 'distance',  key: 'distance',  dec: 0 },
        { id: 'simspeed',  key: 'simSpeed',  dec: 1 },
    ].forEach(({ id, key, dec }) => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            document.getElementById('val-'+id).textContent = parseFloat(el.value).toFixed(dec);
            params[key] = parseFloat(el.value);
            updateEpiMarker();
            syncStatus();
        });
    });

    const btnStart = document.getElementById('btn-start');
    btnStart.addEventListener('click', () => {
        running = !running;
        btnStart.textContent = running ? 'Jeda' : 'Lanjut';
        document.getElementById('status-text').textContent = running ? 'Berjalan' : 'Dijeda';
    });

    document.getElementById('btn-reset').addEventListener('click', resetSim);
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

    const t = simTime;
    updateRings(t);
    updateGround(t);
    updateBuildings(t);
    updateDust(dt * params.simSpeed);
    controls.update();
    renderer.render(scene, camera);
}

// ---- Init ----
bindControls();
syncStatus();
updateEpiMarker();
onResize();
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
