import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Gyro } from './vr.js';
import { Ambience } from './audio.js';
import { Book } from './book.js';

const $ = id => document.getElementById(id);
const KEY = 'vr-mountains-settings';
const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const S = Object.assign({ quality: mobile ? 'medium' : 'high', ipd: 63, fov: 80, speed: 4, muted: false, fps: false }, (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
})());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const QUALITY = {
  low: { pr: 1, grid: 256, trees: 5000, rocks: 150, reflect: 256, oct: 3, lowq: true },
  medium: { pr: 1.5, grid: 360, trees: 10000, rocks: 300, reflect: 512, oct: 4, lowq: false },
  high: { pr: 2, grid: 460, trees: 16000, rocks: 450, reflect: 1024, oct: 5, lowq: false },
};
const Q = QUALITY[S.quality] || QUALITY.medium;

// ---------- renderer, cameras ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const maxPR = Math.min(devicePixelRatio, Q.pr);
let pr = maxPR;
renderer.setPixelRatio(pr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const head = new THREE.Object3D();
scene.add(head);
const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 20000);
const eyeL = new THREE.PerspectiveCamera(S.fov, 1, 0.5, 20000), eyeR = eyeL.clone();
head.add(cam, eyeL, eyeR);
const book = new Book(scene);

const gyro = new Gyro();
const audio = new Ambience(S.muted);
let world = null, mode = 'menu';             // 'menu' | 'play' | 'vr'
let yaw = 0, pitch = 0, yawOffset = 0, needCenter = true, walkHeld = false, drag = null, frame = 0, tapAt = 0, holdTimer = 0;
const keys = {}, pos = new THREE.Vector3(), qG = new THREE.Quaternion(), qYaw = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3(), eu = new THREE.Euler();
const yawOf = q => eu.setFromQuaternion(q, 'YXZ').y;

// ---------- build the world (after the loading text has painted) ----------
$('status').textContent = 'Building the landscape…';
setTimeout(() => {
  world = buildWorld(scene, renderer, Q);
  pos.set(world.start.x, 0, world.start.z);
  head.position.set(pos.x, world.groundHeight(pos.x, pos.z) + 1.7, pos.z);
  yaw = world.start.yaw;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  $('status').textContent = secure ? '' : 'Heads up: phone motion sensors only work over https (e.g. GitHub Pages).';
  document.querySelectorAll('#menu button').forEach(b => b.disabled = false);
  renderer.setAnimationLoop(loop);
  book.restore().then(ok => ok && bookStatus()).catch(() => {});
  if (location.hash === "#play" || location.hash === "#vr") start(location.hash === "#vr");   // shortcut for testing
}, 30);

// ---------- menu / settings ----------
function toast(msg, ms = 5000) {
  const ts = [$("toast"), $("toast2")];
  ts.forEach(t => { t.textContent = msg; t.classList.add("show"); });
  clearTimeout(toast.h); toast.h = setTimeout(() => ts.forEach(t => t.classList.remove("show")), ms);
}
async function start(vr) {
  const perm = gyro.request();               // must happen inside the tap (iOS)
  audio.start();
  try { navigator.wakeLock?.request('screen')?.catch(() => {}); } catch (e) {}
  if (vr) { const el = document.documentElement; try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {}); } catch (e) {} }
  mode = vr ? 'vr' : 'play';
  document.body.className = mode;
  $('menu').hidden = $('settings').hidden = true;
  $('hud').hidden = false;
  needCenter = true;
  onResize();
  toast(vr ? 'Hold a finger on the screen to walk where you look. Two-finger tap: face the lake.'
           : mobile ? 'Look around by moving your phone (or drag). Hold Walk to move.' : 'Drag to look. WASD / arrows to walk, Shift to run.');
  const ok = await perm;
  if (!ok && mobile) toast(vr ? 'Motion access not granted, so head tracking is off. See README for how to reset it.' : 'No motion access, so drag to look around.', 7000);
}
function toMenu() {
  if (gyro.active) { yaw = yawOf(head.quaternion); pitch = 0; }
  mode = 'menu';
  document.body.className = '';
  walkHeld = false;
  $('hud').hidden = true; $('menu').hidden = false;
  try { document.fullscreenElement && document.exitFullscreen(); } catch (e) {}
  onResize();
}
// ---------- book ----------
function bookStatus() { $('bookName').textContent = '📖 ' + book.name + ' (' + book.pdf.numPages + ' pages, on page ' + book.focus + ')'; }
$('bookFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $('bookName').textContent = 'Opening ' + f.name + '…';
  try { await book.load(f); bookStatus(); } catch (err) { $('bookName').textContent = "Couldn't open that PDF."; }
  e.target.value = '';
};
function toggleBook() {
  if (!book.loaded) { toast('Load a book from the menu first.'); return; }
  if (book.isOpen) { book.close(); document.body.classList.remove('reading'); return; }
  book.open(yawOf(head.quaternion)); document.body.classList.add('reading');
  toast(mode === 'vr' ? 'Tap: next page (look at the left page + tap to go back). Two-finger tap: zoom. Hold: walk.' : 'Use ◀ ▶ to turn pages and 🔍 to zoom in.');
}
const zoomBook = () => book.setZoom(!book.zoom, yawOf(head.quaternion));
$('bookBtn').onclick = toggleBook;
$('pagePrev').onclick = () => book.turnPage(-1);
$('pageNext').onclick = () => book.turnPage(1);
$('pageZoom').onclick = zoomBook;
function setMuted(m) { S.muted = m; save(); audio.setMuted(m); $('mute').textContent = m ? '🔇' : '🔊'; $('setMute').checked = m; }

$('play').onclick = () => start(false);
$('vr').onclick = () => start(true);
$('exit').onclick = toMenu;
$('mute').onclick = () => setMuted(!S.muted);
$('openSettings').onclick = () => { $('menu').hidden = true; $('settings').hidden = false; };
$('back').onclick = () => { $('settings').hidden = true; $('menu').hidden = false; };
$('setQuality').value = S.quality;
$('setQuality').onchange = e => { S.quality = e.target.value; save(); location.reload(); };
$('setMute').checked = S.muted;
$('setMute').onchange = e => setMuted(e.target.checked);
$('setFps').checked = S.fps;
$('setFps').onchange = e => { S.fps = e.target.checked; save(); $('fps').hidden = !S.fps; };
$('fps').hidden = !S.fps;
for (const [id, k, unit] of [['setSpeed', 'speed', ' m/s'], ['setIpd', 'ipd', ' mm'], ['setFov', 'fov', '°']]) {
  const el = $(id), out = $(id + 'Val');
  el.value = S[k]; out.textContent = S[k] + unit;
  el.oninput = () => { S[k] = +el.value; out.textContent = el.value + unit; save(); };
}
$('mute').textContent = S.muted ? '🔇' : '🔊';

// ---------- input ----------
const cv = renderer.domElement;
function look(dx, dy) {
  const k = 0.005;
  if (gyro.active && mode !== 'menu') yawOffset += dx * k;
  else { yaw += dx * k; pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * k)); }
}
function faceLake() {
  const target = Math.atan2(pos.x, pos.z);
  if (gyro.read(qG)) yawOffset = target - yawOf(qG); else { yaw = target; pitch = 0; }
}
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  if (mode === 'menu') return;
  if (e.touches.length >= 2) { clearTimeout(holdTimer); tapAt = 0; walkHeld = false; drag = null; book.isOpen ? zoomBook() : faceLake(); return; }
  const t = e.touches[0];
  if (mode === 'vr' && book.isOpen) { tapAt = performance.now(); holdTimer = setTimeout(() => { walkHeld = true; tapAt = 0; }, 300); }
  else if (mode === 'vr') walkHeld = true; else drag = { x: t.clientX, y: t.clientY };
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!drag) return;
  const t = e.touches[0]; look(t.clientX - drag.x, t.clientY - drag.y); drag = { x: t.clientX, y: t.clientY };
}, { passive: false });
cv.addEventListener('touchend', e => {
  if (e.touches.length) return;
  clearTimeout(holdTimer);
  if (tapAt && book.isOpen) book.turnPage(book.lookSide(head) < (book.zoom ? -0.35 : -0.02) ? -1 : 1);   // quick tap in VR = turn page
  tapAt = 0; walkHeld = false; drag = null;
});
cv.addEventListener('mousedown', e => { if (mode !== 'menu') drag = { x: e.clientX, y: e.clientY }; });
addEventListener('mousemove', e => { if (drag && !e.touches) { look(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; } });
addEventListener('mouseup', () => { drag = null; });
const walkBtn = $('walk');
for (const [ev, v] of [['touchstart', true], ['touchend', false], ['touchcancel', false], ['mousedown', true], ['mouseup', false], ['mouseleave', false]]) {
  walkBtn.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); walkHeld = v; }, { passive: false });
}
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' && mode !== 'menu') toMenu();
  if (e.code === 'KeyM') setMuted(!S.muted);
  if (mode !== 'menu' && e.code === 'KeyB') toggleBook();
  if (book.isOpen && e.code === 'KeyZ') zoomBook();
  if (book.isOpen && e.code === 'BracketRight') book.turnPage(1);
  if (book.isOpen && e.code === 'BracketLeft') book.turnPage(-1);
});
addEventListener('keyup', e => { keys[e.code] = false; });

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 300));

// ---------- per-frame ----------
function updateLook(dt) {
  if (mode === 'menu') { yaw += dt * 0.03; head.quaternion.setFromEuler(eu.set(-0.02, yaw, 0, 'YXZ')); return; }
  if (gyro.read(qG)) {
    if (needCenter) { yawOffset = yaw - yawOf(qG); needCenter = false; }
    head.quaternion.copy(qYaw.setFromAxisAngle(Y, yawOffset)).multiply(qG);
  } else head.quaternion.setFromEuler(eu.set(pitch, yaw, 0, 'YXZ'));
}
const canStand = (x, z) => Math.hypot(x, z) < 4500 && world.groundHeight(x, z) > -0.6;
function move(dt) {
  if (mode === 'menu') return;
  let f = walkHeld ? 1 : 0, s = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyA || keys.ArrowLeft) s -= 1;
  if (keys.KeyD || keys.ArrowRight) s += 1;
  fwd.set(0, 0, -1).applyQuaternion(head.quaternion); fwd.y = 0; fwd.normalize();
  right.set(-fwd.z, 0, fwd.x);
  tmp.copy(fwd).multiplyScalar(f).addScaledVector(right, s);
  if (tmp.lengthSq() > 0) {
    tmp.normalize().multiplyScalar(S.speed * (keys.ShiftLeft || keys.ShiftRight ? 2.5 : 1) * dt);
    if (canStand(pos.x + tmp.x, pos.z)) pos.x += tmp.x;       // axis-by-axis so you slide along the shore
    if (canStand(pos.x, pos.z + tmp.z)) pos.z += tmp.z;
  }
  const ground = Math.max(world.groundHeight(pos.x, pos.z), -0.6);
  head.position.x = pos.x; head.position.z = pos.z;
  head.position.y += (ground + 1.7 - head.position.y) * Math.min(1, dt * 10);
}
function updateAudio(dt) {
  let best = 1e9, bp = null;
  for (const p of world.fallSound) { const d = p.distanceTo(head.position); if (d < best) { best = d; bp = p; } }
  tmp.copy(bp).sub(head.position).applyQuaternion(qG.copy(head.quaternion).invert());
  const ground = world.groundHeight(pos.x, pos.z);
  audio.update(dt, { alt: head.position.y, shore: Math.abs(ground), fallDist: best, fallPan: tmp.x / (tmp.length() || 1) });
}
function render() {
  const w = innerWidth, h = innerHeight;
  if (mode === 'vr') {
    const half = w / 2, ipd = S.ipd / 1000;
    renderer.setScissorTest(true);
    for (const [c, side, x] of [[eyeL, -1, 0], [eyeR, 1, half]]) {
      c.position.set(side * ipd / 2, 0, 0);
      c.fov = S.fov; c.aspect = half / h; c.updateProjectionMatrix();
      renderer.setViewport(x, 0, half, h); renderer.setScissor(x, 0, half, h);
      renderer.render(scene, c);
    }
    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, w, h);
    renderer.render(scene, cam);
  }
}

// dynamic resolution: drop pixel ratio if the phone can't hold ~40 fps, raise it back when there's headroom
let acc = 0, cnt = 0, last = performance.now();
function perf(dt) {
  acc += dt; cnt++;
  if (acc < 2) return;
  const avg = acc / cnt;
  if (avg > 1 / 40 && pr > 0.6) { pr = Math.max(0.6, pr * 0.85); renderer.setPixelRatio(pr); }
  else if (avg < 1 / 55 && pr < maxPR) { pr = Math.min(maxPR, pr * 1.08); renderer.setPixelRatio(pr); }
  if (S.fps) $('fps').textContent = Math.round(1 / avg) + ' fps · ' + pr.toFixed(2) + 'x';
  acc = cnt = 0;
}
function loop() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now; frame++;
  updateLook(dt);
  move(dt);
  world.update(dt, head.position, frame);
  book.update(dt, head.position);
  updateAudio(dt);
  render();
  perf(dt);
}
