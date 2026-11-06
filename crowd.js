// =====================================================
//  Seyirciler, tribünler ve dekor (kral locası, heykeller, sancaklar, meşaleler)
//  Seyirciler KayKit karakterleridir (kahramanlar + iskeletler). Performans için:
//   - Animasyonlu SkinnedMesh YOK. Her model tipi açılışta 3 pozda (Idle / Tezahürat / "Ooh" sarsılma) CPU'da
//     "pişirilir" (iskelet o poza getirilir, her köşe dönüştürülür), SimplifyModifier ile sadeleştirilir ve statik
//     geometriye çevrilir. Pozlar aynı topolojiyi paylaşır: 2. ve 3. poz köşe özniteliği (aPosB/aPosC) olarak tutulur.
//   - Tip × dilim başına tek InstancedMesh. Poz geçişi, zıplama, sallanma vertex shader'da (instance başına faz).
//   - Dekor (kral locası, direkler, kaideler) tribün taşlarıyla aynı kutu InstancedMesh'ine eklenir (ek çizim yok).
// =====================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

const TAU = Math.PI * 2;
// Kaliteye göre seyirci sayısı, boşta sallanma ve kullanılan model tipi sayısı (her tip = dilim başına 1 çizim)
const CROWD_Q = {
  dusuk:  { count: 120, idle: 0, types: 2, verts: 520 },
  orta:   { count: 300, idle: 1, types: 4, verts: 750 },
  yuksek: { count: 520, idle: 1, types: 6, verts: 900 },
};
const MAX_COUNT = CROWD_Q.yuksek.count;
const PSECT = 3;   // seyirci dilimi sayısı (ekran dışı dilimler çizilmez)

// Seyirci model tipleri (G anahtarı). Sıra önemli: düşük kalite ilk N tipi kullanır; kahraman/iskelet karışık.
const TYPES = [
  { key: 'knight', skel: false }, { key: 'minion', skel: true }, { key: 'barbarian', skel: false },
  { key: 'warrior', skel: true }, { key: 'heroMage', skel: false }, { key: 'heroRogue', skel: false },
];
const SPEC_H = 1.25;            // seyirci boyu (dünya birimi)
const SIM_URL = 'assets/kaykit/animations/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_Simulation.glb';
const TINTS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0x16a085, 0xd35400, 0xecf0f1, 0xe84393, 0x6c5ce7];
const BANNER_COLS = [0xb02a2a, 0xd4a017, 0x5b2c83, 0x1f6f4a, 0x22508f];

// Sancak dokusu: beyaz kumaş + koyu kafatası, alt ucu çatallı (alphaTest)
function bannerTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 0); g.lineTo(64, 96); g.lineTo(32, 76); g.lineTo(0, 96); g.closePath(); g.fill();
  g.fillStyle = '#e8d9a8'; g.fillRect(0, 0, 64, 6);                 // üst şerit
  g.fillStyle = '#2a2020';
  g.beginPath(); g.arc(32, 36, 15, 0, TAU); g.fill();                 // kafatası
  g.fillRect(24, 44, 16, 12);
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(26, 35, 4.5, 0, TAU); g.arc(38, 35, 4.5, 0, TAU); g.fill();
  g.fillRect(27, 50, 3, 6); g.fillRect(34, 50, 3, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------------
//  Poz pişirme
// ---------------------------------------------------------------------------------------------------
const _v = new THREE.Vector3();

// Modelin (aynı doku atlasını kullanan) tüm ağlarını topla: iskinli + kemiğe bağlı sert parçalar (miğfer, şapka...)
function collectParts(root) {
  const skinned = [], rigid = [];
  root.traverse(o => { if (o.isMesh && o.geometry.attributes.uv) (o.isSkinnedMesh ? skinned : rigid).push(o); });
  const prim = (skinned.find(m => m.material.map) || rigid.find(m => m.material.map))?.material.map;
  return { parts: [...skinned, ...rigid].filter(m => m.material.map === prim), map: prim };
}

// Kökü verilen klip/zamanda poza getir ve tüm köşe konumlarını (kök uzayında) döndür
function samplePose(root, parts, mixer, clip, t) {
  if (clip) { mixer.stopAllAction(); mixer.clipAction(clip).reset().play(); mixer.setTime(t); }
  root.updateMatrixWorld(true);
  let total = 0; for (const m of parts) total += m.geometry.attributes.position.count;
  const out = new Float32Array(total * 3); let o = 0;
  for (const m of parts) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (m.isSkinnedMesh) m.applyBoneTransform(i, _v);
      _v.applyMatrix4(m.matrixWorld);
      out[o++] = _v.x; out[o++] = _v.y; out[o++] = _v.z;
    }
  }
  return out;
}

// Tezahürat karesi: klipte ellerin en yüksekte olduğu an
function bestCheerTime(root, parts, mixer, clip) {
  const hl = root.getObjectByName('handl'), hr = root.getObjectByName('handr');
  if (!hl || !hr || !clip) return clip ? clip.duration * 0.3 : 0;
  let best = 0, bestY = -Infinity;
  for (let i = 0; i < 24; i++) {
    const t = clip.duration * i / 24;
    mixer.stopAllAction(); mixer.clipAction(clip).reset().play(); mixer.setTime(t); root.updateMatrixWorld(true);
    const y = hl.getWorldPosition(_v).y + hr.getWorldPosition(new THREE.Vector3()).y;
    if (y > bestY) { bestY = y; best = t; }
  }
  return best;
}

// Bir model tipini pişir: { geo (position=poz A, aPosB, aPosC, normal, uv, index), map }
// poses: [{clip, t}] (en fazla 3). keepVerts: sadeleştirme sonrası hedef köşe sayısı. height: dünya boyu.
function bakeModel(scene, extra, poses, { keepVerts = 900, height = SPEC_H } = {}) {
  const root = SkeletonUtils.clone(scene);
  if (extra) for (const [bone, obj] of extra) { const b = root.getObjectByName(bone); if (b) b.add(obj.clone()); }
  const { parts, map } = collectParts(root);
  const mixer = new THREE.AnimationMixer(root);
  const tB = poses[1]?.t === 'cheer' ? bestCheerTime(root, parts, mixer, poses[1].clip) : poses[1]?.t;
  const A = samplePose(root, parts, mixer, poses[0].clip, poses[0].t);
  const B = poses[1] ? samplePose(root, parts, mixer, poses[1].clip, tB) : A;
  const C = poses[2] ? samplePose(root, parts, mixer, poses[2].clip, poses[2].t) : A;
  // Birleşik, indeksli ve normalli idle geometrisi
  let n = 0; for (const m of parts) n += m.geometry.attributes.position.count;
  const uv = new Float32Array(n * 2), idx = []; let vo = 0;
  for (const m of parts) {
    const g = m.geometry, c = g.attributes.position.count;
    uv.set(g.attributes.uv.array.subarray(0, c * 2), vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + vo);
    else for (let i = 0; i < c; i++) idx.push(i + vo);
    vo += c;
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(A, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Anahtar → özgün köşe (poz B/C'yi sadeleştirilmiş köşelere eşlemek için; SimplifyModifier köşeleri taşımaz, sadece siler)
  const key = (x, y, z, u, v) => x + ',' + y + ',' + z + ',' + u + ',' + v;
  const lookup = new Map();
  for (let i = 0; i < n; i++) { const k = key(A[i * 3], A[i * 3 + 1], A[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]); if (!lookup.has(k)) lookup.set(k, i); }
  geo = mergeVertices(geo);
  const cnt = geo.attributes.position.count;
  if (cnt > keepVerts) geo = new SimplifyModifier().modify(geo, cnt - keepVerts);
  // Kullanılmayan köşeleri at, B/C konumlarını eşle, boyu normalize et
  const P = geo.attributes.position, U = geo.attributes.uv, N = geo.attributes.normal, I = geo.index.array;
  const remap = new Int32Array(P.count).fill(-1); let m2 = 0;
  for (let i = 0; i < I.length; i++) if (remap[I[i]] < 0) remap[I[i]] = m2++;
  const pa = new Float32Array(m2 * 3), pb = new Float32Array(m2 * 3), pc = new Float32Array(m2 * 3), nn = new Float32Array(m2 * 3), uu = new Float32Array(m2 * 2);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < P.count; i++) {
    const j = remap[i]; if (j < 0) continue;
    const o = lookup.get(key(P.getX(i), P.getY(i), P.getZ(i), U.getX(i), U.getY(i)));
    pa.set([P.getX(i), P.getY(i), P.getZ(i)], j * 3);
    pb.set(o !== undefined ? [B[o * 3], B[o * 3 + 1], B[o * 3 + 2]] : [P.getX(i), P.getY(i), P.getZ(i)], j * 3);
    pc.set(o !== undefined ? [C[o * 3], C[o * 3 + 1], C[o * 3 + 2]] : [P.getX(i), P.getY(i), P.getZ(i)], j * 3);
    nn.set([N.getX(i), N.getY(i), N.getZ(i)], j * 3);
    uu.set([U.getX(i), U.getY(i)], j * 2);
    minY = Math.min(minY, P.getY(i)); maxY = Math.max(maxY, P.getY(i));
  }
  const s = height / Math.max(0.01, maxY - minY);
  for (const arr of [pa, pb, pc]) for (let i = 0; i < arr.length; i++) arr[i] *= s;
  const idx2 = new Uint16Array(I.length); for (let i = 0; i < I.length; i++) idx2[i] = remap[I[i]];
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  out.setAttribute('aPosB', new THREE.BufferAttribute(pb, 3));
  out.setAttribute('aPosC', new THREE.BufferAttribute(pc, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uu, 2));
  out.setIndex(new THREE.BufferAttribute(idx2, 1));
  out.computeBoundingSphere();
  out.userData.scale = s; out.userData.minY = minY * s; out.userData.tris = idx2.length / 3;
  return { geo: out, map, root, parts };
}

const tick = () => new Promise(r => setTimeout(r, 40));

export function createCrowd(scene, opts = {}) {
  const wallR = opts.wallR ?? 19.2;
  // Kapı yerlerinde boşluk: gates.js koridorları düz (sabit yanal genişlik) olduğundan boşluk açısal değil yanal
  // mesafeyle hesaplanır. opts.gates: [{ a (radyan), hw (açıklık yarı genişliği) }]; yoksa 4 ana yön, ~8 derece.
  const gaps = (opts.gates ?? [0, 1, 2, 3].map(k => ({ a: k * Math.PI / 2, hw: 1.4 })))
    .map(g => ({ a: g.a, clear: g.hw + 0.8 + 0.2 }));   // +0.8: koridor yan duvarı kalınlığı
  const ROWS = 5, R0 = wallR + 1.4, ROW_D = 0.95, Y0 = 1.0, ROW_H = 0.5;
  const rowR = k => R0 + k * ROW_D, rowY = k => Y0 + k * ROW_H;
  const backR = rowR(ROWS - 1) + ROW_D / 2 + 0.25, backH = rowY(ROWS - 1) + 1.2;
  // Kamera sabit bir yönden (CAM_OFFSET) baktığı için kameraya yakın taraftaki tribün alçaltılır ve arka duvarı
  // kaldırılır; yoksa arka duvarın dış yüzü ekranın altında koca bir bant olur ve seyircileri gizler.
  const camA = opts.camAngle ?? Math.PI / 4;
  const nearF = a => THREE.MathUtils.clamp((Math.cos(a - camA) - 0.15) / 0.6, 0, 1);
  const hasBack = a => Math.cos(a - camA) < 0.3;
  const rowYa = (k, a) => { const n = nearF(a); return Y0 * (1 - 0.35 * n) + k * ROW_H * (1 - 0.6 * n); };
  const angDist = (a, b) => Math.abs(((a - b) % TAU + TAU + Math.PI) % TAU - Math.PI);
  // a açısında, rIn yarıçapından başlayıp ±halfAng açısal genişlikte bir parça kapı koridoruna değiyor mu?
  const inGap = (a, rIn, halfAng = 0) => gaps.some(g => {
    const d = angDist(a, g.a) - halfAng;
    return d < Math.PI / 2 && rIn * Math.sin(Math.max(0, d)) < g.clear;
  });
  // Yerel tribün koordinatı → dünya: a açısı, lat (teğet yönünde), rad (dışa doğru yarıçap)
  const wpos = (a, lat, rad) => ({ x: Math.cos(a) * rad + Math.sin(a) * lat, z: Math.sin(a) * rad - Math.cos(a) * lat });

  const group = new THREE.Group();
  group.name = 'seyirciler';
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  // Kendi saatimiz (oyun dondurulsa da kalabalık canlı kalsın)
  const U = { uTime: { value: 0 }, uCheer: { value: 0 }, uWaveT: { value: 0 }, uOoh: { value: 0 }, uIdle: { value: 1 } };

  // ---------- Tribün basamakları + arka duvar + direkler + geçit duvarları ----------
  const SEGS = 120, segA = TAU / SEGS, SECTORS = 12;
  const stoneM = [];
  const addBox = (x, y, z, ry, sx, sy, sz, hex) => stoneM.push({ x, y, z, ry, sx, sy, sz, hex });
  const STONE = [0x5d554c, 0x6a6157, 0x625a50, 0x70675c, 0x5a5249];
  const poles = [];   // sancak direklerinin tepeleri { a, r, y }
  for (let i = 0; i < SEGS; i++) {
    const a = (i + 0.5) * segA, ry = -a + Math.PI / 2, n = nearF(a), wall = hasBack(a);
    for (let k = 0; k < ROWS; k++) {
      const r = rowR(k);
      if (inGap(a, r - ROW_D / 2, segA * 0.5)) continue;
      // Fazla boyamayı (overdraw) azaltmak için ara basamaklar yerden değil, bir alttaki basamağın üstünden başlar
      const full = k === 0 || (k === ROWS - 1 && !wall);
      const y0 = full ? 0 : rowYa(k - 1, a) - 0.05;
      addBox(Math.cos(a) * r, y0, Math.sin(a) * r, ry, TAU * (r + ROW_D / 2) / SEGS + 0.04, rowYa(k, a) - y0, ROW_D + 0.02, STONE[k]);
    }
    if (inGap(a, (wall ? backR : rowR(ROWS - 1)) - 0.5, segA * 0.5)) continue;
    if (wall) addBox(Math.cos(a) * backR, 0, Math.sin(a) * backR, ry, TAU * backR / SEGS + 0.04, backH, 0.5, 0x4e463e);
    // Sancak direkleri (her 4 segmentte bir): arka duvarın üstünde ya da (kamera tarafında) son basamağın arkasında
    if (i % 4 === 1) {
      const pr = wall ? backR : rowR(ROWS - 1) + ROW_D / 2 - 0.12, py = wall ? backH : rowYa(ROWS - 1, a);
      const ph = wall ? 1.7 : 1.5 - n * 0.3;
      addBox(Math.cos(a) * pr, py, Math.sin(a) * pr, ry, 0.08, ph, 0.08, 0x3a2c22);
      poles.push({ a, r: pr, y: py + ph - 0.02, i });
    }
  }
  // Kapı koridoru boyunca tribünü kapatan düz yan duvarlar (koridorun dış yüzüne yaslanır)
  const tIn = R0 - ROW_D / 2 - 0.05;
  const gateWalls = [];   // dekor için: { g, s, top, tOut }
  for (const g of gaps) for (const s of [-1, 1]) {
    const wall = hasBack(g.a), tOut = wall ? backR + 0.25 : rowR(ROWS - 1) + ROW_D / 2;
    const ux = Math.cos(g.a), uz = Math.sin(g.a), tx = Math.sin(g.a), tz = -Math.cos(g.a), lat = s * (g.clear + 0.45), mid = (tIn + tOut) / 2;
    const top = wall ? backH + 0.3 : rowYa(ROWS - 1, g.a) + 0.35;
    addBox(ux * mid + tx * lat, 0, uz * mid + tz * lat, -g.a, tOut - tIn, top, 1.0, 0x766c60);
    gateWalls.push({ g, s, top, tOut, lat });
  }

  // ---------- Dekor: kapı yanlarına heykel kaidesi + sancak direği ----------
  const flames = [];   // meşale alevleri (dünya konumu)
  const extraFlags = [];
  const statues = [];  // { x, y, z, ry }
  for (const w of gateWalls) {
    const { g, top, tOut, lat } = w;
    // heykel kaidesi duvarın arena tarafı ucunda
    const rs = tIn + 0.75, p = wpos(g.a, lat, rs);
    addBox(p.x, top, p.z, -g.a, 0.95, 0.35, 0.95, 0x8a8174);
    statues.push({ x: p.x, y: top + 0.35, z: p.z, ry: Math.atan2(-Math.cos(g.a), -Math.sin(g.a)) });
    // sancak direği duvarın dış ucunda; tepesinde meşale
    const rp = tOut - 1.3, q = wpos(g.a, lat, rp);
    addBox(q.x, top, q.z, -g.a, 0.12, 2.6, 0.12, 0x3a2c22);
    extraFlags.push({ a: Math.atan2(q.z, q.x), r: Math.hypot(q.x, q.z), y: top + 2.55, flap: 1, s: 1.15, hex: BANNER_COLS[(Math.round(g.a * 2 / Math.PI) + (w.s > 0 ? 1 : 3)) % BANNER_COLS.length] });
  }

  // ---------- Kral locası (kameranın karşı tarafındaki tribünün ortası) ----------
  const aK = camA + Math.PI, ryK = -aK + Math.PI / 2;
  const BOX_HW = 3.3;   // loca yarı genişliği (yanal)
  const dRear = backR - 0.55, dFront = rowR(2) - 0.5, dTop = rowY(3) + 0.1;
  const placeK = (lat, rad, y, sx, sy, sz, hex) => { const p = wpos(aK, lat, rad); addBox(p.x, y, p.z, ryK, sx, sy, sz, hex); };
  {
    placeK(0, (dRear + dFront) / 2, 0, BOX_HW * 2, dTop, dRear - dFront, 0x6b5f50);             // kaide / sahanlık
    placeK(0, dFront + 0.12, dTop, BOX_HW * 2, 0.35, 0.24, 0x8a6a2a);                               // altın korkuluk
    for (const s of [-1, 1]) placeK(s * (BOX_HW - 0.12), (dRear + dFront) / 2, dTop, 0.24, 0.35, dRear - dFront, 0x8a6a2a);
    placeK(0, (dFront + dRear) / 2 - 0.3, dTop, 1.7, 0.03, dRear - dFront - 0.4, 0x8e1f1f);        // kırmızı halı
    const tr = dRear - 1.15;                                                                          // taht
    placeK(0, tr, dTop, 2.0, 0.22, 1.5, 0x8a6a2a);                                                    // taht basamağı
    placeK(0, tr, dTop + 0.22, 1.1, 0.5, 0.95, 0x4a2f1e);                                            // oturak
    placeK(0, tr + 0.5, dTop + 0.22, 1.3, 2.6, 0.22, 0x4a2f1e);                                       // sırt
    placeK(0, tr + 0.5, dTop + 2.82, 1.5, 0.3, 0.3, 0xd4a017);                                        // sırt tacı
    for (const s of [-1, 1]) {
      placeK(s * 0.62, tr, dTop + 0.22, 0.2, 0.9, 1.0, 0x4a2f1e);                                      // kolçak
      placeK(s * (BOX_HW - 0.35), dRear - 0.5, dTop + 0.35, 0.2, 3.2, 0.2, 0x3a2c22);                 // direk
      placeK(s * 1.2, tr + 0.45, dTop + 2.8, 0.14, 0.9, 0.14, 0xd4a017);                              // tepe süsü
      const f = wpos(aK, s * (BOX_HW - 0.35), dRear - 0.5);
      flames.push({ x: f.x, y: dTop + 3.8, z: f.z });
      const fl = wpos(aK, s * (BOX_HW - 0.35) - s * 0.0, dRear - 0.62);
      extraFlags.push({ a: Math.atan2(fl.z, fl.x), r: Math.hypot(fl.x, fl.z), y: dTop + 3.5, flap: 1, s: 1.35, hex: 0x5b2c83 });
    }
    // arka duvara büyük kırmızı örtü (kral sancağı)
    const bd = wpos(aK, 0, dRear - 0.7);
    extraFlags.push({ a: Math.atan2(bd.z, bd.x), r: Math.hypot(bd.x, bd.z), y: dTop + 3.3, flap: 0, s: 1.6, hex: 0xb02a2a });
  }
  for (const w of gateWalls) { // kapı direklerinin tepesine de meşale
    const q = wpos(w.g.a, w.lat, w.tOut - 1.3);
    flames.push({ x: q.x, y: w.top + 2.75, z: q.z });
  }
  // Loca bölgesindeki seyirci konumlarını boş bırak
  const inKingBox = (a, r) => angDist(a, aK) < Math.PI / 2 && r * Math.sin(angDist(a, aK)) < BOX_HW + 0.4 && r > dFront - 0.9;

  // Halka SECTORS dilime bölünür: her dilim ayrı InstancedMesh → ekran dışındaki dilimler hiç çizilmez
  const sectorOf = (x, z) => Math.floor(((Math.atan2(z, x) % TAU + TAU) % TAU) / TAU * SECTORS) % SECTORS;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0); boxGeo.deleteAttribute('uv');
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const standsMeshes = [];
  for (let s = 0; s < SECTORS; s++) {
    const list = stoneM.filter(b => sectorOf(b.x, b.z) === s);
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(boxGeo, stoneMat, list.length);
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, b.ry, 0); dummy.scale.set(b.sx, b.sy, b.sz); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, col.setHex(b.hex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.03));
    });
    m.computeBoundingSphere();
    m.name = 'tribun' + s;
    m.userData.sector = s;
    standsMeshes.push(m); group.add(m);
  }

  // ---------- Sancaklar (direklerde) + tribün önü örtüleri ----------
  const flags = [];
  for (const p of poles) flags.push({ a: p.a, r: p.r, y: p.y, flap: 1, s: hasBack(p.a) ? 1 : 0.8, hex: BANNER_COLS[(p.i / 4 | 0) % BANNER_COLS.length] });
  for (let i = 3; i < SEGS; i += 4) {   // arka duvarın iç yüzündeki örtüler (sarkan kumaşlar)
    const a = i * segA;
    if (!hasBack(a) || inGap(a, backR - 0.3, segA) || angDist(a, aK) < 0.2) continue;
    flags.push({ a, r: backR - 0.27, y: backH - 0.06, flap: 0, s: 0.7, hex: BANNER_COLS[(i / 4 | 0) % 2 ? 0 : 1] });
  }
  flags.push(...extraFlags);
  const flagGeo = new THREE.PlaneGeometry(0.8, 1.2, 4, 1); flagGeo.translate(0.4, -0.6, 0);
  const flapAttr = new Float32Array(flags.length);
  const flagMat = new THREE.MeshLambertMaterial({ map: bannerTexture(), side: THREE.DoubleSide, alphaTest: 0.5 });
  flagMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'uniform float uTime;\nattribute float aFlap;\n#include <common>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
        transformed.z += sin(uTime * 4.0 + transformed.x * 4.0 + fph) * 0.14 * transformed.x * aFlap;`);
  };
  const banners = new THREE.InstancedMesh(flagGeo, flagMat, flags.length);
  flags.forEach((f, i) => {
    // Kumaş arenaya baksın: düzlemin normali (+z) merkeze dönük
    const ry = Math.atan2(-Math.cos(f.a), -Math.sin(f.a));
    const off = f.flap ? 0.05 : -0.4 * f.s;   // örtüler ortalansın
    const tx = Math.cos(ry), tz = -Math.sin(ry);   // yerel +x yönü (dünya)
    dummy.position.set(Math.cos(f.a) * f.r + tx * off, f.y, Math.sin(f.a) * f.r + tz * off);
    dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(f.s); dummy.updateMatrix();
    banners.setMatrixAt(i, dummy.matrix);
    banners.setColorAt(i, col.setHex(f.hex));
    flapAttr[i] = f.flap;
  });
  flagGeo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flapAttr, 1));
  banners.computeBoundingSphere();
  group.add(banners);

  // ---------- Meşale alevleri (tek çizim, hafif titreme) ----------
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  flameMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'uniform float uTime;\n#include <common>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fl = 1.0 + 0.18 * sin(uTime * 11.0 + instanceMatrix[3].x * 3.0 + instanceMatrix[3].z);
        transformed.y *= fl * 1.5; transformed.xz *= 2.0 - fl;`);
  };
  const flameGeo = new THREE.OctahedronGeometry(0.2, 0); flameGeo.translate(0, 0.2, 0);
  const flameMesh = new THREE.InstancedMesh(flameGeo, flameMat, flames.length);
  flames.forEach((f, i) => { dummy.position.set(f.x, f.y, f.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); flameMesh.setMatrixAt(i, dummy.matrix); });
  flameMesh.computeBoundingSphere();
  group.add(flameMesh);

  // ---------- Seyirci konumları ----------
  // Aday konumlar: öncelik = rastgele + sıra (düşük kalitede ön sıralar dolu kalsın)
  const cand = [];
  for (let k = 0; k < ROWS; k++) {
    const r = rowR(k) - 0.1, step = 0.65 / r;
    for (let a = Math.random() * step; a < TAU; a += step) {
      if (inGap(a, r, 0.3 / r) || inKingBox(a, r)) continue;
      const aj = a + (Math.random() - 0.5) * step * 0.4;
      cand.push({ a: aj, r: r + (Math.random() - 0.5) * 0.15, y: rowYa(k, aj), pr: Math.random() + k * 0.3 });
    }
  }
  cand.sort((p, q) => p.pr - q.pr);
  const N = Math.min(MAX_COUNT, cand.length);
  const pSectorOf = c => Math.floor(((c.a % TAU + TAU) % TAU) / TAU * PSECT) % PSECT;

  // Seyirci malzemesi: Lambert + poz karışımı / zıplama / sallanma shader'ı. Tüm tipler aynı programı paylaşır.
  function crowdShader(sh) {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `uniform float uTime, uCheer, uWaveT, uOoh, uIdle;
        attribute vec3 aPosB; attribute vec3 aPosC; attribute vec2 aSeed;
        #include <common>`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = aSeed.y * 6.2831;
        // Meksika dalgası: halka etrafında dönen tepe
        float wa = mod(aSeed.x - uWaveT * 2.0 + 3.14159, 6.28318) - 3.14159;
        float wave = exp(-wa * wa * 5.0) * min(1.0, uCheer * 1.5);
        float bounce = abs(sin(uTime * (8.0 + aSeed.y * 3.0) + ph)) * uCheer;
        float cheerK = clamp(uCheer * (0.6 + aSeed.y * 0.8) + wave, 0.0, 1.0);
        transformed = mix(position, aPosB, cheerK);
        transformed = mix(transformed, aPosC, clamp(uOoh * 0.9, 0.0, 1.0));
        transformed.y *= 1.0 - uOoh * (0.06 + aSeed.y * 0.06);
        transformed.x += sin(uTime * 1.4 + ph) * uIdle * 0.05 * transformed.y;
        transformed.y += bounce * 0.2 + wave * 0.35;`);
  }

  // ---------- Seyirciler: tip × dilim başına bir InstancedMesh ----------
  const baked = {};          // key → { geo, map, mat }
  let peopleSectors = [];    // { m, idx }
  const pSectorMeshes = Array.from({ length: PSECT }, () => []);
  let builtTypes = 0, quality = opts.quality || 'orta', models = null, building = false;

  async function ensureBaked(nTypes) {
    for (let t = 0; t < nTypes; t++) {
      const def = TYPES[t];
      if (baked[def.key]) continue;
      const b = bakeModel(models.G[def.key].scene, null, [
        { clip: models.idle, t: 0 }, { clip: models.cheer, t: 'cheer' }, { clip: models.hit, t: models.hit ? models.hit.duration * 0.3 : 0 },
      ], { keepVerts: (CROWD_Q[quality] || CROWD_Q.orta).verts });
      const mat = new THREE.MeshLambertMaterial({ map: b.map });
      mat.onBeforeCompile = crowdShader;
      baked[def.key] = { geo: b.geo, map: b.map, mat };
      await tick();   // ana iş parçacığını kısa süre serbest bırak (menüde takılma olmasın)
    }
  }

  function buildPeople(nTypes) {
    for (const p of peopleSectors) { group.remove(p.m); p.m.dispose(); p.m.geometry.dispose(); }
    peopleSectors = []; pSectorMeshes.forEach(l => l.length = 0);
    // Her adaya tip ata (kahraman/iskelet karışık), dilime göre grupla
    const lists = Array.from({ length: PSECT }, () => Array.from({ length: nTypes }, () => []));
    for (let i = 0; i < N; i++) lists[pSectorOf(cand[i])][(Math.random() * nTypes) | 0].push(i);
    for (let s = 0; s < PSECT; s++) for (let t = 0; t < nTypes; t++) {
      const idx = lists[s][t]; if (!idx.length) continue;
      const def = TYPES[t], bk = baked[def.key];
      const geo = new THREE.BufferGeometry();   // öznitelikler paylaşılır, sadece aSeed dilime özel
      for (const k in bk.geo.attributes) geo.setAttribute(k, bk.geo.attributes[k]);
      geo.setIndex(bk.geo.index);
      const seed = new Float32Array(idx.length * 2);
      const m = new THREE.InstancedMesh(geo, bk.mat, idx.length);
      idx.forEach((gi, j) => {
        const c = cand[gi];
        const ry = Math.atan2(-Math.cos(c.a), -Math.sin(c.a)) + (Math.random() - 0.5) * 0.5;
        dummy.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
        dummy.rotation.set(0, ry, 0);
        const sc = Math.random() < 0.1 ? 0.78 : 0.92 + Math.random() * 0.2;
        dummy.scale.set(sc, sc * (0.96 + Math.random() * 0.08), sc); dummy.updateMatrix();
        m.setMatrixAt(j, dummy.matrix);
        // Hafif ton farkı: beyaza yakın pastel renk (dokuyla çarpılır)
        if (def.skel) col.setRGB(0.82 + Math.random() * 0.18, 0.8 + Math.random() * 0.18, 0.75 + Math.random() * 0.2);
        else col.setHex(TINTS[(Math.random() * TINTS.length) | 0]).lerp(new THREE.Color(1, 1, 1), 0.55);
        m.setColorAt(j, col);
        seed[j * 2] = ((c.a % TAU) + TAU) % TAU; seed[j * 2 + 1] = Math.random();
      });
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
      m.computeBoundingSphere();
      m.boundingSphere.radius += 1.5;   // zıplama/kollar için pay
      m.name = 'seyirci' + s + '_' + def.key;
      m.castShadow = m.receiveShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
      m.renderOrder = -2;   // önce seyirciler: arkalarındaki taşlar derinlik testinde elenir
      peopleSectors.push({ m, idx });
      pSectorMeshes[s].push(m);
      group.add(m);
    }
    builtTypes = nTypes;
    api.setQuality(quality);
  }

  // Dekor: heykeller (taş gibi renksiz) ve taht odasındaki Kemik Kral (oturur pozda)
  function buildProps() {
    const kn = baked.knight;
    if (kn && statues.length) {
      const sm = new THREE.MeshLambertMaterial({ map: kn.map, color: 0xb8b2a6 });
      sm.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float gl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = vec3(gl * 1.05, gl * 1.0, gl * 0.92);`); };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', kn.geo.attributes.position); g.setAttribute('normal', kn.geo.attributes.normal); g.setAttribute('uv', kn.geo.attributes.uv); g.setIndex(kn.geo.index);
      const m = new THREE.InstancedMesh(g, sm, statues.length);
      statues.forEach((s, i) => { dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.ry, 0); dummy.scale.setScalar(1.45); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      m.computeBoundingSphere(); m.name = 'heykeller'; group.add(m);
    }
    if (models.sit && models.G.mage) {
      const kb = bakeModel(models.G.mage.scene, [['handslotr', models.G.sStaff.scene]], [{ clip: models.sit, t: 0 }], { keepVerts: 1700, height: 2.9 });
      const mat = new THREE.MeshLambertMaterial({ map: kb.map });
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, kb.geo.attributes[k]);
      g.setIndex(kb.geo.index);
      const king = new THREE.Mesh(g, mat);
      const tr = dRear - 1.15 + 0.1, p = wpos(aK, 0, tr);
      king.position.set(p.x, dTop + 0.22 + 0.5 - kb.geo.userData.minY * 0 , p.z);
      king.rotation.y = Math.atan2(-Math.cos(aK), -Math.sin(aK));
      king.name = 'kemikKral'; king.matrixAutoUpdate = false; king.updateMatrix();
      king.frustumCulled = true;
      group.add(king);
      api.king = king;
    }
  }

  // Modeller yüklendikten sonra çağrılır (game.js loadAll sonrası): pozları pişirir, seyirci ve dekoru kurar.
  async function useModels(G, CLIPS) {
    if (models || building) return;
    building = true;
    try {
      let sim = {};
      try { const gl = await new GLTFLoader().loadAsync(SIM_URL); for (const c of gl.animations) sim[c.name] = c; } catch (e) { console.warn('Seyirci animasyonları yüklenemedi:', e); }
      models = { G, idle: CLIPS.Idle_A, cheer: sim.Cheering || CLIPS.Idle_B, hit: CLIPS.Hit_A, sit: sim.Sit_Chair_Idle };
      const need = (CROWD_Q[quality] || CROWD_Q.orta).types;
      await ensureBaked(need);
      buildPeople(need);
      await tick();
      buildProps();
    } catch (e) { console.error('Seyirci kurulumu başarısız:', e); }
    building = false;
  }

  // ---------- Dilim görünürlüğü ----------
  // Her dilimin köşe noktaları ekrana izdüşürülür; ekran dikdörtgenine değmeyen dilim gizlenir.
  const rIn = R0 - ROW_D / 2 - 0.2, rOut = backR + 0.6, yTop = backH + 2.4;
  function makeSectorPts(n) {
    const out = [], steps = Math.max(3, Math.round(24 / n) + 1);
    for (let s = 0; s < n; s++) {
      const pts = [];
      for (let k = 0; k < steps; k++) {
        const a = (s + k / (steps - 1)) / n * TAU;
        for (const [r, yMax] of [[rIn, Y0 + 2.4], [rOut, yTop]]) for (const y of [0, yMax]) pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      out.push(pts);
    }
    return out;
  }
  const standPts = makeSectorPts(SECTORS), peoplePts = makeSectorPts(PSECT);
  const standMeshes = Array.from({ length: SECTORS }, (_, s) => standsMeshes.filter(m => m.userData.sector === s));
  const _p = new THREE.Vector3();
  function visible(pts, camera) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      _p.copy(p).project(camera);
      if (_p.x < x0) x0 = _p.x; if (_p.x > x1) x1 = _p.x; if (_p.y < y0) y0 = _p.y; if (_p.y > y1) y1 = _p.y;
    }
    return x1 > -1.02 && x0 < 1.02 && y1 > -1.02 && y0 < 1.02;
  }
  function updateVisibility(camera) {
    camera.updateMatrixWorld();
    for (let s = 0; s < SECTORS; s++) { const v = visible(standPts[s], camera); for (const m of standMeshes[s]) m.visible = v; }
    for (let s = 0; s < PSECT; s++) { const v = visible(peoplePts[s], camera); for (const m of pSectorMeshes[s]) m.visible = v; }
  }

  for (const m of group.children) { m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); }
  for (const m of standsMeshes) m.renderOrder = -1;
  scene.add(group);

  // ---------- Tepki durumu ----------
  let cheerT = 0, cheer = 0, oohT = 0, ooh = 0;
  const api = {
    group,
    get count() { return peopleSectors.reduce((s, p) => s + p.m.count, 0); },
    get mood() { return { cheer: +cheerT.toFixed(2), ooh: +oohT.toFixed(2) }; },   // test/hata ayıklama
    useModels,
    baked,
    // camera verilirse ekran dışındaki dilimler gizlenir (kamera kayarken her karede ucuz bir kontrol)
    update(dt, camera) {
      dt = Math.min(dt, 0.1);
      if (camera) updateVisibility(camera);
      U.uTime.value += dt;
      U.uWaveT.value += dt;
      cheerT = Math.max(0, cheerT - dt * 0.3);
      oohT = Math.max(0, oohT - dt * 0.55);
      cheer += (Math.min(1, cheerT) - cheer) * Math.min(1, dt * 6);
      ooh += (Math.min(1, oohT) - ooh) * Math.min(1, dt * (oohT > ooh ? 7 : 3));
      U.uCheer.value = cheer < 0.003 ? 0 : cheer;
      U.uOoh.value = ooh < 0.003 ? 0 : ooh;
    },
    // Tezahürat: 0..1.6 (1'in üstü daha uzun sürer). Yeni başlarsa dalga baştan başlar.
    cheer(strength = 1) {
      if (cheerT < 0.15) U.uWaveT.value = 0;
      cheerT = Math.min(1.8, Math.max(cheerT, strength));
      oohT *= 0.3;
    },
    // "Ooh" tepkisi: sarsılırlar
    ooh(strength = 1) {
      oohT = Math.min(1.8, Math.max(oohT, strength));
      cheerT *= 0.3;
    },
    setQuality(q) {
      quality = q in CROWD_Q ? q : 'orta';
      const c = CROWD_Q[quality];
      for (const p of peopleSectors) { let n = 0; while (n < p.idx.length && p.idx[n] < c.count) n++; p.m.count = n; }
      U.uIdle.value = c.idle;
      // Daha yüksek kaliteye geçildiyse eksik tipleri pişirip yeniden kur
      if (models && !building && c.types !== builtTypes) {
        building = true;
        ensureBaked(c.types).then(() => { buildPeople(c.types); building = false; }).catch(e => { console.error(e); building = false; });
      }
    },
  };
  group.userData.api = api;   // test için: __game.scene.getObjectByName('seyirciler').userData.api.cheer(1)
  return api;
}

// Oyun olaylarını kalabalık tepkilerine bağla (game.js'teki gameEvents)
export function bindCrowd(crowd, events, sfx) {
  const on = (name, fn) => events.addEventListener(name, e => fn(e.detail || {}));
  const play = (fn, ...a) => { try { sfx[fn] && sfx[fn](...a); } catch {} };
  on('kill', d => {
    if (d.boss) return;   // bossKill ayrıca işleniyor
    const c = d.combo || 0;
    if (c === 25 || c === 50 || c === 100 || (c > 100 && c % 50 === 0)) {
      const s = c >= 100 ? 1.3 : c >= 50 ? 1 : 0.7;
      crowd.cheer(s); play('crowdCheer', s);
    } else if (d.elite) { crowd.cheer(0.45); play('crowdCheer', 0.4); }
  });
  on('bossSpawn', () => { crowd.cheer(0.6); play('crowdCheer', 0.5); });
  on('bossKill', d => { crowd.cheer(d.king ? 1.6 : 1.3); play('crowdCheer', 1.2); });
  on('levelUp', () => crowd.cheer(0.25));
  on('waveStart', d => { if ((d.wave || 1) > 1) { crowd.cheer(0.35); play('crowdCheer', 0.3); } });
  on('playerHurt', d => {
    if (d.dmg >= (d.maxHp || 100) * 0.06 || Math.random() < 0.25) { crowd.ooh(0.55); play('crowdOoh', 0.5); }
  });
  on('playerDeath', () => { crowd.ooh(1.8); play('crowdOoh', 1); });
  on('victory', () => { crowd.cheer(1.8); play('crowdCheer', 1.5); });
}
