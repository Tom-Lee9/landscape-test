// Builds the landscape: terrain, lake, forest, boulders, waterfalls, sky and clouds.
import * as THREE from 'three';
import { Water } from 'three/addons/Water.js';
import { Sky } from 'three/addons/Sky.js';
import { mergeGeometries, mergeVertices } from 'three/addons/BufferGeometryUtils.js';

// ---------- seeded random + 2D simplex noise ----------
let seed = 1337;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const perm = new Uint8Array(512);
{ const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const GR = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
function noise(x, y) {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0, q, g;
  q = 0.5 - x0 * x0 - y0 * y0; if (q > 0) { g = GR[perm[ii + perm[jj]] & 7]; q *= q; n += q * q * (g[0] * x0 + g[1] * y0); }
  q = 0.5 - x1 * x1 - y1 * y1; if (q > 0) { g = GR[perm[ii + i1 + perm[jj + j1]] & 7]; q *= q; n += q * q * (g[0] * x1 + g[1] * y1); }
  q = 0.5 - x2 * x2 - y2 * y2; if (q > 0) { g = GR[perm[ii + 1 + perm[jj + 1]] & 7]; q *= q; n += q * q * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
function fbm(x, y, oct = 4) {
  let a = 1, f = 1, s = 0, nm = 0;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; nm += a; a *= 0.5; f *= 2.03; }
  return s / nm;
}
function ridged(x, y) {
  let a = 1, f = 1, s = 0, w = 1, nm = 0;
  for (let i = 0; i < 5; i++) {
    let n = 1 - Math.abs(noise(x * f, y * f)); n *= n * w;
    w = Math.min(1, n * 1.6); s += n * a; nm += a; a *= 0.5; f *= 2.1;
  }
  return s / nm;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- height field (water level = 0, lake centred on the origin) ----------
export const LAKE = { rx: 520, rz: 380 };
export function height(x, z) {
  const d = Math.hypot(x / LAKE.rx, z / LAKE.rz) + fbm(x * 0.0025 + 5, z * 0.0025, 3) * 0.22;
  // valley opening to the south (-z), dropping away into the distance
  const v = Math.exp(-((x / (160 + Math.max(0, -z) * 0.28)) ** 2)) * sstep(-450, -1000, z);
  let h = d < 1 ? -30 * sstep(1, 0.3, d) : (d - 1) * 30 * (1 - 0.75 * v);
  const m = sstep(1.25, 3.2, d) * (1 - 0.9 * v);
  if (m > 0) {
    const r = ridged(x / 1900 + 11, z / 1900 - 7);
    let mh = 80 + 560 * r * r + 380 * Math.max(0, fbm(x / 2400, z / 2400, 3) + 0.35) + sstep(3, 7, d) * 350;
    const t = 70, f = mh / t, i = Math.floor(f);          // terraces -> rocky cliff bands
    mh = mh * 0.45 + (i + sstep(0.25, 0.75, f - i)) * t * 0.55;
    h += m * mh;
  }
  h -= v * sstep(-900, -4000, z) * 170;
  h += fbm(x / 90, z / 90, 3) * (d < 1 ? 1 : Math.min(3.5, 1 + (d - 1) * 10));
  return h;
}

// Terrain grid is denser near the lake: x = S * sign(u) * |u|^P
const S = 6000, P = 2;
let N = 256, grid = null;
const warp = i => { const u = i / N * 2 - 1; return S * Math.sign(u) * Math.abs(u) ** P; };
const unwarp = x => (Math.sign(x) * (Math.min(Math.abs(x), S) / S) ** (1 / P) + 1) / 2 * N;
// Height of the rendered mesh (matches the triangles exactly, so feet/trees sit on the ground)
export function groundHeight(x, z) {
  const i = Math.min(N - 1, Math.floor(unwarp(x))), j = Math.min(N - 1, Math.floor(unwarp(z)));
  const x0 = warp(i), z0 = warp(j), fx = (x - x0) / (warp(i + 1) - x0), fz = (z - z0) / (warp(j + 1) - z0);
  const n = N + 1, a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i], d = grid[(j + 1) * n + i + 1];
  return fx + fz <= 1 ? a + fx * (b - a) + fz * (c - a) : d + (1 - fx) * (c - d) + (1 - fz) * (b - d);
}
const slopeAt = (x, z) => Math.hypot(height(x + 2, z) - height(x - 2, z), height(x, z + 2) - height(x, z - 2)) / 4;

function terrainGeometry() {
  const n = N + 1, pos = new Float32Array(n * n * 3);
  grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = warp(i), z = warp(j), h = height(x, z), k = j * n + i;
    grid[k] = h; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// ---------- shaders ----------
const NOISE_GLSL = `
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
vec3 applyFog(vec3 c, float dist, vec3 fogCol, float dens){ float f=1.0-exp(-dist*dist*dens*dens); return mix(c,fogCol,f); }
`;
const TERRAIN_VS = `
varying vec3 vW; varying vec3 vN;
void main(){ vN=normal; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const TERRAIN_FS = `
uniform sampler2D tGrass,tRock,tRockN,tSnow,tGround;
uniform vec3 sunDir,sunCol,skyAmb,gndAmb,fogCol,deepCol;
uniform float fogDensity,time;
varying vec3 vW; varying vec3 vN;
${NOISE_GLSL}
vec3 tile(sampler2D t, vec2 p){
  vec3 a=texture2D(t,p).rgb;
#ifndef LOWQ
  a=mix(a, texture2D(t,p*0.21+vec2(0.37,0.71)).rgb, 0.4);   // second scale hides tiling
#endif
  return a; }
float caustic(vec2 p){ p*=0.35;
  float c=sin(p.x*1.3+time*1.1+sin(p.y*0.9+time*0.7)*1.5)+sin(p.y*1.7-time*0.9+sin(p.x*1.1-time*0.5)*1.5);
  return pow(clamp(1.0-abs(c)*0.6,0.0,1.0),4.0); }
void main(){
  vec3 n=normalize(vN); float h=vW.y; vec2 p=vW.xz;
  float dist=length(vW-cameraPosition);
  float macro=smoothstep(0.2,0.75,vnoise(p*0.004)*0.6+vnoise(p*0.017)*0.4);
  float slope=1.0-n.y;
  vec3 grass=tile(tGrass,p*0.06);
  vec3 ground=tile(tGround,p*0.22);
  vec3 snow=texture2D(tSnow,p*0.12).rgb;
  vec3 bw=pow(abs(n),vec3(4.0)); bw/=dot(bw,vec3(1.0));
  const float rs=0.045;
  vec3 rock=texture2D(tRock,vW.zy*rs).rgb*bw.x+texture2D(tRock,vW.xz*rs).rgb*bw.y+texture2D(tRock,vW.xy*rs).rgb*bw.z;
  float wRock=max(smoothstep(0.24,0.42,slope+(macro-0.5)*0.12), smoothstep(330.0,520.0,h+macro*80.0)*0.85);
  float wSnow=smoothstep(560.0,680.0,h+macro*140.0-slope*220.0);
  float wShore=1.0-smoothstep(0.2,1.4,h+macro*0.8);
  rock=mix(vec3(dot(rock,vec3(0.3,0.5,0.2))),rock,0.35)*vec3(0.95,0.97,1.0);
  grass=mix(grass,grass*vec3(0.62,1.0,0.42)*1.25,0.85);
  vec3 col=mix(grass, ground, clamp(macro*0.3+wShore,0.0,1.0)*0.85);
  col=mix(col,rock,wRock);
  col=mix(col,snow*1.1,wSnow);
#ifndef LOWQ
  if(wRock>0.02){   // whiteout-blended triplanar normal map on rock
    vec3 tx=texture2D(tRockN,vW.zy*rs).xyz*2.0-1.0, ty=texture2D(tRockN,vW.xz*rs).xyz*2.0-1.0, tz=texture2D(tRockN,vW.xy*rs).xyz*2.0-1.0;
    tx=vec3(tx.xy+n.zy,abs(tx.z)*n.x); ty=vec3(ty.xy+n.xz,abs(ty.z)*n.y); tz=vec3(tz.xy+n.xy,abs(tz.z)*n.z);
    vec3 rn=normalize(tx.zyx*bw.x+ty.xzy*bw.y+tz.xyz*bw.z);
    n=normalize(mix(n,rn,wRock*(1.0-wSnow)*0.9));
  }
#endif
  float diff=max(dot(n,sunDir),0.0);
  vec3 amb=mix(gndAmb,skyAmb,n.y*0.5+0.5)*(1.0-slope*0.35);
  vec3 c=col*(sunCol*diff+amb);
  if(h<0.0 && length(p/vec2(520.0,380.0))<1.6){       // lake bed: caustics + depth tint
    float dep=-h;
    c+=col*sunCol*caustic(p)*0.6*exp(-dep*0.12);
    c=mix(c,deepCol,1.0-exp(-dep*0.11));
  }
  float sunAmt=pow(max(dot(normalize(vW-cameraPosition),sunDir),0.0),6.0);
  vec3 fc=fogCol+sunCol*0.12*sunAmt;
  float mist=0.35*exp(-max(h,0.0)/70.0)*(1.0-exp(-dist/1800.0));   // low valley haze
  c=applyFog(c,dist,fc,fogDensity);
  c=mix(c,fc,mist);
  gl_FragColor=vec4(c,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const CLOUD_FS = `
uniform float time; uniform vec3 sunDir,fogCol; uniform float bright;
varying vec3 vW;
${NOISE_GLSL}
float cfbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<OCT;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
void main(){
  vec2 p=vW.xz/2200.0+vec2(time*0.006,time*0.003);
  float n=cfbm(p);
  float cov=smoothstep(0.42,0.75,n);
  float lit=clamp(0.55+(n-cfbm(p+sunDir.xz*0.06))*4.0,0.35,1.0);
  vec3 col=mix(vec3(0.55,0.6,0.7),vec3(1.0,0.97,0.92),lit)*bright;
  float d=length(vW.xz-cameraPosition.xz);
  col=mix(col,fogCol*1.6,smoothstep(2000.0,11000.0,d));
  gl_FragColor=vec4(col,cov*(1.0-smoothstep(7000.0,13000.0,d))*0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const FALL_VS = `
attribute float steep; varying vec2 vUv; varying float vSteep; varying vec3 vW;
void main(){ vUv=uv; vSteep=steep; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const FALL_FS = `
uniform float time; uniform vec3 fogCol,sunCol; uniform float fogDensity;
varying vec2 vUv; varying float vSteep; varying vec3 vW;
${NOISE_GLSL}
void main(){
  float sp=2.0+vSteep*7.0;
  float n=vnoise(vec2(vUv.x*9.0,vUv.y*3.0-time*sp))*0.6+vnoise(vec2(vUv.x*23.0,vUv.y*8.0-time*sp*1.6))*0.4;
  float edge=smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x);
  float foam=clamp(smoothstep(0.35,0.8,n)*0.8+vSteep*0.5,0.0,1.0);
  vec3 col=mix(vec3(0.08,0.16,0.17),vec3(0.95),foam)*(sunCol*0.25+0.35);
  col=applyFog(col,length(vW-cameraPosition),fogCol,fogDensity);
  gl_FragColor=vec4(col,edge*(0.45+0.55*foam));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- trees ----------
function paint(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) c.set(fn(p.getX(k), p.getY(k), p.getZ(k)), k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function pineGeometry(hi) {
  const top = 20, parts = [];
  if (hi) {
    parts.push(paint(new THREE.CylinderGeometry(0.15, 0.35, 6, 5, 1, true).translate(0, 3, 0), () => [0.06, 0.04, 0.03]));
    const tiers = 6, seg = 10;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, y0 = 2.2 + t * (top - 4.5), r = (1 - t) * 3.6 + 0.5, hgt = (top - 2) / tiers * 2.1;
      const c = new THREE.ConeGeometry(r, hgt, seg, 2, true).translate(0, y0 + hgt / 2, 0);
      const p = c.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const rel = (p.getY(k) - y0) / hgt;
        if (rel < 0.6) {                 // ragged, drooping branch tips (deterministic by angle, so no seams)
          const a = Math.atan2(p.getZ(k), p.getX(k)), s = 0.8 + 0.45 * (0.5 + 0.5 * Math.sin(a * 5 + i * 1.7));
          p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s);
          if (rel < 0.01) p.setY(k, p.getY(k) - 0.35 * r * s);
        }
      }
      c.computeVertexNormals();
      parts.push(paint(c, (x, y) => { const k = 0.45 + 0.55 * Math.min(1, (y - y0) / hgt); return [0.035 * k, 0.075 * k, 0.04 * k]; }));
    }
  } else {
    parts.push(paint(new THREE.ConeGeometry(3.6, top - 1.5, 6, 1, true).translate(0, (top - 1.5) / 2 + 1.5, 0), (x, y) => {
      const k = 0.45 + 0.4 * y / top; return [0.03 * k, 0.065 * k, 0.035 * k]; }));
  }
  return mergeGeometries(parts);
}

function makeTreeCells(scene, count) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const hiG = pineGeometry(true), loG = pineGeometry(false);
  const cells = new Map(), CELL = 600;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  for (let tries = 0; tries < count * 15 && placed < count; tries++) {
    const r = 4200 * Math.pow(rand(), 0.75), a = rand() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = height(x, z);
    if (h < 4 || h > 400 + noise(x / 300, z / 300) * 60) continue;
    if (slopeAt(x, z) > 0.8) continue;
    const forest = noise(x / 700, z / 700) * 0.6 + noise(x / 170, z / 170) * 0.4;
    if (forest < -0.1 + h / 420 * 0.45 + (Math.hypot(x / LAKE.rx, z / LAKE.rz) < 1.2 ? 0.12 : 0)) continue;
    const s = 0.55 + rand() * 0.75;
    ps.set(x, groundHeight(x, z) - 0.3, z);
    q.setFromAxisAngle(up, rand() * 6.28);
    sc.set(s * (0.85 + rand() * 0.3), s, s * (0.85 + rand() * 0.3));
    const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!cells.has(key)) cells.set(key, { mats: [], cols: [], c: new THREE.Vector3((Math.floor(x / CELL) + 0.5) * CELL, 0, (Math.floor(z / CELL) + 0.5) * CELL) });
    const cell = cells.get(key);
    cell.mats.push(m.compose(ps, q, sc).clone());
    const v = 0.8 + rand() * 0.45;
    cell.cols.push(new THREE.Color(v * (0.9 + rand() * 0.2), v, v * (0.85 + rand() * 0.25)));
    placed++;
  }
  const list = [];
  for (const cell of cells.values()) {
    const make = g => {
      const im = new THREE.InstancedMesh(g, mat, cell.mats.length);
      cell.mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cell.cols[i]); });
      im.computeBoundingSphere(); scene.add(im); return im;
    };
    cell.c.y = 0;
    list.push({ c: cell.c, hi: make(hiG), lo: make(loG) });
  }
  return list;
}

// ---------- boulders ----------
function makeRocks(scene, count, T) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('normal'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const r = 1 + 0.22 * noise(x * 1.7 + y, z * 1.7 - y * 0.9) + 0.08 * noise(x * 4.1 + 9, z * 4.3 + y * 3.1);
    p.setXYZ(k, x * r, y * r * 0.65, z * r);
  }
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, roughness: 0.92, color: 0xa8a39b, envMapIntensity: 0.6 });
  const im = new THREE.InstancedMesh(g, mat, count);
  const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(), ps = new THREE.Vector3();
  let n = 0;
  for (let tries = 0; tries < count * 20 && n < count; tries++) {
    const r = 1500 * Math.sqrt(rand()), a = rand() * 6.28, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = groundHeight(x, z);
    if (h < -4 || h > 200 || (Math.abs(x) < 20 && z > 300 && z < 520)) continue;
    const sz = 0.4 + Math.pow(rand(), 3) * (h < 3 ? 2.5 : 6);
    ps.set(x, h - sz * 0.25, z);
    q.setFromEuler(e.set(rand() * 0.4, rand() * 6.28, rand() * 0.4));
    s.set(sz * (0.8 + rand() * 0.5), sz, sz * (0.8 + rand() * 0.5));
    im.setMatrixAt(n++, m.compose(ps, q, s));
  }
  im.count = n; im.computeBoundingSphere();
  scene.add(im);
}

// ---------- waterfalls ----------
function makeFall(angle, mat) {
  let x = Math.cos(angle) * LAKE.rx * 2.6, z = Math.sin(angle) * LAKE.rz * 2.6;
  let dx = -Math.cos(angle), dz = -Math.sin(angle);
  const pts = [];
  for (let s = 0; s < 600; s++) {
    const h = groundHeight(x, z);
    pts.push(new THREE.Vector3(x, h, z));
    if (h < -0.5) break;
    const gx = (height(x + 3, z) - height(x - 3, z)) / 6, gz = (height(x, z + 3) - height(x, z - 3)) / 6;
    const gl = Math.hypot(gx, gz) + 1e-6, r = Math.hypot(x, z);
    let nx = dx * 0.55 + (-gx / gl * 0.6 - x / r * 0.4) * 0.45, nz = dz * 0.55 + (-gz / gl * 0.6 - z / r * 0.4) * 0.45;
    const nl = Math.hypot(nx, nz); dx = nx / nl; dz = nz / nl;
    x += dx * 4; z += dz * 4;
  }
  const pos = [], uv = [], steep = [], idx = [];
  let len = 0;
  pts.forEach((pt, i) => {
    const nx = pts[Math.min(i + 1, pts.length - 1)], pv = pts[Math.max(i - 1, 0)];
    let ux = nx.x - pv.x, uz = nx.z - pv.z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const w = Math.min(9, 4 + i * 0.03);
    const drop = i < pts.length - 1 ? Math.max(0, pt.y - pts[i + 1].y) : 0;
    if (i) len += pt.distanceTo(pts[i - 1]);
    for (const sd of [-1, 1]) {
      const sx = pt.x - uz * w * sd, sz = pt.z + ux * w * sd;
      pos.push(sx, Math.max(groundHeight(sx, sz), pt.y) + 0.6, sz);
      uv.push(sd < 0 ? 0 : 1, len / 12);
      steep.push(Math.min(1, drop / 5));
    }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('steep', new THREE.Float32BufferAttribute(steep, 1));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  // spray points where the water drops hardest + where it enters the lake
  const spots = pts.filter((p, i) => i < pts.length - 1 && p.y - pts[i + 1].y > 3.5).filter((p, i) => i % 3 === 0);
  spots.push(pts[pts.length - 1]);
  return { mesh, pts, spots };
}
function mistTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- assemble ----------
export function buildWorld(scene, renderer, Q) {
  N = Q.grid;
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (f, srgb = true) => {
    const t = loader.load('textures/' + f);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const T = { grass: tex('grass.jpg'), rock: tex('rock.jpg'), rockN: tex('rock_nor.jpg', false), snow: tex('snow.jpg'), ground: tex('ground.jpg'), water: tex('waternormals.jpg', false) };

  // sun, sky, environment light
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 21), THREE.MathUtils.degToRad(250));
  const sky = new Sky(); sky.scale.setScalar(15000); sky.renderOrder = -10;
  const su = sky.material.uniforms;
  su.turbidity.value = 3; su.rayleigh.value = 1.1; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.86;
  su.sunPosition.value.copy(sun);
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
  envScene.add(sky); scene.environment = pm.fromScene(envScene).texture; pm.dispose();
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xa9bccf, 0.00024);
  const sunCol = new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(3.0);
  const dl = new THREE.DirectionalLight(0xffeedd, 3.0 * Math.PI); dl.position.copy(sun); scene.add(dl);
  scene.add(new THREE.HemisphereLight(0x9db6dc, 0x3a3328, 0.75 * Math.PI));

  // terrain
  const terrainMat = new THREE.ShaderMaterial({
    defines: Q.lowq ? { LOWQ: 1 } : {},
    uniforms: {
      tGrass: { value: T.grass }, tRock: { value: T.rock }, tRockN: { value: T.rockN }, tSnow: { value: T.snow }, tGround: { value: T.ground },
      sunDir: { value: sun }, sunCol: { value: sunCol }, skyAmb: { value: new THREE.Color(0.42, 0.52, 0.72) }, gndAmb: { value: new THREE.Color(0.14, 0.12, 0.1) },
      fogCol: { value: scene.fog.color }, fogDensity: { value: scene.fog.density }, deepCol: { value: new THREE.Color(0.012, 0.05, 0.055) }, time: { value: 0 },
    },
    vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
  });
  const terrain = new THREE.Mesh(terrainGeometry(), terrainMat);
  terrain.frustumCulled = false;
  scene.add(terrain);

  // lake: three.js Water (live reflections), patched so shallow/steep views see through to the bed
  const water = new Water(new THREE.PlaneGeometry(1800, 1450), {
    textureWidth: Q.reflect, textureHeight: Q.reflect, waterNormals: T.water,
    sunDirection: sun.clone(), sunColor: 0xfff4e0, waterColor: 0x0e3d3f, distortionScale: 1.4, fog: true,
  });
  water.material.fragmentShader = water.material.fragmentShader.replace(
    'gl_FragColor = vec4( outgoingLight, alpha );',
    'gl_FragColor = vec4( outgoingLight, clamp( 0.35 + reflectance * 2.2, 0.0, 1.0 ) );');
  water.material.transparent = true;
  water.material.uniforms.size.value = 2.5;
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  let waterFrame = -1, frameNo = 0;
  const waterPre = water.onBeforeRender;   // in VR, update the reflection once per frame (shared by both eyes)
  water.onBeforeRender = (r, s, c) => { if (waterFrame !== frameNo) { waterFrame = frameNo; waterPre(r, s, c); } };

  const trees = makeTreeCells(scene, Q.trees);
  makeRocks(scene, Q.rocks, T);

  // waterfalls
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, fogCol: { value: scene.fog.color }, fogDensity: { value: scene.fog.density }, sunCol: { value: sunCol } },
    vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const falls = [-0.4, -2.7, -1.0, 0.5].map(a => makeFall(a, fallMat));
  falls.forEach(f => scene.add(f.mesh));
  const sprayPts = falls.flatMap(f => f.spots.flatMap(s => Array.from({ length: 6 }, () => [s.x + (rand() - 0.5) * 10, s.y + rand() * 10, s.z + (rand() - 0.5) * 10, s.y])));
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.Float32BufferAttribute(sprayPts.flatMap(p => p.slice(0, 3)), 3));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ map: mistTexture(), size: 16, transparent: true, opacity: 0.22, depthWrite: false, color: 0xe8f0f2 }));
  spray.frustumCulled = false;
  scene.add(spray);

  // clouds
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
    defines: { OCT: Q.oct },
    uniforms: { time: { value: 0 }, sunDir: { value: sun }, fogCol: { value: scene.fog.color }, bright: { value: 2.2 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  clouds.position.y = 2300; clouds.renderOrder = -1; clouds.frustumCulled = false;
  scene.add(clouds);

  // start on the north shore, looking south across the lake to the valley
  let sz = LAKE.rz * 0.8;
  while (groundHeight(0, sz) < 1 && sz < 1500) sz += 2;
  const start = { x: 0, z: sz + 12, yaw: 0 };

  const fallSound = falls.flatMap(f => f.pts.filter((p, i) => i % 10 === 0));
  let lod = 0, t = 0;
  return {
    start, groundHeight, fallSound,
    update(dt, pos, frame) {
      frameNo = frame; t += dt;
      terrainMat.uniforms.time.value = t;
      water.material.uniforms.time.value = t * 0.35;
      fallMat.uniforms.time.value = t;
      clouds.material.uniforms.time.value = t;
      sky.position.copy(pos);
      clouds.position.x = pos.x; clouds.position.z = pos.z;
      const sp = sprayGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        let y = sp.getY(i) + dt * 2.2;
        if (y > sprayPts[i][3] + 14) y = sprayPts[i][3];
        sp.setY(i, y);
      }
      sp.needsUpdate = true;
      if ((lod -= dt) <= 0) {
        lod = 0.4;
        for (const c of trees) { const near = Math.hypot(c.c.x - pos.x, c.c.z - pos.z) < 950; c.hi.visible = near; c.lo.visible = !near; }
      }
    },
  };
}
