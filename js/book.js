// A readable 3D book made from a PDF the player picks on their own device (nothing is uploaded).
// PDF.js draws each page to a canvas, which becomes a texture on the book's pages.
import * as THREE from 'three';

const TEXW = 1400;                     // page texture width in pixels
const PAGE_H = 0.34;                   // book page height in metres (held ~0.75 m away)
const BIG_W = 1.5;                     // zoomed page width (floats ~1.1 m away)
const KEEP = 8;                        // pages kept in memory around the current one

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
// tiny IndexedDB store so the last book survives a reload
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vr-mountains-books', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbPut(k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function dbGet(k) { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('files').objectStore('files').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const ease = t => t * t * (3 - 2 * t);

export class Book {
  constructor(scene) {
    this.pdf = null; this.name = ''; this.focus = 1; this.isOpen = false; this.zoom = false;
    this.cache = new Map(); this.turn = null; this.yaw = 0; this.crop = { x: 0, y: 0, w: 1, h: 1 };
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xf4eedf, toneMapped: false, fog: false });
    const plane = () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat());

    this.rig = new THREE.Group(); this.rig.visible = false; scene.add(this.rig);
    this.book = new THREE.Group(); this.book.position.set(0, -0.42, -0.62); this.book.rotation.x = -0.75; this.rig.add(this.book);
    this.left = plane(); this.right = plane(); this.book.add(this.left, this.right);
    this.cover = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x5a1e1a }));
    this.stack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xe8e0cc }));
    this.book.add(this.cover, this.stack);
    // the page that flips over, hinged on the spine
    this.pivot = new THREE.Group(); this.pivot.visible = false; this.book.add(this.pivot);
    this.front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), mat());
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).translate(0.5, 0, 0), mat());
    this.pivot.add(this.front, this.back);
    this.big = plane(); this.big.position.set(0, 0, -1.1); this.big.visible = false; this.rig.add(this.big);
    this.blank = null;
  }

  get loaded() { return !!this.pdf; }

  async load(file, remember = true) {
    if (!window.pdfjsLib) {
      await loadScript('lib/pdfjs/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';
    }
    const data = new Uint8Array(await file.arrayBuffer());
    if (remember) dbPut('last', { name: file.name, blob: new Blob([data], { type: 'application/pdf' }) }).catch(() => {});
    this.cache.forEach(p => p.then(t => t && t.dispose()));
    this.cache.clear();
    this.pdf = await pdfjsLib.getDocument({ data }).promise;
    this.name = file.name.replace(/\.pdf$/i, '');
    this.focus = Math.min(this.pdf.numPages, +(localStorage.getItem('vr-book-page:' + this.name) || 1));
    await this.findCrop();
    this.layout();
    return this.pdf.numPages;
  }
  async restore() {
    const rec = await dbGet('last').catch(() => null);
    if (!rec) return false;
    await this.load(new File([rec.blob], rec.name), false);
    return true;
  }

  // Trim the white margins: union of the inked area over some middle pages, so text fills the page.
  async findCrop() {
    const n = this.pdf.numPages, from = n > 20 ? 10 : 1, to = Math.min(n, from + 5);
    const v1 = (await this.pdf.getPage(1)).getViewport({ scale: 1 }); this.pdfAspect = v1.width / v1.height;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = from; i <= to; i++) {
      const page = await this.pdf.getPage(i), vp = page.getViewport({ scale: 0.4 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        const k = (y * c.width + x) * 4;
        if (d[k] + d[k + 1] + d[k + 2] < 600) {
          x0 = Math.min(x0, x / c.width); x1 = Math.max(x1, x / c.width);
          y0 = Math.min(y0, y / c.height); y1 = Math.max(y1, y / c.height);
        }
      }
    }
    if (x1 <= x0 || y1 <= y0) { this.crop = { x: 0, y: 0, w: 1, h: 1 }; return; }
    const p = 0.03;
    x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(1, x1 + p); y1 = Math.min(1, y1 + p);
    this.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  layout() {
    const vp = this.pdfAspect || 0.707, a = vp * this.crop.w / this.crop.h, W = PAGE_H * a;
    this.left.scale.set(W, PAGE_H, 1); this.left.position.set(-W / 2 - 0.002, 0, 0.004);
    this.right.scale.set(W, PAGE_H, 1); this.right.position.set(W / 2 + 0.002, 0, 0.004);
    this.cover.scale.set(W * 2 + 0.02, PAGE_H + 0.016, 0.004); this.cover.position.z = -0.006;
    this.stack.scale.set(W * 2, PAGE_H, 0.006); this.stack.position.z = -0.0005;
    this.front.scale.set(W, PAGE_H, 1); this.back.scale.set(W, PAGE_H, 1); this.pivot.position.z = 0.005;
    this.big.scale.set(BIG_W, BIG_W / a, 1);
    this.W = W;
  }

  tex(n) {
    if (!this.pdf || n < 1 || n > this.pdf.numPages) return Promise.resolve(null);
    if (this.cache.has(n)) return this.cache.get(n);
    const p = (async () => {
      const page = await this.pdf.getPage(n), v1 = page.getViewport({ scale: 1 });
      if (!this.pdfAspect) { this.pdfAspect = v1.width / v1.height; this.layout(); }
      const vp = page.getViewport({ scale: TEXW / (v1.width * this.crop.w) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width * this.crop.w); c.height = Math.round(vp.height * this.crop.h);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -vp.width * this.crop.x, -vp.height * this.crop.y] }).promise;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return t;
    })();
    this.cache.set(n, p);
    for (const [k, q] of this.cache) if (Math.abs(k - this.focus) > KEEP) { q.then(t => t && t.dispose()); this.cache.delete(k); }
    return p;
  }
  async setMap(mesh, n) {
    const t = await this.tex(n);
    mesh.material.map = t; mesh.material.needsUpdate = true;
  }
  // spread k shows pages 2k (left) and 2k+1 (right); page 1 sits alone on the right like a real book
  show() {
    const k = Math.floor(this.focus / 2);
    this.setMap(this.left, 2 * k); this.setMap(this.right, 2 * k + 1); this.setMap(this.big, this.focus);
    for (let i = 1; i <= 4; i++) this.tex(this.focus + i);
    try { localStorage.setItem('vr-book-page:' + this.name, this.focus); } catch (e) {}
  }

  open(yaw) { if (!this.pdf) return; this.isOpen = true; this.yaw = yaw; this.rig.visible = true; this.show(); this.setZoom(this.zoom); }
  close() { this.isOpen = false; this.rig.visible = false; }
  setZoom(z, yaw) {
    this.zoom = z; if (yaw !== undefined) this.yaw = yaw;
    this.book.visible = !z; this.big.visible = z;
  }

  // dir: +1 next, -1 previous
  turnPage(dir) {
    if (!this.pdf || this.turn) return;
    const n = this.pdf.numPages;
    if (this.zoom) { this.focus = Math.max(1, Math.min(n, this.focus + dir)); this.show(); return; }
    const k = Math.floor(this.focus / 2), nk = k + dir;
    if (nk < 0 || 2 * nk > n) return;
    // flipping page: front = page leaving, back = page arriving; reveal the page underneath straight away
    if (dir > 0) { this.setMap(this.front, 2 * k + 1); this.setMap(this.back, 2 * nk); this.setMap(this.right, 2 * nk + 1); }
    else { this.setMap(this.front, 2 * k - 1); this.setMap(this.back, 2 * k); this.setMap(this.left, 2 * nk); }
    this.turn = { t: 0, dir, nk };
    this.pivot.visible = true;
    this.pivot.rotation.y = dir > 0 ? 0 : -Math.PI;
  }

  update(dt, headPos) {
    if (!this.isOpen) return;
    this.rig.position.copy(headPos);
    this.rig.rotation.y = this.yaw;
    if (this.turn) {
      const tr = this.turn; tr.t = Math.min(1, tr.t + dt / 0.45);
      this.pivot.rotation.y = -Math.PI * (tr.dir > 0 ? ease(tr.t) : 1 - ease(tr.t));
      if (tr.t >= 1) {
        this.turn = null; this.pivot.visible = false;
        this.focus = Math.max(1, 2 * tr.nk + (tr.nk === 0 ? 1 : 0));
        this.show();
      }
    }
  }

  // which way the player is looking relative to the book: < 0 means the left page
  lookSide(head) {
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    return v.x;
  }
}
