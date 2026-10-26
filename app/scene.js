// Decision Terrain: a WebGL surface where every vertex is simulation output.
//   x = cap k (tasks per shared environment)   z = pairwise conflict probability   y = setup minutes saved
//   pearlescent = passes all guardrails (point estimate, 1,500 runs/cell)   graphite = fails
//   blush contour = conflict rate crosses the 2% limit; thin contours every 10% of savings.
import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const SX = 10, SZ = 7, SY = 4.4, SUB = 6;

const vert = /* glsl */`
attribute float aSave; attribute float aConf; attribute float aPass;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vSave; varying float vConf; varying float vPass;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz; vUv = uv;
  vSave = aSave; vConf = aConf; vPass = aPass;
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */`
uniform float uTime; uniform vec2 uGrid; uniform float uLimit;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vSave; varying float vConf; varying float vPass;
vec3 film(float t){ // cosine palette tuned to pearl -> blush -> violet -> ice
  return vec3(0.80,0.74,0.86) + vec3(0.20,0.20,0.16)*cos(6.28318*(vec3(1.0,1.0,1.0)*t + vec3(0.02,0.30,0.58)));
}
float aline(float v, float w){ float d = abs(fract(v - 0.5) - 0.5); return 1.0 - smoothstep(0.0, fwidth(v)*w, d); }
void main(){
  vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV), Ld = normalize(vec3(0.4,0.9,0.5));
  float fres = pow(1.0 - max(dot(N,V),0.0), 2.0);
  float diff = 0.35 + 0.65*max(dot(N,Ld),0.0);
  float spec = pow(max(dot(reflect(-Ld,N),V),0.0), 40.0);
  vec3 irid = film(fres*1.15 + vSave*0.9 + uTime*0.015);
  float pass = smoothstep(0.42,0.58,vPass);
  vec3 pearl = mix(vec3(0.93,0.90,0.95), irid, 0.55 + 0.4*fres) * diff + spec*0.55;
  vec3 graph = vec3(0.12,0.11,0.14)*diff + irid*0.10*fres + spec*0.18;
  vec3 col = mix(graph, pearl, pass);
  col = mix(col, vec3(1.0), 0.22*aline(vSave*10.0, 1.2));                      // savings contours (10%)
  col = mix(col, vec3(1.0), 0.16*max(aline(vUv.x*uGrid.x,1.0), aline(vUv.y*uGrid.y,1.0))); // sample grid
  float r = vConf/uLimit - 1.0;
  float lim = 1.0 - smoothstep(0.0, fwidth(vConf/uLimit)*1.8, abs(r));            // exactly one line, where conflict = 2%
  col = mix(col, vec3(0.97,0.58,0.72), lim);                                     // 2% conflict contour
  gl_FragColor = vec4(col, 1.0);
}`;

function catmull(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }
function sampleGrid(rows, key, fi, fj) {
  const nj = rows.length, ni = rows[0].length;
  const g = (i, j) => rows[Math.min(nj - 1, Math.max(0, j))][Math.min(ni - 1, Math.max(0, i))][key];
  const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j;
  const col = q => catmull(g(i - 1, q), g(i, q), g(i + 1, q), g(i + 2, q), ti);
  return catmull(col(j - 1), col(j), col(j + 1), col(j + 2), tj);
}
function label(text, size = 44, color = '#efe9f4') {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`; const w = Math.ceil(x.measureText(text).width) + 16;
  c.width = w; c.height = size + 16; x.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(w / c.height * 0.42, 0.42, 1); return s;
}

export class DecisionTerrain {
  constructor(canvas, { reducedMotion = false, onPick = () => {}, onHover = () => {} } = {}) {
    this.canvas = canvas; this.reduced = reducedMotion; this.onPick = onPick; this.onHover = onHover;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2 unavailable');
    r.setPixelRatio(Math.min(1.75, devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r); this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(4, 10, 17);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 9, maxDistance: 32, maxPolarAngle: Math.PI * 0.47, enablePan: false });
    this.controls.target.set(0, 1.2, 0);
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => { this.userMoved = true; });
    this.uniforms = { uTime: { value: 0 }, uGrid: { value: new THREE.Vector2(7, 12) }, uLimit: { value: 0.02 } };
    this.group = new THREE.Group(); this.scene.add(this.group);
    this._floor();
    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520], envMapIntensity: 2.2, clearcoat: 1 });
    const key = new THREE.DirectionalLight(0xfff1f6, 2.2); key.position.set(4, 10, 6); this.scene.add(key, new THREE.AmbientLight(0x8877aa, 0.6));
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.28, 48, 32), chrome); this.scene.add(this.marker);
    this.stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xf4b6c8 }));
    this.scene.add(this.stem);
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    this.data = null; this.sel = { i: 3, j: 2 }; this.frameTimes = []; this.visible = true; this.dirty = true; this.lastActive = performance.now(); this.renders = 0;
    this._bind(); this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.requestRender(); }).observe(canvas);
    this.t0 = performance.now(); this.intro = this.reduced ? 1 : 0; this.camera.position.copy(this._home());
    this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }
  _floor() {
    const g = new THREE.GridHelper(SX + 2, 12, 0x3a3444, 0x221f29); g.position.y = -0.01; this.scene.add(g);
    const a = label('cap k →', 40); a.position.set(SX / 2 + 0.3, 0.05, SZ / 2 + 1.0); this.scene.add(a);
    const b = label('pair conflict ↗', 40); b.position.set(SX / 2 + 1.2, 0.05, -SZ / 2 - 0.9); this.scene.add(b);
    const c = label('setup minutes saved ↑', 40); c.position.set(-SX / 2, SY * 0.95, -SZ / 2 - 0.3); this.scene.add(c);
    this.ticks = new THREE.Group(); this.scene.add(this.ticks);
  }
  _bind() {
    const c = this.canvas;
    c.addEventListener('pointermove', e => { this.requestRender(); const s = this._hit(e); this.onHover(s, e); c.style.cursor = s ? 'crosshair' : 'grab'; });
    c.addEventListener('pointerleave', () => this.onHover(null));
    let down = null;
    c.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    c.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const s = this._hit(e); if (s) { this.sel = { i: s.i, j: s.j }; this.onPick(s); } } down = null; });
    c.addEventListener('keydown', e => {
      if (!this.data) return; const map = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const d = map[e.key]; if (!d) return; e.preventDefault();
      const ni = this.data.rows[0].length, nj = this.data.rows.length;
      this.sel = { i: Math.min(ni - 1, Math.max(0, this.sel.i + d[0])), j: Math.min(nj - 1, Math.max(0, this.sel.j + d[1])) };
      this.onPick(this._cell(this.sel.i, this.sel.j));
    });
  }
  _cell(i, j) { const c = this.data.rows[j][i]; return { ...c, i, j }; }
  _hit(e) {
    if (!this.mesh) return null; const r = this.canvas.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera); const h = this.ray.intersectObject(this.mesh)[0]; if (!h) return null;
    const ni = this.data.rows[0].length, nj = this.data.rows.length;
    const i = Math.round((h.point.x + SX / 2) / SX * (ni - 1)), j = Math.round((h.point.z + SZ / 2) / SZ * (nj - 1));
    return this._cell(Math.min(ni - 1, Math.max(0, i)), Math.min(nj - 1, Math.max(0, j)));
  }
  pos(fi, fj) { const ni = this.data.rows[0].length, nj = this.data.rows.length; return [fi / (ni - 1) * SX - SX / 2, Math.max(0, sampleGrid(this.data.rows, 'savings', fi, fj)) / 0.8 * SY, fj / (nj - 1) * SZ - SZ / 2]; }
  setData(data, sel) {
    this.data = data; const ni = data.rows[0].length, nj = data.rows.length;
    const gx = (ni - 1) * SUB + 1, gz = (nj - 1) * SUB + 1, n = gx * gz;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), aS = new Float32Array(n), aC = new Float32Array(n), aP = new Float32Array(n), idx = [];
    for (let z = 0; z < gz; z++) for (let x = 0; x < gx; x++) {
      const v = z * gx + x, fi = x / SUB, fj = z / SUB, s = Math.max(0, sampleGrid(data.rows, 'savings', fi, fj));
      pos.set([fi / (ni - 1) * SX - SX / 2, s / 0.8 * SY, fj / (nj - 1) * SZ - SZ / 2], v * 3);
      uv.set([fi / (ni - 1), fj / (nj - 1)], v * 2);
      aS[v] = s; aC[v] = Math.max(0, sampleGrid(data.rows, 'conflict', fi, fj)); aP[v] = Math.min(1, Math.max(0, sampleGrid(data.rows, 'pass', fi, fj)));
      if (x < gx - 1 && z < gz - 1) idx.push(v, v + gx, v + 1, v + 1, v + gx, v + gx + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSave', new THREE.BufferAttribute(aS, 1)); geo.setAttribute('aConf', new THREE.BufferAttribute(aC, 1)); geo.setAttribute('aPass', new THREE.BufferAttribute(aP, 1));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.uniforms.uGrid.value.set(ni - 1, nj - 1);
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(geo, this.mat || (this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.DoubleSide })));
    this.group.add(this.mesh);
    // tick labels
    this.ticks.clear();
    for (let i = 0; i < ni; i += ni > 10 ? 3 : 1) { const s = label(String(i + 1), 40, '#a39cae'); s.position.set(i / (ni - 1) * SX - SX / 2, 0.05, SZ / 2 + 0.55); this.ticks.add(s); }
    data.pGrid.forEach((p, j) => { if (j % 4) return; const s = label((p * 100).toFixed(0) + '%', 40, '#a39cae'); s.position.set(SX / 2 + 0.75, 0.05, j / (nj - 1) * SZ - SZ / 2); this.ticks.add(s); });
    if (sel) this.sel = sel; this.select(this.sel.i, this.sel.j);
  }
  select(i, j) {
    if (!this.data) return; this.sel = { i, j }; const [x, y, z] = this.pos(i, j);
    this.marker.position.set(x, y + 0.32, z);
    this.stem.geometry.setFromPoints([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, y + 0.05, z)]);
    this.requestRender();
  }
  requestRender() { this.dirty = true; this.lastActive = performance.now(); }
  _home() {
    if (this.wide) return new THREE.Vector3(2.6, 11.5, 19.5);
    const a = this.camera.aspect || 1; // portrait screens: closer, steeper camera so the terrain fills the frame
    return a < 1 ? new THREE.Vector3(3.2, 10.5, 12) : new THREE.Vector3(5, 11, 16);
  }
  _resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1; // the canvas box, not the stage (panel stacks above it on phones)
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.wide = w >= 900;
    this.camera.fov = w < 600 ? 56 : 34; this.camera.updateProjectionMatrix();
    // on wide screens the control panel covers the left third: frame the terrain in the remaining space
    this.controls.target.set(this.wide ? -2.3 : 0, 1.3, this.wide ? 0.2 : 0);
    if (this.intro >= 1 && !this.userMoved) this.camera.position.copy(this._home());
    this.requestRender();
  }
  _loop(now) {
    requestAnimationFrame(this._loop);
    if (!this.visible) return;
    if (this.intro < 1) {
      this.intro = Math.min(1, (now - this.t0) / 1800); const e = 1 - Math.pow(1 - this.intro, 3);
      const home = this._home(); this.camera.position.set(home.x + 14 * (1 - e), home.y + 6 * (1 - e), home.z + 10 * (1 - e)); this.dirty = true;
    }
    // render on demand: the shimmer animates only for 5 s after the last interaction or data change (saves GPU/battery)
    if (!this.reduced && now - this.lastActive < 5000) { this.uniforms.uTime.value = now / 1000; this.dirty = true; }
    const moved = this.controls.update();
    if (!this.dirty && !moved) return;
    const t = performance.now(); this.renderer.render(this.scene, this.camera); this.dirty = false; this.renders++;
    // adaptive quality: drop resolution if frames are slow
    this.frameTimes.push(performance.now() - t); if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length === 90 && this.renderer.getPixelRatio() > 1) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / 90;
      if (avg > 14) { this.renderer.setPixelRatio(1); this._resize(); this.frameTimes = []; }
    }
    this.lastRenderMs = performance.now() - t;
  }
}
