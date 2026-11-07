import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENEMIES, UPGRADES, SHOP, BUFFS, BUFF_DROP_CHANCE, shopCost, HEROES, EVOS, QUESTS, FINAL_WAVE, ELITE } from './data.js';
import { sfx, initAudio, setAudio, playMusic } from './audio.js';
import { initBosses, updateBoss, updateBossFx, clearBossFx, bossDanger, destroyBulletsNear } from './bosses.js';   // boss saldırıları + fazlar
import { createCrowd, bindCrowd } from './crowd.js';   // tribünler + seyirciler
import { createGates } from './gates.js';   // arena kapıları + kapılardan doğuş
import * as TAL from './talents.js';   // kahramana özel kalıcı yetenekler
import { HERO_TALENTS, HERO_WEAPONS, HERO_MAX_LV } from './data.js';
import * as SUP from './super.js';   // Süper yetenekler (E/Q, mobilde ⚡)
import { initTouch } from './touch.js';   // mobil joystick + atılma + süper butonu

const $ = id => document.getElementById(id);

// Kendi kendini onarma: telefon sayfanın (index.html) ESKİ kopyasını yeni kodla açarsa oyun "Yükleniyor"da kalır.
// Yeni sayfada #heroPrev var; yoksa sayfa önbelleğini tazeleyip bir kez yeniden yükle.
if (!document.getElementById('heroPrev')) {
  let tried = false; try { tried = sessionStorage.getItem('kemikPageFix') === '1'; sessionStorage.setItem('kemikPageFix', '1'); } catch {}
  if (!tried) {
    (async () => {
      try { await Promise.all(['./', './index.html', './style.css'].map(u => fetch(u, { cache: 'reload' }))); } catch {}
      try { for (const k of await caches.keys()) if (!k.includes('assets')) await caches.delete(k); } catch {}
      location.reload();
    })();
    throw new Error('Eski sayfa bulundu, yenileniyor');
  }
}

// Oyun olayları (herkes dinleyebilir): gameEvents.addEventListener('kill', e => e.detail ...)
// Olaylar: kill {elite,boss,combo} · bossSpawn {name} · bossKill {king} · levelUp {level} · playerHurt {dmg,hp,maxHp}
//          waveStart {wave,boss,final} · victory · playerDeath
const gameEvents = new EventTarget();
function emitGameEvent(name, detail) { gameEvents.dispatchEvent(new CustomEvent(name, { detail })); }

// =====================================================
//  Kayıt (altın, kalıcı geliştirmeler, istatistik, ayarlar)
// =====================================================
// Test Modu: ayrı kayıt (tüm kahramanlar açık, sınırsız altın). Gerçek ilerleme etkilenmez.
const TEST_MODE = (() => { try { return localStorage.getItem('kemikArena.mode') === 'test'; } catch { return false; } })();
const SAVE_KEY = TEST_MODE ? 'kemikArena.test' : 'kemikArena.v1';
const TEST_GOLD = 999999;
function loadSave() {
  const d = {
    gold: 0, shop: {}, hero: 'knight', heroes: { knight: true }, quests: {}, heroTalents: {}, heroLevels: {},
    stats: { bestWave: 0, bestKills: 0, bestTime: 0, bestLevel: 0, totalKills: 0, runs: 0, goldEarned: 0, bossKills: 0, wins: 0, evolutions: 0, eliteKills: 0, bestCombo: 0 },
    // Telefonda/tablette varsayılan kalite Düşük (performans)
    settings: { quality: (window.matchMedia && matchMedia('(pointer: coarse)').matches) ? 'dusuk' : 'orta', sound: true, volume: 0.6, fps: false, autoQ: true,
      // Dokunmatik kontrol yerleşimi (yüzde konumlar; boş = varsayılan)
      controls: { scale: 1, joySide: 'left', joySize: 1, pos: {} } },
  };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { ...d, ...s, shop: { ...s.shop }, heroes: { ...d.heroes, ...s.heroes }, quests: { ...s.quests }, heroTalents: { ...s.heroTalents }, heroLevels: { ...s.heroLevels },
             stats: { ...d.stats, ...s.stats }, settings: { ...d.settings, ...s.settings } };
  } catch { return d; }
}
const save = loadSave();
// Tüm kahramanlar herkese açık (kullanıcı kararı, 7 Kasım 2026)
for (const id in HEROES) save.heroes[id] = true;
if (TEST_MODE) {   // her açılışta: altın dolu
  save.gold = Math.max(save.gold, TEST_GOLD);
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
// Tek seferlik göç: eski 5'li yetenek dükkanı kalktı → harcanan altın iade edilir, heroTalents sıfırlanır
let migRefund = 0;
if (!save.talentsMigrated) {
  for (const h in save.heroTalents) for (const t of HERO_TALENTS[h] || []) {
    const lv = (save.heroTalents[h] || {})[t.id] || 0;
    for (let i = 0; i < lv; i++) migRefund += shopCost(t, i);
  }
  save.gold += migRefund; save.heroTalents = {}; save.talentsMigrated = true;
  persist();
}
const shopLv = id => save.shop[id] || 0;
setAudio(save.settings.sound, save.settings.volume);

// =====================================================
//  Grafik kalitesi
// =====================================================
const DPR = window.devicePixelRatio || 1;
const QUALITY = {
  dusuk:  { pr: Math.min(DPR, 1) * 0.75, shadow: 0,    cap: 18, enemyShadow: false },
  orta:   { pr: Math.min(DPR, 1.25),     shadow: 1024, cap: 26, enemyShadow: false },
  yuksek: { pr: Math.min(DPR, 2),        shadow: 2048, cap: 34, enemyShadow: true },
};
const Q_ORDER = ['dusuk', 'orta', 'yuksek'];
let Q = QUALITY[save.settings.quality] || QUALITY.orta;

// =====================================================
//  Sahne
// =====================================================
const renderer = new THREE.WebGLRenderer({ antialias: save.settings.quality === 'yuksek', powerPreference: 'high-performance', alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const sceneBg = new THREE.Color(0x1f1430); scene.background = sceneBg;
let homeDraw = false, subDraw = false;   // ana menüde sadece kahraman / alt sayfada hiç sahne çizilmiyor mu
scene.fog = new THREE.Fog(0x241838, 40, 70);

const VIEW = 8.5;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const CAM_OFFSET = new THREE.Vector3(20, 22, 20);
// Etkin görüş: dar (dikey) ekranlarda yatay yarı-genişlik en az ~7 birim olsun (en fazla 15'e kadar uzaklaş)
let viewEff = VIEW;
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h);
  viewEff = Math.min(12.5, Math.max(VIEW, 6.2 / a));   // dikey telefonda daha yakın kamera
  camera.left = -viewEff * a; camera.right = viewEff * a; camera.top = viewEff; camera.bottom = -viewEff;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const hemi = new THREE.HemisphereLight(0xd2c8ff, 0x4a3560, 1.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
hemi.layers.enable(1); sun.layers.enable(1);   // menü vitrininde de aydınlatsın
// Sadece menü vitrini (katman 1) için ek ışıklar: önden beyaz anahtar ışık + arkadan mor kenar ışığı
const menuKey = new THREE.DirectionalLight(0xfff4e6, 1.6), menuRim = new THREE.DirectionalLight(0xc070ff, 2.2);
menuKey.layers.set(1); menuRim.layers.set(1); scene.add(menuKey, menuRim);

function applyQuality() {
  Q = QUALITY[save.settings.quality] || QUALITY.orta;
  renderer.setPixelRatio(Q.pr);
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = save.settings.quality === 'yuksek' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  sun.castShadow = Q.shadow > 0;
  if (Q.shadow) {
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  scene.traverse(o => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true);
  });
  for (const list of Object.values(pools)) for (const e of list) setCharShadow(e, Q.enemyShadow);
  for (const e of enemies) setCharShadow(e, Q.enemyShadow);
  crowd.setQuality(save.settings.quality);
  resize();
}

// --- Arena ---
const ARENA_R = 17;
function stoneTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5b5148'; g.fillRect(0, 0, 512, 512);
  const n = 8, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const off = (y % 2) * s / 2, v = 100 + Math.random() * 30;
    g.fillStyle = `rgb(${v + 12},${v + 4},${v - 8})`;
    g.fillRect(x * s + off + 3, y * s + 3, s - 6, s - 6);
    g.fillRect(x * s + off + 3 - 512, y * s + 3, s - 6, s - 6);
  }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 2, 64), new THREE.MeshLambertMaterial({ map: stoneTexture(), color: 0xb08cf0 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const outer = new THREE.Mesh(new THREE.RingGeometry(ARENA_R + 1.9, 120, 48, 1), new THREE.MeshBasicMaterial({ color: 0x1c1624 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);

// Duvar, sütun ve meşaleler tek seferde çizilsin diye "instanced" (performans)
const dummy = new THREE.Object3D();
const WALL_R = ARENA_R + 2.2, SEG = 36, PILLARS = SEG / 4;
const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * Math.PI * WALL_R / SEG + 0.05, 1.1, 0.8), new THREE.MeshLambertMaterial({ color: 0x6f6458 }), SEG);
const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 2.8, 1.2), new THREE.MeshLambertMaterial({ color: 0x8a7e70 }), PILLARS);
const torchMat = new THREE.MeshBasicMaterial({ color: 0xb050ff });
const torches = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), torchMat, PILLARS);
// Kapılar (gates.js): 4 kapı + koridor + parmaklık; kapı ağzındaki duvar/sütun parçaları gizlenir (ölçek 0)
const arenaGates = createGates({ scene, ARENA_R, WALL_R, SEG, sfx });
for (let i = 0; i < SEG; i++) {
  const a = (i / SEG) * Math.PI * 2, x = Math.cos(a) * WALL_R, z = Math.sin(a) * WALL_R;
  dummy.scale.setScalar(arenaGates.isGateSeg(i) ? 0 : 1);
  dummy.position.set(x, 0.55, z); dummy.rotation.set(0, -a + Math.PI / 2, 0); dummy.updateMatrix(); walls.setMatrixAt(i, dummy.matrix);
  if (i % 4 === 0) {
    const k = i / 4;
    dummy.position.set(x, 1.4, z); dummy.rotation.set(0, -a, 0); dummy.updateMatrix(); pillars.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, 3.0, z); dummy.updateMatrix(); torches.setMatrixAt(k, dummy.matrix);
  }
}
dummy.scale.setScalar(1);
walls.castShadow = walls.receiveShadow = pillars.castShadow = pillars.receiveShadow = true;
scene.add(walls, pillars, torches);

// Tribünler ve seyirciler (crowd.js): 3 çizim çağrısı, animasyon shader'da; olaylara tezahürat/"ooh" ile tepki verir
const crowd = createCrowd(scene, { wallR: WALL_R, gates: arenaGates.gates, quality: save.settings.quality });
bindCrowd(crowd, gameEvents, sfx);

// Paylaşılan basit geometriler/malzemeler
const blobGeo = new THREE.CircleGeometry(0.55, 20);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

// =====================================================
//  Asetler
// =====================================================
const ADV = 'assets/kaykit/adventurers/KayKit_Adventurers_2.0_FREE/';
const SKL = 'assets/kaykit/skeletons/KayKit_Skeletons_1.1_FREE/';
const ANI = 'assets/kaykit/animations/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_';
const FILES = {
  knight: ADV + 'Characters/gltf/Knight.glb',
  barbarian: ADV + 'Characters/gltf/Barbarian.glb',
  heroMage: ADV + 'Characters/gltf/Mage.glb',
  ranger: ADV + 'Characters/gltf/Ranger.glb',
  heroRogue: ADV + 'Characters/gltf/Rogue_Hooded.glb',
  axe2: ADV + 'Assets/gltf/axe_2handed.gltf',
  staff: ADV + 'Assets/gltf/staff.gltf',
  bow: ADV + 'Assets/gltf/bow_withString.gltf',
  arrow: ADV + 'Assets/gltf/arrow_bow.gltf',
  sword: ADV + 'Assets/gltf/sword_1handed.gltf',
  shield: ADV + 'Assets/gltf/shield_badge_color.gltf',
  dagger: ADV + 'Assets/gltf/dagger.gltf',
  // Sv.10 silah görünümleri (HERO_WEAPONS)
  sword2: ADV + 'Assets/gltf/sword_2handed_color.gltf',
  shieldSp: ADV + 'Assets/gltf/shield_spikes_color.gltf',
  axe1: ADV + 'Assets/gltf/axe_1handed.gltf',
  book: ADV + 'Assets/gltf/spellbook_open.gltf',
  xbow: ADV + 'Assets/gltf/crossbow_2handed.gltf',
  orbShield: ADV + 'Assets/gltf/shield_round_color.gltf',
  mug: ADV + 'Assets/gltf/mug_full.gltf',
  minion: SKL + 'characters/gltf/Skeleton_Minion.glb',
  warrior: SKL + 'characters/gltf/Skeleton_Warrior.glb',
  rogue: SKL + 'characters/gltf/Skeleton_Rogue.glb',
  mage: SKL + 'characters/gltf/Skeleton_Mage.glb',
  sBlade: SKL + 'assets/gltf/Skeleton_Blade.gltf',
  sAxe: SKL + 'assets/gltf/Skeleton_Axe.gltf',
  sStaff: SKL + 'assets/gltf/Skeleton_Staff.gltf',
  sShield: SKL + 'assets/gltf/Skeleton_Shield_Large_A.gltf',
  sArrow: SKL + 'assets/gltf/Skeleton_Arrow_Broken.gltf',
  sShieldB: SKL + 'assets/gltf/Skeleton_Shield_Small_B.gltf',
  aGeneral: ANI + 'General.glb', aMove: ANI + 'MovementBasic.glb', aMelee: ANI + 'CombatMelee.glb', aSpecial: ANI + 'Special.glb',
  aRanged: ANI + 'CombatRanged.glb',
};
const ANIM_FILES = ['aGeneral', 'aMove', 'aMelee', 'aSpecial', 'aRanged'];
const CHAR_MODELS = ['knight', 'barbarian', 'heroMage', 'ranger', 'heroRogue', 'minion', 'warrior', 'rogue', 'mage'];
const G = {}, CLIPS = {};
const manager = new THREE.LoadingManager();
const playBtn = $('playBtn');
manager.onProgress = (_, done, total) => { playBtn.textContent = `Yükleniyor… %${Math.round(done / total * 100)}`; };
const loader = new GLTFLoader(manager);
async function loadAll() {
  await Promise.all(Object.entries(FILES).map(async ([k, url]) => { G[k] = await loader.loadAsync(url); }));
  for (const k of ANIM_FILES) for (const clip of G[k].animations) CLIPS[clip.name] = clip;
  // Performans: PBR (MeshStandard) yerine çok daha ucuz Lambert ışıklandırma.
  // Low-poly, tek doku atlaslı modellerde görüntü neredeyse aynı kalıyor.
  const cache = new Map();
  for (const k in G) G[k].scene.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    const m = o.material;
    if (!cache.has(m)) cache.set(m, new THREE.MeshLambertMaterial({ map: m.map, color: m.color, transparent: m.transparent, opacity: m.opacity, side: m.side }));
    o.material = cache.get(m);
  });
  // Performans: her karakterin ~10 parçasını tek modelde birleştir (10 çizim → 1 çizim)
  for (const k of CHAR_MODELS) mergeSkinned(G[k].scene, k);
}

function mergeSkinned(root, label) {
  const parts = [];
  root.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
  if (parts.length < 2) return;
  const f = parts[0];
  const same = parts.every(m => m.skeleton.bones.length === f.skeleton.bones.length && m.skeleton.bones.every((b, i) => b === f.skeleton.bones[i])
    && m.parent === f.parent && m.bindMatrix.equals(f.bindMatrix) && m.matrix.equals(f.matrix));
  if (!same) { console.warn('Birleştirme atlandı:', label); return; }
  // Aynı malzemeyi kullanan parçaları birleştir (ör. iskelet gövdesi + ayrı parlayan gözler)
  const groups = new Map();
  for (const m of parts) { if (!groups.has(m.material)) groups.set(m.material, []); groups.get(m.material).push(m); }
  const ATTRS = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      const g = new THREE.BufferGeometry();
      for (const a of ATTRS) { if (!m.geometry.attributes[a]) return null; g.setAttribute(a, m.geometry.attributes[a]); }
      g.setIndex(m.geometry.index);
      return g;
    });
    if (geos.includes(null)) { console.warn('Birleştirme atlandı (eksik veri):', label); continue; }
    const merged = mergeGeometries(geos, false);
    if (!merged) { console.warn('Birleştirme başarısız:', label); continue; }
    const mesh = new THREE.SkinnedMesh(merged, mat);
    mesh.name = label + '_merged';
    mesh.position.copy(f.position); mesh.quaternion.copy(f.quaternion); mesh.scale.copy(f.scale);
    f.parent.add(mesh);
    mesh.bind(f.skeleton, f.bindMatrix);
    for (const m of list) m.parent.remove(m);
  }
}

// =====================================================
//  Karakter yardımcıları
// =====================================================
function setCharShadow(c, on) {
  if (c.shadowOn === on) return;
  c.shadowOn = on;
  c.obj.traverse(o => { if (o.isMesh) o.castShadow = on; });
}

// Tüm düşman gölge lekeleri tek çizimde
const blobs = new THREE.InstancedMesh(blobGeo, blobMat, 64);
blobs.rotation.x = 0; blobs.renderOrder = -1; blobs.frustumCulled = false; blobs.count = 0;
blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(blobs);
function syncBlobs() {
  let n = 0;
  if (!(Q.enemyShadow && renderer.shadowMap.enabled)) {
    for (const e of enemies) {
      if (n >= 64 || !e.obj.visible || e.obj.position.y < -0.3) continue;
      const s = e.baseScale || 1;
      dummy.position.set(e.obj.position.x, 0.03, e.obj.position.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      blobs.setMatrixAt(n++, dummy.matrix);
    }
  }
  blobs.count = n;
  blobs.instanceMatrix.needsUpdate = true;
}

function makeChar(model, rightKey, leftKey) {
  // Not: malzemeler paylaşılıyor (kopyalanmıyor) — daha az bellek, daha hızlı
  const obj = SkeletonUtils.clone(G[model].scene);
  // GLTFLoader düğüm adlarındaki noktayı siler ("handslot.r" -> "handslotr")
  const wp = {};   // el kemiği → takılı silah (Sv.10'da değiştirilebilsin)
  for (const [bone, wk] of [['handslotr', rightKey], ['handslotl', leftKey]]) {
    if (!wk) continue;
    const b = obj.getObjectByName(bone);
    if (b) { wp[bone] = G[wk].scene.clone(); b.add(wp[bone]); }
  }
  scene.add(obj);
  // Gölge lekeleri tek bir InstancedMesh ile çiziliyor (bkz. syncBlobs)
  return { obj, blob: null, mixer: new THREE.AnimationMixer(obj), actions: {}, current: null, shadowOn: null, wp };
}
// Kahraman seviyesi 10 ve üstüyse daha iyi silah modelleri tak (HERO_WEAPONS), değilse varsayılanı
function equipWeapons(c, id, tier) {
  if (c.tier === tier) return;
  c.tier = tier;
  const H = HEROES[id], W = HERO_WEAPONS[id];
  const set = (bone, key, sc) => {
    const b = c.obj.getObjectByName(bone); if (!b) return;
    if (c.wp[bone]) { b.remove(c.wp[bone]); delete c.wp[bone]; }
    if (!key) return;
    const m = G[key].scene.clone(); m.scale.setScalar(sc); b.add(m); c.wp[bone] = m;
    if (c.shadowOn) m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (c.sil) m.traverse(o => { if (o.isMesh) { o.userData.mat0 = o.material; o.material = silMat; } });
  };
  set('handslotr', tier ? W.right : H.right, tier ? W.scale[0] : 1);
  set('handslotl', tier ? W.left : H.left, tier ? W.scale[1] : 1);
}

function play(c, name, once = false, fade = 0.15, speed = 1) {
  const clip = CLIPS[name]; if (!clip) return 0;
  const a = c.actions[name] || (c.actions[name] = c.mixer.clipAction(clip));
  if (c.current === a && !once) { a.timeScale = speed; return clip.duration / speed; }
  a.reset();
  a.timeScale = speed;
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  a.clampWhenFinished = once;
  if (c.current && c.current !== a) a.crossFadeFrom(c.current, fade, false);
  a.play();
  c.current = a;
  return clip.duration / speed;
}

function turnTo(obj, target, k) {
  let d = target - obj.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  obj.rotation.y += d * Math.min(1, k);
}

// =====================================================
//  Girdi
// =====================================================
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) togglePause();
  if (state === 'chest' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) collectChest();
  if ((e.code === 'KeyE' || e.code === 'KeyQ') && !e.repeat && state === 'play' && !bot) SUP.superUse(moveInput());   // Süper
  if (state === 'levelup') {
    if (e.code === 'Digit1' || e.code === 'Numpad1') pickChoice(0);
    if (e.code === 'Digit2' || e.code === 'Numpad2') pickChoice(1);
    if (e.code === 'Digit3' || e.code === 'Numpad3') pickChoice(2);
    if (e.code === 'KeyR') reroll();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(); });
addEventListener('pointerdown', () => initAudio());

// Mobil dokunmatik kontroller
const touch = initTouch($('hud'), { onFirstTouch: initAudio, controls: save.settings.controls, onControls: c => { save.settings.controls = c; persist(); } });
$('ctrlEditBtn').onclick = () => {
  sfx.click();
  ui.menu.classList.add('hidden');
  touch.edit(true, () => { ui.menu.classList.remove('hidden'); showCard('mSettings'); });
};
addEventListener('blur', () => touch.reset());

// Ekran kartı bağlantısı koparsa (zayıf GPU / sürücü) oyuncuya haber ver
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  if (state === 'play') togglePause();
  const box = document.createElement('div');
  box.className = 'overlay'; box.style.zIndex = 50;
  box.innerHTML = `<div class="card"><h2>⚠️ Grafik bağlantısı koptu</h2>
    <p class="sub">Ekran kartı oyunun görüntüsünü kaybetti. Sayfayı yenileyince devam edebilirsin; ilerlemen kayıtlı.
    Sık oluyorsa Ayarlar'dan grafik kalitesini düşür.</p><button class="primary" onclick="location.reload()">Sayfayı yenile</button></div>`;
  document.body.appendChild(box);
});

const FWD =new THREE.Vector3(-1, 0, -1).normalize();    // ekranın yukarısı
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();   // ekranın sağı

// =====================================================
//  UI yardımcıları
// =====================================================
const ui = {
  hud: $('hud'), hpFill: $('hpFill'), hpTxt: $('hpTxt'), xpFill: $('xpFill'), lvl: $('lvlTxt'), lvlNum: $('lvlNum'), dash: $('dashFill'),
  wave: $('waveTxt'), waveSub: $('waveSub'), time: $('timeTxt'), kills: $('killTxt'), gold: $('goldTxt'),
  buffs: $('buffs'), upBar: $('upgradeBar'), banner: $('banner'), hint: $('hint'), hurt: $('hurt'),
  bossWrap: $('bossWrap'), bossFill: $('bossFill'), bossName: $('bossName'), fps: $('fps'), toast: $('toast'),
  menu: $('menu'), levelUp: $('levelUp'), pause: $('pause'), over: $('over'), dmg: $('dmgLayer'),
  combo: $('combo'), comboN: $('comboN'), chest: $('chest'), victory: $('victory'),
};
const textCache = new Map();
function setText(el, v) { if (textCache.get(el) !== v) { textCache.set(el, v); el.textContent = v; } }
function setWidth(el, pct) { const v = Math.max(0, Math.min(100, pct)).toFixed(1) + '%'; if (textCache.get(el) !== v) { textCache.set(el, v); el.style.width = v; } }
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let bannerT = 0;
function banner(text, t = 2) { ui.banner.textContent = text; ui.banner.style.opacity = 1; bannerT = t; }
let toastTimer = 0;
function toast(text) { ui.toast.textContent = text; ui.toast.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.style.opacity = 0, 2600); }

// Uçan hasar sayıları (DOM havuzu)
const floatPool = [], floats = [];
const projV = new THREE.Vector3();
function floatText(pos, txt, cls = '', yOff = 2.2) {
  let el = floatPool.pop();
  if (!el) { el = document.createElement('div'); ui.dmg.appendChild(el); }
  if (floats.length > 60) { const old = floats.shift(); old.el.style.opacity = 0; floatPool.push(old.el); }
  el.className = 'ft ' + cls; el.textContent = txt; el.style.opacity = 1;
  floats.push({ el, x: pos.x + (Math.random() - 0.5) * 0.5, y: pos.y + yOff, z: pos.z + (Math.random() - 0.5) * 0.5, t: 0.8 });
}
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t -= dt; f.y += dt * 1.6;
    if (f.t <= 0) { f.el.style.opacity = 0; floatPool.push(f.el); floats.splice(i, 1); continue; }
    projV.set(f.x, f.y, f.z).project(camera);
    const x = (projV.x + 1) / 2 * innerWidth, y = (1 - projV.y) / 2 * innerHeight;
    f.el.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px) translate(-50%,-50%)`;
    f.el.style.opacity = Math.min(1, f.t * 3);
  }
}

// =====================================================
//  Oyun durumu
// =====================================================
let state = 'loading';     // loading | menu | play | levelup | chest | paused | dying | victory | over
let player = null, run = null;
let enemies = [], orbs = [], shots = [], buffDrops = [], fxList = [], orbitMeshes = [], chests = [];
const pools = {};
let shake = 0, freeze = 0;

const xpFor = l => Math.round(3 + l * 3 + l * l * 0.6);

function newRun() {
  return {
    hero: save.hero, time: 0, wave: 0, kills: 0, gold: 0, level: 1, xp: 0, xpNeed: xpFor(1), up: {}, evo: {}, buffs: {},
    rerolls: shopLv('reroll'), revived: false, dmgDealt: 0, pending: 0, bossKills: 0, eliteKills: 0, evos: 0,
    lastHit: null, dmgBy: {},
    combo: 0, comboT: 0, bestCombo: 0, gemChain: 0, gemT: 0, won: false, endless: false, counted: false, questT: 1, newQuests: [],
    queue: [], reinf: [], reinfT: 4, reinfSpawnT: 0, spawnT: 0, breakT: 0, waveLeft: 0, daggerT: 1, novaT: 3, orbitA: 0, s: null, boss: null,
  };
}

// Oyuncu istatistikleri (kahraman + geliştirmeler + kalıcı bonuslar)
function recompute() {
  const u = k => run.up[k] || 0;
  const H = HEROES[run.hero], m = H.mods || {};
  const dmgMult = (1 + 0.25 * u('dmg') + (m.dmg || 0)) * (1 + 0.08 * shopLv('power'));
  const ranged = H.attack === 'bolt' || H.attack === 'arrow';
  run.s = {
    dmgMult, ranged,
    atkDmg: 10 * dmgMult,
    interval: (m.interval || 0.85) / (1 + 0.15 * u('aspd')),
    range: (m.range || 2.4) * (ranged ? 1 + 0.05 * u('area') : 1 + 0.15 * u('area')),
    area: 1 + 0.15 * u('area'),
    speed: 6 * (1 + 0.1 * u('speed') + (m.speed || 0)) * (1 + 0.05 * shopLv('swift')),
    maxHp: 100 + (m.hp || 0) + 25 * u('hp') + 10 * shopLv('vitality'),
    regen: 0.6 * u('regen') + (m.regen || 0),
    crit: 0.08 * u('crit') + (m.crit || 0),
    vamp: u('vamp'),
    magnet: 2.2 * (1 + 0.6 * u('magnet')),
    armor: Math.min(0.6, 0.06 * shopLv('armor') + (m.armor || 0)),
    goldMult: 1 + 0.15 * shopLv('greed'),
    xpMult: 1 + 0.1 * shopLv('wisdom'),
  };
  TAL.applyTalentStats(run.s, run.hero);   // kahramana özel yetenekler
  rangeRing.visible = !ranged;
  rangeRing.scale.setScalar(run.s.range);
}

// --- Oyuncu ---
const rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false }));
rangeRing.rotation.x = -Math.PI / 2; rangeRing.position.y = 0.04;
const holyBubble = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.22, depthWrite: false }));
holyBubble.position.y = 1; holyBubble.visible = false;

// Her kahraman bir kez oluşturulur, seçilince gösterilir
const heroChars = {};
function setHero(id) {
  const H = HEROES[id];
  if (!heroChars[id]) {
    const c = makeChar(H.model, H.right, H.left);
    c.obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
    c.tier = 0;
    heroChars[id] = c;
  }
  equipWeapons(heroChars[id], id, TAL.hasMilestone(id, 'weapon') ? 1 : 0);   // Sv.10: silah görünümü
  for (const k in heroChars) heroChars[k].obj.visible = k === id;
  player = heroChars[id];
  player.obj.add(rangeRing, holyBubble);
  resetPlayer();
}
function resetPlayer() {
  const p = player;
  p.obj.position.set(0, 0, 0); p.obj.rotation.set(0, Math.PI / 4, 0); p.obj.visible = true;
  Object.assign(p, { hp: 100, atkTimer: 0.3, hitAt: -1, shootAt: -1, lock: 0, swingA: 0, combo: 0, dashT: 0, dashCd: 0, dashDir: new THREE.Vector3(), invuln: 0, dead: false, target: null });
  p.mixer.stopAllAction(); p.current = null;
  play(p, 'Idle_A');
}

// --- Düşman havuzu (her doğuşta modeli yeniden kopyalamamak için) ---
function getEnemy(type) {
  const def = ENEMIES[type];
  const list = pools[type] || (pools[type] = []);
  let c = list.pop();
  if (!c) {
    c = makeChar(def.model, def.right, def.left);
    c.obj.scale.setScalar(def.scale || 1);
  }
  c.obj.visible = true;
  c.mixer.stopAllAction(); c.current = null;
  setCharShadow(c, Q.enemyShadow);
  return c;
}
function releaseEnemy(e) {
  e.obj.visible = false;
  e.obj.position.y = 0;
  (pools[e.type] || (pools[e.type] = [])).push(e);
}

const eliteRingGeo = new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2);
const eliteRingMat = new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });

function spawnEnemy(type, opts = {}) {
  const def = ENEMIES[type];
  const e = getEnemy(type);
  const pp = player.obj.position;
  let x = 0, z = 0, gate = -1, gRot = 0, gateWait = 0;
  if (opts.at) { x = opts.at.x; z = opts.at.z; }   // çağrılan minionlar: oldukları yerde doğar
  else {
    // Kapıdan akın: aktif bir kapının dışındaki koridorda doğar, içeri yürür (boss'lar büyük kapıdan)
    gate = arenaGates.pick(!!def.boss, pp);
    gateWait = arenaGates.waitFor(gate, pp, !!def.boss);
    const sp = arenaGates.spawnPos(gate, !!def.boss);
    x = sp.x; z = sp.z; gRot = sp.rot;
  }
  const rr = Math.hypot(x, z);
  if (gate < 0 && rr > ARENA_R - 0.5) { x *= (ARENA_R - 0.5) / rr; z *= (ARENA_R - 0.5) / rr; }
  e.obj.position.set(x, 0, z);
  e.obj.rotation.y = gate >= 0 ? gRot : Math.atan2(pp.x - x, pp.z - z);
  const w = run.wave, elite = !!opts.elite;
  // Dalga ilerledikçe düşmanlar güçlenir (denge: data.js değil burada)
  // Geç oyun dengesi: yüksek Kahraman Seviyesi düşmanları da biraz güçlendirir (Sv20 ≈ +%60 can, +%100 hasar; Sv0 etkilenmez)
  const hlv = (save.heroLevels && save.heroLevels[run.hero]) || 0;
  const hpMul = def.noScale ? 1 : (1 + 0.22 * (w - 1)) * (1 + 0.03 * hlv), dmgMul = def.noScale ? 1 : (1 + 0.08 * (w - 1)) * (1 + 0.05 * hlv);
  const baseScale = (def.scale || 1) * (elite ? ELITE.scale : 1);
  e.obj.scale.setScalar(baseScale);
  if (!e.eliteRing) { e.eliteRing = new THREE.Mesh(eliteRingGeo, eliteRingMat); e.eliteRing.position.y = 0.05; e.obj.add(e.eliteRing); }
  e.eliteRing.visible = elite;
  const dur = gate >= 0 ? (play(e, def.walk, false, 0.01, def.walkAnim), 0)
    : play(e, def.boss ? 'Skeletons_Awaken_Standing' : 'Skeletons_Awaken_Floor', true, 0.01, def.boss ? 0.9 : 1.4);
  const hp = def.hp * hpMul * (elite ? ELITE.hp : 1);
  Object.assign(e, {
    type, def, elite, hp, hpMax: hp, dmg: def.dmg * dmgMul * (elite ? ELITE.dmg : 1), gate,
    state: gate >= 0 ? 'enter' : 'spawn', t: dur || 1.2, el: 0, cd: 0.6 + Math.random(), knock: new THREE.Vector3(),
    punch: 0, orbitCd: 0, removed: false, hitDone: false, baseScale, summoned: !!opts.summoned, gateWait,
  });
  enemies.push(e);
  if (def.boss) {
    run.boss = e;
    ui.bossName.textContent = def.name.toUpperCase();
    ui.bossWrap.classList.remove('hidden');
    sfx.boss(); shake = 0.5; playMusic('boss');
    emitGameEvent('bossSpawn', { name: def.name, king: !!def.king });
    if (gate >= 0) { sfx.bossGate(); shake = 0.9; }   // büyük kapıdan fanfarla çıkış
  }
}

// --- Toplanabilirler (tek çizimde çok sayıda: InstancedMesh) ---
class InstPool {
  constructor(geo, mat, cap, y) {
    this.cap = cap; this.y = y; this.items = [];
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, white);
    scene.add(this.mesh);
  }
  add(x, z, v, col) {
    if (this.items.length >= this.cap) { this.items[(Math.random() * this.items.length) | 0].v += v; return; }
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2;
    this.items.push({ x, z, v, col, vx: Math.cos(a) * s, vz: Math.sin(a) * s, pull: false, sp: 0 });
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
  sync(time) {
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      dummy.position.set(it.x, this.y + Math.sin(time * 3 + i) * 0.08, it.z);
      dummy.rotation.set(0, time * 2 + i, 0);
      dummy.scale.setScalar(it.v >= 10 ? 1.6 : it.v >= 3 ? 1.25 : 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      if (it.col) this.mesh.setColorAt(i, it.col);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const gems = new InstPool(new THREE.OctahedronGeometry(0.17), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a3a2a }), 300, 0.35);
const coins = new InstPool(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2b84b, emissive: 0x6a4500 }), 150, 0.35);
const GEM_COL = [new THREE.Color(0x4fe39a), new THREE.Color(0x4fa8ff), new THREE.Color(0xc070ff)];
const gemCol = v => v >= 10 ? GEM_COL[2] : v >= 3 ? GEM_COL[1] : GEM_COL[0];

// --- Parçacıklar (kemik kırıkları, kıvılcım) — tek çizimde ---
const BONE_COL = new THREE.Color(0xeee6d6), GOLD_COL = new THREE.Color(0xffd23f), MAGIC_COL = new THREE.Color(0x7fdcff);
class Particles {
  constructor(cap) {
    this.cap = cap; this.items = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, BONE_COL);
    scene.add(this.mesh);
  }
  emit(pos, n, col, speed = 4) {
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.cap) this.items.shift();
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.items.push({ x: pos.x, y: 0.6 + Math.random() * 0.8, z: pos.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * speed, vz: Math.sin(a) * s,
                        life: 0.7 + Math.random() * 0.5, max: 1.2, col, r: Math.random() * 6 });
    }
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
  update(dt) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const p = it[i];
      p.life -= dt; if (p.life <= 0) { it.splice(i, 1); continue; }
      p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += dt * 8;
      if (p.y < 0.06) { p.y = 0.06; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
    }
  }
  sync() {
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const p = this.items[i];
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.r, p.r * 0.7, 0);
      dummy.scale.setScalar(Math.min(1, p.life * 2.5)); dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix); this.mesh.setColorAt(i, p.col);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const particles = new Particles(450);

// --- Hazine sandığı ---
const chestBodyMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), chestLidMat = new THREE.MeshLambertMaterial({ color: 0x6b4220 });
const chestGoldMat = new THREE.MeshLambertMaterial({ color: 0xffc83d, emissive: 0x7a5200 });
const chestBodyGeo = new THREE.BoxGeometry(0.8, 0.5, 0.55), chestLidGeo = new THREE.BoxGeometry(0.84, 0.18, 0.59), chestBandGeo = new THREE.BoxGeometry(0.12, 0.72, 0.62);
function dropChest(x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(chestBodyGeo, chestBodyMat); body.position.y = 0.25;
  const lid = new THREE.Mesh(chestLidGeo, chestLidMat); lid.position.y = 0.58;
  const band = new THREE.Mesh(chestBandGeo, chestGoldMat); band.position.y = 0.34;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.scale.setScalar(1.5);
  g.add(body, lid, band, ring);
  g.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
  const r = Math.hypot(x, z); if (r > ARENA_R - 1) { x *= (ARENA_R - 1) / r; z *= (ARENA_R - 1) / r; }
  g.position.set(x, 0, z);
  scene.add(g);
  chests.push({ g, ring, t: 0 });
  floatText(g.position, '📦 Sandık!', 'gold', 1.4);
}
function updateChests(dt) {
  const p = player.obj.position;
  for (let i = chests.length - 1; i >= 0; i--) {
    const c = chests[i];
    c.t += dt;
    c.g.position.y = Math.max(0, Math.sin(c.t * 3) * 0.08);
    c.ring.scale.setScalar(1.4 + Math.sin(c.t * 5) * 0.15);
    if (!player.dead && Math.hypot(p.x - c.g.position.x, p.z - c.g.position.z) < 1.0) {
      scene.remove(c.g); chests.splice(i, 1);
      openChest();
      return;
    }
  }
}

function updatePickups(pool, dt, onCollect) {
  const p = player.obj.position, mag = run.s.magnet, damp = Math.pow(0.02, dt);
  for (let i = pool.items.length - 1; i >= 0; i--) {
    const it = pool.items[i];
    it.x += it.vx * dt; it.z += it.vz * dt; it.vx *= damp; it.vz *= damp;
    const dx = p.x - it.x, dz = p.z - it.z, d = Math.hypot(dx, dz) || 0.001;
    if (d < mag || it.pull) {
      it.pull = true; it.sp = Math.min(20, it.sp + dt * 35);
      it.x += dx / d * it.sp * dt; it.z += dz / d * it.sp * dt;
    }
    if (d < 0.6) { onCollect(it); pool.items.splice(i, 1); }
  }
}

// Süreli güçlendirme düşürme
const buffGeo = new THREE.OctahedronGeometry(0.32);
const ringGeo = new THREE.RingGeometry(0.45, 0.6, 24);
function dropBuff(x, z) {
  let r = Math.random() * Object.values(BUFFS).reduce((s, b) => s + b.weight, 0), kind = 'potion';
  for (const [k, b] of Object.entries(BUFFS)) { r -= b.weight; if (r <= 0) { kind = k; break; } }
  const b = BUFFS[kind];
  const g = new THREE.Group();
  let body;
  if (kind === 'potion') { body = G.mug.scene.clone(); body.scale.setScalar(1.6); }
  else body = new THREE.Mesh(buffGeo, new THREE.MeshLambertMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 0.6 }));
  body.position.y = 0.55;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.7, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(body, ring); g.position.set(x, 0, z);
  scene.add(g);
  buffDrops.push({ g, body, kind, t: 18 });
}
function updateBuffDrops(dt, time) {
  const p = player.obj.position;
  for (let i = buffDrops.length - 1; i >= 0; i--) {
    const d = buffDrops[i];
    d.t -= dt;
    d.body.rotation.y = time * 2; d.body.position.y = 0.55 + Math.sin(time * 3 + i) * 0.1;
    d.g.visible = d.t > 3 || Math.sin(time * 18) > 0;
    if (Math.hypot(p.x - d.g.position.x, p.z - d.g.position.z) < 0.9) { applyBuff(d.kind); d.t = 0; }
    if (d.t <= 0) { scene.remove(d.g); buffDrops.splice(i, 1); }
  }
}
function applyBuff(kind) {
  const b = BUFFS[kind];
  sfx.buff();
  if (kind === 'potion') heal(run.s.maxHp * 0.3);
  else if (kind === 'magnet') { for (const it of gems.items) it.pull = true; for (const it of coins.items) it.pull = true; }
  else run.buffs[kind] = b.dur;
  floatText(player.obj.position, `${b.icon} ${b.name}`, 'heal', 2.8);
  buffsDirty = true;
}

function heal(v, show = true) {
  if (!player || player.dead) return;
  const before = player.hp;
  player.hp = Math.min(run.s.maxHp, player.hp + v);
  if (show && player.hp - before >= 1) floatText(player.obj.position, '+' + Math.round(player.hp - before), 'heal');
}

// =====================================================
//  Savaş
// =====================================================
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const isActive = e => e.state === 'chase' || e.state === 'attack' || e.state === 'hit';

function nearestEnemies(pos, n, maxD) {
  const out = [];
  for (const e of enemies) {
    if (!isActive(e)) continue;
    const d = Math.hypot(e.obj.position.x - pos.x, e.obj.position.z - pos.z) - e.def.radius;
    if (d < maxD) out.push([d, e]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, n).map(x => x[1]);
}

function damageEnemy(e, dmg, dir, canCrit = true, knock = 7) {
  if (!isActive(e)) return;
  const crit = canCrit && (Math.random() < run.s.crit || TAL.talentForceCrit());
  if (crit) dmg *= run.s.critMult || 2;
  dmg *= TAL.talentDmgMult(e);
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; run.dmgDealt += dmg;
  SUP.superOnDealt(dmg);
  floatText(e.obj.position, crit ? dmg + '!' : String(dmg), crit ? 'crit' : '', e.def.boss ? 4.5 : 2.2);
  e.punch = 0.12;
  sfx.hit();
  if (!e.def.boss && dir) e.knock.copy(dir).multiplyScalar(e.def.light ? knock : knock * 0.4);
  if (e.hp <= 0) return killEnemy(e);
  if (e.def.light && e.state !== 'attack') {
    e.state = 'hit'; e.t = 0.22;
    play(e, 'Hit_A', true, 0.05, 1.8);
  }
}

function killEnemy(e) {
  const def = e.def, pos = e.obj.position;
  e.state = 'dead'; e.t = 1.7;
  play(e, 'Skeletons_Death', true, 0.05);
  run.kills++;
  if (!e.summoned) run.waveLeft = Math.max(0, run.waveLeft - 1);
  sfx.kill();
  if (!e.summoned) SUP.superOnKill(e);
  // Seri
  run.combo++; run.comboT = 2.5; run.bestCombo = Math.max(run.bestCombo, run.combo);
  comboPop = 0.12;
  if (run.combo % 25 === 0) { floatText(player.obj.position, `🔥 ${run.combo} SERİ!`, 'crit', 3); }
  emitGameEvent('kill', { elite: !!e.elite, boss: !!def.boss, combo: run.combo });
  // Kemik parçacıkları
  particles.emit(pos, def.boss ? 40 : e.elite ? 18 : 8, BONE_COL, def.boss ? 7 : 4.5);
  // Tecrübe taşı
  const xp = def.xp * (e.elite ? ELITE.xp : 1);
  gems.add(pos.x, pos.z, xp, gemCol(xp));
  // Altın
  const [chance, amount] = def.gold;
  if (def.boss) { for (let i = 0; i < 10; i++) coins.add(pos.x, pos.z, Math.ceil(amount / 10)); }
  else if (e.elite) { for (let i = 0; i < 3; i++) coins.add(pos.x, pos.z, amount); }
  else if (Math.random() < chance) coins.add(pos.x, pos.z, amount);
  // Sandık / süreli güçlendirme
  if (e.elite || (def.boss && !def.king)) { dropChest(pos.x, pos.z); freeze = Math.max(freeze, 0.07); }
  if (e.elite) run.eliteKills++;
  if (def.boss || Math.random() < BUFF_DROP_CHANCE) dropBuff(pos.x + 0.8, pos.z + 0.8);
  if (run.s.vamp) heal(run.s.vamp, false);
  if (def.boss) {
    run.bossKills++; run.boss = null; playMusic('savas');
    emitGameEvent('bossKill', { king: !!def.king, name: def.name });
    ui.bossWrap.classList.add('hidden');
    shake = 0.7; freeze = 0.25;
    particles.emit(pos, 40, GOLD_COL, 8);
    if (def.king) {
      banner('👑 Kemik Kral devrildi!', 3);
      // Kalan iskeletler toz olur; kuyrukta bekleyenler artık gelmez (zafer ekranı / sonsuz mod temiz başlasın)
      for (const o of enemies) if (o !== e && o.state !== 'dead') { o.summoned = true; killEnemyQuiet(o); }
      run.queue.length = 0; run.reinf.length = 0; run.waveLeft = 0; arenaGates.closeAll();
      if (bot) showVictory(); else setTimeout(showVictory, 2200);
    } else banner(`${def.name} devrildi!`, 2.5);
  }
}
function killEnemyQuiet(e) {
  e.state = 'dead'; e.t = 1.7; play(e, 'Skeletons_Death', true, 0.05);
  particles.emit(e.obj.position, 6, BONE_COL, 4);
}

// Hasar kaynağının adı (oyun sonu istatistiği için)
const srcName = e => (e.elite ? 'Elit ' : '') + (e.def ? e.def.name : 'Düşman');
function hurtPlayer(dmg, src = 'Bilinmeyen') {
  const p = player;
  if (p.dead || p.dashT > 0 || p.invuln > 0 || run.buffs.holy > 0) return;
  dmg = TAL.talentHurt(dmg); if (dmg <= 0) return;   // blok / kaçınma / mana kalkanı
  dmg = dmg * (1 - run.s.armor);
  // İstatistik: son vuran + kaynak bazında toplam hasar (grup = "—" öncesi ad)
  run.lastHit = { src, dmg };
  const grp = src.split(' — ')[0];
  run.dmgBy[grp] = (run.dmgBy[grp] || 0) + dmg;
  SUP.superOnHurt(dmg);
  p.hp -= dmg; p.invuln = 0.35; shake = Math.max(shake, 0.22);
  floatText(p.obj.position, '-' + Math.round(dmg), 'hurt');
  sfx.hurt();
  emitGameEvent('playerHurt', { dmg, hp: p.hp, maxHp: run.s.maxHp });
  ui.hurt.style.opacity = 1; setTimeout(() => ui.hurt.style.opacity = 0, 120);
  if (p.hp > 0) return;
  if (shopLv('revive') && !run.revived) {
    run.revived = true; p.hp = run.s.maxHp * 0.5; p.invuln = 2.5;
    banner('👼 İkinci Şans!', 2); sfx.buff();
    for (const e of enemies) {
      if (!isActive(e)) continue;
      tmpV.subVectors(e.obj.position, p.obj.position).setY(0);
      if (tmpV.length() < 6) damageEnemy(e, 30, tmpV.normalize(), false, 14);
    }
    spawnRingFx(p.obj.position, 6, 0xffe066);
    return;
  }
  p.dead = true; p.hp = 0;
  play(p, 'Death_A', true, 0.1);
  sfx.die(); playMusic('yenilgi');
  emitGameEvent('playerDeath', {});
  state = 'dying';
  if (bot) { bot.done = 'dead'; return; }
  setTimeout(endRun, 2000);
}

// --- Efektler ---
const slashGeo = new THREE.RingGeometry(0.35, 1, 28, 1, -1.15, 2.3).rotateX(-Math.PI / 2);
const slashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const slash = new THREE.Mesh(slashGeo, slashMat); slash.position.y = 0.9; scene.add(slash);
let slashT = 0;

const novaGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
function spawnRingFx(pos, radius, color) {
  const m = new THREE.Mesh(novaGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.set(pos.x, 0.15, pos.z); m.scale.setScalar(0.3);
  scene.add(m);
  fxList.push({ m, t: 0, dur: 0.4, radius });
}
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const k = f.t / f.dur;
    f.m.scale.setScalar(0.3 + (f.radius - 0.3) * Math.min(1, k * 1.4));
    f.m.material.opacity = 0.8 * (1 - k);
    if (k >= 1) { scene.remove(f.m); f.m.material.dispose(); fxList.splice(i, 1); }
  }
  if (slashT > 0) { slashT -= dt; slashMat.opacity = Math.max(0, slashT / 0.16) * 0.55; }
}

// --- Oyuncu ---
function updatePlayer(dt) {
  const p = player, o = p.obj, S = run.s;
  p.dashCd -= dt; p.invuln -= dt;
  if (p.dead) return;

  if (S.regen) heal(S.regen * dt, false);
  TAL.talentTick(dt);
  SUP.superTick(dt);   // çalışan Süper + meteor/ok efektleri

  const move = tmpV.set(0, 0, 0);
  let wantDash = keys.Space || keys.ShiftLeft || keys.ShiftRight;
  if (bot) { wantDash = botSteer(move); if (SUP.superReady() && botSuperOk()) SUP.superUse(null); }
  else {
    if (keys.KeyW || keys.ArrowUp) move.add(FWD);
    if (keys.KeyS || keys.ArrowDown) move.sub(FWD);
    if (keys.KeyD || keys.ArrowRight) move.add(RIGHT);
    if (keys.KeyA || keys.ArrowLeft) move.sub(RIGHT);
    // Dokunmatik joystick (ekranın sağı = RIGHT, ekranın yukarısı = FWD; analog)
    if (touch.active) { move.addScaledVector(RIGHT, touch.x); move.addScaledVector(FWD, -touch.y); }
    if (touch.consumeDash()) wantDash = true;
  }
  if (bot ? move.lengthSq() > 0 : move.lengthSq() > 1) move.normalize();
  if (!bot && touch.consumeSuper()) SUP.superUse(move);   // mobil ⚡ butonu
  if (SUP.superFreeze()) move.set(0, 0, 0);               // Gölge Dansı sırasında yerinde

  // Atılma
  if (wantDash && p.dashCd <= 0 && !SUP.superFreeze() && !SUP.superCharging()) {
    p.dashT = 0.17; p.dashCd = p.dashMax = TAL.talentDashCd(0.9); TAL.talentOnDash();
    p.dashDir.copy(move.lengthSq() ? move : tmpV2.set(Math.sin(o.rotation.y), 0, Math.cos(o.rotation.y)));
    sfx.dash();
  }

  const spd = S.speed * (run.buffs.haste > 0 ? 1.5 : 1);
  if (p.dashT > 0) { p.dashT -= dt; o.position.addScaledVector(p.dashDir, (SUP.superCharging() ? 27 : 17) * dt); }
  else o.position.addScaledVector(move, spd * dt);
  const r = Math.hypot(o.position.x, o.position.z);
  if (r > ARENA_R) o.position.multiplyScalar(ARENA_R / r);

  // Otomatik saldırı (kahramana göre)
  const atk = HEROES[run.hero].attack;
  p.atkTimer -= dt * (run.buffs.fury > 0 ? 2 : 1);
  if (p.atkTimer <= 0) {
    const [target] = nearestEnemies(o.position, 1, S.ranged ? S.range : S.range * 1.05);
    if (target) {
      p.swingA = Math.atan2(target.obj.position.x - o.position.x, target.obj.position.z - o.position.z);
      o.rotation.y = p.swingA; p.target = target;
      p.atkTimer = S.interval * TAL.talentIntervalMult(); p.lock = 0.3;
      p.combo = (p.combo + 1) % 2;
      if (atk === 'melee') { p.hitAt = 0.09; play(p, p.combo ? 'Melee_1H_Attack_Slice_Horizontal' : 'Melee_1H_Attack_Slice_Diagonal', true, 0.05, 2.3); sfx.swing(); }
      else if (atk === 'fast') { p.hitAt = 0.06; p.lock = 0.2; play(p, p.combo ? 'Melee_Dualwield_Attack_Slice' : 'Melee_Dualwield_Attack_Stab', true, 0.04, 2.8); sfx.swing(); }
      else if (atk === 'spin') { p.hitAt = 0.18; p.lock = 0.45; play(p, 'Melee_2H_Attack_Spin', true, 0.05, 1.7); sfx.swing(); }
      else if (atk === 'bolt') { p.shootAt = 0.14; play(p, 'Ranged_Magic_Shoot', true, 0.05, 2); }
      else if (atk === 'arrow') { p.shootAt = 0.1; play(p, 'Ranged_Bow_Release', true, 0.05, 1.8); }
    } else p.atkTimer = 0.05;
  }
  if (p.hitAt > 0) {
    p.hitAt -= dt;
    if (p.hitAt <= 0) {
      const fx = Math.sin(p.swingA), fz = Math.cos(p.swingA), all = atk === 'spin';
      let hits = 0;
      for (const e of enemies) {
        if (!isActive(e)) continue;
        tmpV2.subVectors(e.obj.position, o.position).setY(0);
        const dist = tmpV2.length() - e.def.radius;
        if (dist > S.range) continue;
        tmpV2.normalize();
        if (all || dist < 0.6 || tmpV2.x * fx + tmpV2.z * fz > 0.4) { damageEnemy(e, S.atkDmg, tmpV2.clone(), true, S.t.knock || 7); TAL.talentOnMeleeHit(e); hits++; }
      }
      TAL.talentOnSwing(hits, all);
      if (all) spawnRingFx(o.position, S.range, 0xffffff);
      else {
        slash.position.set(o.position.x, 0.9, o.position.z);
        slash.rotation.y = p.swingA - Math.PI / 2;
        slash.scale.setScalar(S.range);
        slashT = 0.16;
      }
    }
  }
  if (p.shootAt > 0) {
    p.shootAt -= dt;
    if (p.shootAt <= 0) {
      const t = p.target && isActive(p.target) ? p.target.obj.position : null;
      const dir = t ? new THREE.Vector3(t.x - o.position.x, 0, t.z - o.position.z).normalize() : new THREE.Vector3(Math.sin(p.swingA), 0, Math.cos(p.swingA));
      if (atk === 'bolt') fireShot({ kind: 'bolt', dir, speed: 13, dmg: S.atkDmg * 0.9, aoe: 1.4 * S.area, life: S.range / 13 + 0.2, chain: S.t.chain });
      else for (const a of TAL.talentArrowDirs(dir)) fireShot({ kind: 'arrow', dir: a.dir, speed: 24, dmg: S.atkDmg * 0.85 * a.k, pierce: 2 + Math.floor((run.up.area || 0) / 2) + (S.t.pierce || 0), life: S.range / 24 + 0.15 });
    }
  }

  // Yön ve animasyon
  if (p.lock > 0) { p.lock -= dt; turnTo(o, p.swingA, dt * 20); }
  else if (move.lengthSq() || p.dashT > 0) {
    const dir = p.dashT > 0 ? p.dashDir : move;
    turnTo(o, Math.atan2(dir.x, dir.z), dt * 14);
    play(p, 'Running_A', false, 0.12, p.dashT > 0 ? 1.6 : 1.1 * spd / 5);
  } else play(p, 'Idle_A', false, 0.2);

  holyBubble.visible = run.buffs.holy > 0;
  if (holyBubble.visible) holyBubble.material.opacity = 0.16 + Math.sin(performance.now() / 120) * 0.06;
}

// =====================================================
//  Test botu (denge ölçümü için oyunu kendi oynar)
// =====================================================
let bot = null;
// Bot Süper'i yakında ≥4 düşman ya da boss varken kullanır
function botSuperOk() {
  if (bot.noSuper) return false;
  const p = player.obj.position;
  let n = 0, boss = false;
  for (const e of enemies) {
    if (!isActive(e)) continue;
    const d = Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z);
    if (d < 9) n++;
    if (e.def.boss && d < 12) boss = true;
  }
  return n >= 4 || boss;
}
// Klavye / dokunmatik hareket girdisi (Süper yönü için; sıfır vektör = girdi yok)
function moveInput() {
  const v = new THREE.Vector3();
  if (keys.KeyW || keys.ArrowUp) v.add(FWD);
  if (keys.KeyS || keys.ArrowDown) v.sub(FWD);
  if (keys.KeyD || keys.ArrowRight) v.add(RIGHT);
  if (keys.KeyA || keys.ArrowLeft) v.sub(RIGHT);
  if (touch.active) { v.addScaledVector(RIGHT, touch.x); v.addScaledVector(FWD, -touch.y); }
  return v;
}
function botSteer(out) {
  const p = player.obj.position, S = run.s;
  const keep = S.ranged ? Math.min(5.5, S.range * 0.6) : Math.max(1.1, S.range * 0.55);   // düşmanlarla korunacak mesafe
  let nearest = null, nd = 1e9, danger = 0;
  for (const e of enemies) {
    if (e.state === 'dead') continue;
    const dx = p.x - e.obj.position.x, dz = p.z - e.obj.position.z, d = Math.hypot(dx, dz) || 0.01;
    const r = e.def.radius * e.baseScale;
    if (isActive(e) && d < nd) { nd = d; nearest = e; }
    const k = e.def.boss ? 2.5 : 1;
    if (d < keep + r) { const f = k * (keep + r - d) / d; out.x += dx * f; out.z += dz * f; }
    if (d < r + 1.0 && e.state !== 'phase') danger++;
  }
  danger += bossDanger(p, out);   // boss uyarı alanları, şok halkaları, boss mermileri
  for (const o of orbs) {
    const dx = p.x - o.m.position.x, dz = p.z - o.m.position.z, d = Math.hypot(dx, dz) || 0.01;
    if (d < 3) { const side = o.vel.x * dz - o.vel.z * dx > 0 ? 1 : -1; out.x += -o.vel.z * side * 0.4 / d; out.z += o.vel.x * side * 0.4 / d; }
  }
  // Uzaktaysa en yakın düşmana yaklaş (saldırabilmek için)
  if (nearest && nd > (S.ranged ? S.range * 0.85 : S.range * 0.9 + nearest.def.radius)) { out.x -= (p.x - nearest.obj.position.x) / nd * 0.6; out.z -= (p.z - nearest.obj.position.z) / nd * 0.6; }
  // Yakındaki taş, sandık ve iksirlere yönel
  let gd = 1e9, gx = 0, gz = 0;
  for (const it of gems.items) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < gd) { gd = d; gx = it.x; gz = it.z; } }
  for (const c of chests) { const d = Math.hypot(c.g.position.x - p.x, c.g.position.z - p.z) * 0.5; if (d < gd) { gd = d; gx = c.g.position.x; gz = c.g.position.z; } }
  if (gd < 7 && danger === 0) { out.x += (gx - p.x) / (gd || 1) * 0.8; out.z += (gz - p.z) / (gd || 1) * 0.8; }
  // Duvardan uzak dur
  const r = Math.hypot(p.x, p.z);
  if (r > ARENA_R - 4) { out.x -= p.x / r * (r - ARENA_R + 4) * 0.6; out.z -= p.z / r * (r - ARENA_R + 4) * 0.6; }
  if (out.lengthSq() < 0.05) out.set(0, 0, 0);
  bot.dangerT = (bot.dangerT || 0) + (danger ? 1 : 0);
  return danger >= 2;
}
// Bot güçlendirme seçimi: evrim > silahlar > hasar/hız > diğerleri
const BOT_PRIORITY = ['dmg', 'aspd', 'dagger', 'orbit', 'nova', 'hp', 'crit', 'regen', 'area', 'speed', 'vamp', 'magnet'];
function botPick(list) {
  let best = 0, bs = -1;
  list.forEach((u, i) => {
    const s = u.evo ? 100 : u.id.startsWith('_') ? 0 : 50 - BOT_PRIORITY.indexOf(u.id) * 3 + Math.random() * 8;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

// --- Düşman ---
// Boss saldırıları bosses.js'te; oyunun iç fonksiyonlarını ona bağlam olarak veriyoruz
initBosses({
  scene, ARENA_R, player: () => player, enemies: () => enemies, cap: () => Q.cap,
  alive: () => enemies.reduce((n, x) => n + (x.state !== 'dead' ? 1 : 0), 0),
  reinforce: (n, elites) => queueReinforce(n, elites), wave: () => run.wave,
  hurt: (d, atk) => hurtPlayer(d, (run && run.boss ? run.boss.def.name : 'Boss') + (atk ? ' — ' + atk : '')), shake: v => { shake = Math.max(shake, v); }, banner, play, turnTo, spawnEnemy,
  ringFx: spawnRingFx, burst: (p, n, c, s) => particles.emit(p, n, c, s),
});
function updateEnemy(e, dt) {
  const o = e.obj, po = player.obj.position;
  const d = tmpV.subVectors(po, o.position).setY(0);
  const dist = d.length(); d.normalize();
  e.t -= dt; e.cd -= dt;

  o.position.addScaledVector(e.knock, dt);
  e.knock.multiplyScalar(Math.max(0, 1 - dt * 8));
  if (e.punch > 0) e.punch -= dt;
  const pk = Math.max(0, e.punch) / 0.12;
  o.scale.set(e.baseScale * (1 + pk * 0.18), e.baseScale * (1 - pk * 0.12), e.baseScale * (1 + pk * 0.18));
  if (e.def.ai && updateBoss(e, dt)) return;   // boss'lar kendi saldırı desenleriyle (bosses.js)

  switch (e.state) {
    case 'spawn': if (e.t <= 0) e.state = 'chase'; break;
    case 'enter':   // kapıdan içeri yürüyüş (gates.js) — arena sınırı uygulanmaz
      if (e.gateWait > 0) play(e, 'Skeletons_Idle', false, 0.2);   // kapıda bekleyen: idle
      else play(e, e.def.walk, false, 0.2, e.def.walkAnim);
      if (arenaGates.enterStep(e, dt)) { e.state = 'chase'; if (e.def.boss) { shake = Math.max(shake, 0.6); sfx.slam(); } }
      break;
    case 'hit': if (e.t <= 0) e.state = 'chase'; break;
    case 'dead':
      if (e.t < 0.8) o.position.y -= dt * 1.4;
      if (e.t <= 0) { e.removed = true; releaseEnemy(e); }
      break;
    case 'attack':   // normal iskeletler (boss saldırıları bosses.js'te)
      e.el += dt;
      if (!e.hitDone && e.el >= e.hitTime) {
        e.hitDone = true;
        if (e.def.ranged) fireOrb(e);
        else if (dist < e.def.reach + 0.6) hurtPlayer(e.dmg, srcName(e));
      }
      if (e.t <= 0) e.state = 'chase';
      break;
    case 'chase': {
      if (player.dead) { play(e, 'Skeletons_Taunt', false, 0.3); break; }
      turnTo(o, Math.atan2(d.x, d.z), dt * 8);
      let want = 0;
      if (e.def.ranged) {
        if (dist > 9) want = 1; else if (dist < 5) want = -1;
        if (e.cd <= 0 && dist < 12) { startAttack(e, 'Throw', 0.45, 1.2, 2.6); break; }
      } else {
        if (dist > e.def.reach) want = 1;
        else if (e.cd <= 0) { startAttack(e, 'Melee_1H_Attack_Chop', 0.45, 1.3, 1.4 + Math.random() * 0.6); break; }
      }
      if (want) { o.position.addScaledVector(d, want * e.def.speed * dt); play(e, e.def.walk, false, 0.2, e.def.walkAnim); }
      else play(e, 'Skeletons_Idle', false, 0.2);
      break;
    }
  }
  const r = Math.hypot(o.position.x, o.position.z);
  if (r > ARENA_R + 0.5 && e.state !== 'enter') o.position.multiplyScalar((ARENA_R + 0.5) / r);
}
function startAttack(e, clip, hitFrac, speed, cd) {
  const dur = play(e, clip, true, 0.1, speed) || 1;
  e.state = 'attack'; e.t = dur; e.el = 0; e.hitTime = dur * hitFrac; e.hitDone = false; e.cd = cd;
}

// Büyücü mermisi
const orbGeo = new THREE.SphereGeometry(0.28, 12, 10);
const orbMat = new THREE.MeshBasicMaterial({ color: 0xb46bff });
function fireOrb(e) {
  const m = new THREE.Mesh(orbGeo, orbMat);
  m.position.copy(e.obj.position).setY(1.3);
  const vel = new THREE.Vector3().subVectors(player.obj.position, e.obj.position).setY(0).normalize().multiplyScalar(8);
  scene.add(m);
  orbs.push({ m, vel, life: 3, dmg: e.dmg, src: srcName(e) + ' — Büyü Topu' });
}
function updateOrbs(dt) {
  const pp = player.obj.position;
  for (let i = orbs.length - 1; i >= 0; i--) {
    const p = orbs[i];
    p.life -= dt; p.m.position.addScaledVector(p.vel, dt);
    p.m.scale.setScalar(1 + Math.sin(p.life * 20) * 0.15);
    if (!player.dead && Math.hypot(p.m.position.x - pp.x, p.m.position.z - pp.z) < 0.7) { hurtPlayer(p.dmg, p.src); p.life = 0; }
    if (p.life <= 0) { scene.remove(p.m); orbs.splice(i, 1); }
  }
}

// =====================================================
//  Ek silahlar (geliştirmelerle açılır)
// =====================================================
function updateWeapons(dt) {
  const u = run.up, S = run.s, pp = player.obj.position;
  if (player.dead) return;

  // Hançer Yağmuru (evrim: Ölüm Fırtınası)
  if (u.dagger) {
    const storm = run.evo.storm;
    run.daggerT -= dt;
    if (run.daggerT <= 0) {
      run.daggerT = 1.6 / (1 + 0.12 * (u.dagger - 1)) / (storm ? 2 : 1);
      const targets = nearestEnemies(pp, u.dagger + (storm ? 3 : 0) + (S.t.blades || 0), 13);
      const dmg = 8 * (1 + 0.2 * (u.dagger - 1)) * S.dmgMult;
      targets.forEach((t, i) => setTimeout(() => {
        if (!run || player.dead || !isActive(t)) return;
        const dir = new THREE.Vector3(t.obj.position.x - player.obj.position.x, 0, t.obj.position.z - player.obj.position.z).normalize();
        fireShot({ kind: 'dagger', dir, speed: 17, dmg, pierce: storm ? 99 : 2, life: storm ? 1.3 : 0.9, knock: 4 });
      }, i * 60));
    }
  }
  updateShots(dt);

  // Dönen Kalkanlar (evrim: Kutsal Siper)
  const n = u.orbit || 0;
  while (orbitMeshes.length < n) {
    const g = new THREE.Group(); const s = G.orbShield.scene.clone(); s.scale.setScalar(1.3); g.add(s); scene.add(g); orbitMeshes.push(g);
  }
  if (n) {
    const aegis = run.evo.aegis;
    run.orbitA += dt * 3.2;
    const R = aegis ? 2.6 : 2.1, dmg = 7 * (1 + 0.15 * (n - 1)) * S.dmgMult * (aegis ? 2 : 1), hitR = aegis ? 0.85 : 0.55;
    orbitMeshes.forEach((g, i) => {
      const a = run.orbitA + i * Math.PI * 2 / n;
      g.position.set(pp.x + Math.cos(a) * R, 0.9, pp.z + Math.sin(a) * R);
      g.rotation.y = -a;
      g.scale.setScalar(aegis ? 1.5 : 1);
      for (const e of enemies) {
        if (!isActive(e) || e.orbitCd > performance.now()) continue;
        if (Math.hypot(e.obj.position.x - g.position.x, e.obj.position.z - g.position.z) < e.def.radius + hitR) {
          e.orbitCd = performance.now() + 450;
          damageEnemy(e, dmg, tmpV2.subVectors(e.obj.position, pp).setY(0).normalize().clone(), true, 9);
        }
      }
      if (aegis) {
        for (const o of orbs) if (o.life > 0 && Math.hypot(o.m.position.x - g.position.x, o.m.position.z - g.position.z) < 0.9) {
          o.life = 0; particles.emit(o.m.position, 5, MAGIC_COL, 3);
        }
        if (destroyBulletsNear(g.position.x, g.position.z, 0.9)) particles.emit(g.position, 4, MAGIC_COL, 3);   // boss mermileri de
      }
    });
  }

  // Kutsal Dalga (evrim: İlahi Patlama)
  if (u.nova) {
    const sun = run.evo.sun;
    run.novaT -= dt;
    if (run.novaT <= 0) {
      run.novaT = 4.2 - 0.45 * (u.nova - 1);
      const R = (3.2 + 0.35 * u.nova) * (sun ? 1.6 : 1), dmg = 14 * (1 + 0.25 * (u.nova - 1)) * S.dmgMult * (sun ? 2 : 1);
      for (const e of enemies) {
        if (!isActive(e)) continue;
        tmpV2.subVectors(e.obj.position, pp).setY(0);
        if (tmpV2.length() - e.def.radius < R) damageEnemy(e, dmg, tmpV2.normalize().clone(), true, 10);
      }
      if (sun) heal(4);
      spawnRingFx(pp, R, sun ? 0xffb02e : 0xffe58a); sfx.nova();
    }
  }
}

// --- Oyuncu mermileri: hançer, ok, büyü topu ---
const boltGeo = new THREE.SphereGeometry(0.26, 12, 10);
const boltMat = new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
function fireShot(o) {
  const pp = o.from || player.obj.position;   // from: sekme büyüleri için başlangıç noktası
  const g = new THREE.Group();
  if (o.kind === 'bolt') { const b = new THREE.Mesh(boltGeo, boltMat); if (o.small) b.scale.setScalar(0.6); g.add(b); }
  else {
    const m = (o.kind === 'arrow' ? G.arrow : G.dagger).scene.clone();
    // Hançer modeli dik (+Y), ok modeli zaten yatay (+Z) tasarlanmış
    if (o.kind !== 'arrow') m.rotation.x = Math.PI / 2;
    m.scale.setScalar(o.kind === 'arrow' ? 1.1 : 1.4);
    g.add(m);
  }
  g.position.set(pp.x + o.dir.x * 0.5, 1.0, pp.z + o.dir.z * 0.5);
  g.rotation.y = Math.atan2(o.dir.x, o.dir.z);
  scene.add(g);
  shots.push({ g, kind: o.kind, vel: o.dir.clone().multiplyScalar(o.speed), dir: o.dir.clone(), life: o.life, dmg: o.dmg,
               pierce: o.pierce || 1, aoe: o.aoe || 0, knock: o.knock || 5, hit: new Set(), chain: o.chain || 0 });
  if (o.kind === 'bolt') sfx.nova(); else sfx.dagger();
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.life -= dt; s.g.position.addScaledVector(s.vel, dt);
    if (s.kind === 'bolt') s.g.scale.setScalar(1 + Math.sin(s.life * 30) * 0.15);
    let boom = false;
    for (const e of enemies) {
      if (!isActive(e) || s.hit.has(e)) continue;
      if (Math.hypot(e.obj.position.x - s.g.position.x, e.obj.position.z - s.g.position.z) < e.def.radius * e.baseScale + 0.35) {
        if (s.aoe) { boom = true; break; }
        s.hit.add(e);
        damageEnemy(e, s.dmg, s.dir, true, s.knock);
        if (s.hit.size >= s.pierce) { s.life = 0; break; }
      }
    }
    if (s.aoe && (boom || s.life <= 0)) {
      const c = s.g.position;
      for (const e of enemies) {
        if (!isActive(e)) continue;
        tmpV2.set(e.obj.position.x - c.x, 0, e.obj.position.z - c.z);
        if (tmpV2.length() - e.def.radius < s.aoe) damageEnemy(e, s.dmg, tmpV2.normalize().clone(), true, 6);
      }
      spawnRingFx(c, s.aoe, 0x7fdcff); particles.emit(c, 6, MAGIC_COL, 3);
      if (s.chain) TAL.talentChain(c, s);   // Zincirleme Büyü
      s.life = 0;
    }
    if (s.life <= 0) { scene.remove(s.g); shots.splice(i, 1); }
  }
}

// Düşmanlar üst üste binmesin
function separate() {
  const pp = player.obj.position;
  for (let i = 0; i < enemies.length; i++) {
    const A = enemies[i]; if (A.state === 'dead') continue;
    const a = A.obj.position;
    for (let j = i + 1; j < enemies.length; j++) {
      const B = enemies[j]; if (B.state === 'dead') continue;
      const b = B.obj.position, min = A.def.radius + B.def.radius;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < min) {
        const push = (min - d) / 2 / d;
        const wa = A.def.boss ? 0.1 : 1, wb = B.def.boss ? 0.1 : 1;
        a.x -= dx * push * wa; a.z -= dz * push * wa; b.x += dx * push * wb; b.z += dz * push * wb;
      }
    }
    const min = A.def.radius + 0.4, dx = a.x - pp.x, dz = a.z - pp.z, d = Math.hypot(dx, dz);
    if (d > 0 && d < min) { const push = (min - d) / d; a.x += dx * push; a.z += dz * push; }
  }
}

// =====================================================
//  Dalgalar
// =====================================================
function pickType(w) {
  const opts = [['minion', 5]];
  if (w >= 2) opts.push(['warrior', 1.5 + w * 0.25]);
  if (w >= 3) opts.push(['rogue', 2.5]);
  if (w >= 4) opts.push(['mage', 1.2 + w * 0.1]);
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const [t, wt] of opts) { r -= wt; if (r <= 0) return t; }
  return 'minion';
}
function startWave() {
  run.wave++;
  const w = run.wave, final = w === FINAL_WAVE, boss = !final && w % 5 === 0;
  run.queue = [];
  if (final) {
    run.queue.push({ t: 'king' });
    for (let i = 0; i < 12; i++) run.queue.push({ t: pickType(w) });
  } else if (boss) {
    run.queue.push({ t: ['boss', 'necro', 'shade'][(w / 5 - 1) % 3] });   // 5: Kemik Devi, 10: Nekromant, 15: Gölge Haydut
    for (let i = 0; i < 4 + w * 2; i++) run.queue.push({ t: pickType(w) });
  } else {
    const n = 5 + w * 3;
    for (let i = 0; i < n; i++) run.queue.push({ t: pickType(w) });
    // Elitler (sandık düşürür): çift dalgalarda 1 tane (Dalga 4'ten itibaren), Dalga 14'ten sonra 2 tane
    const elites = w >= 4 && w % 2 === 0 ? (w >= 14 ? 2 : 1) : 0;
    for (let i = 0; i < elites; i++) {
      const at = Math.floor(run.queue.length * (0.3 + 0.6 * (i + 1) / (elites + 1)));
      run.queue.splice(at, 0, { t: w >= 6 && Math.random() < 0.5 ? 'warrior' : pickType(w) === 'mage' ? 'warrior' : 'minion', elite: true });
    }
  }
  run.waveLeft = run.queue.length;
  arenaGates.pickWave(w, boss || final, player.obj.position);   // bu dalganın kapıları açılır
  run.waveT = 0;
  run.spawnT = boss || final ? 0.8 : 0.15;
  setText(ui.wave, run.endless ? `Dalga ${w} ∞` : `Dalga ${w} / ${FINAL_WAVE}`);
  if (final) { banner('SON DALGA · Kemik Kral!', 3); sfx.boss(); }
  else banner(boss ? `Dalga ${w} · BOSS!` : `Dalga ${w}`, 2);
  emitGameEvent('waveStart', { wave: w, boss, final });
}
// Boss takviyeleri: dalga kuyruğundan ayrı (summoned → run.waveLeft'i bozmaz), kapılardan gelir
function queueReinforce(n, elites = 0) {
  const w = run.wave;
  for (let i = 0; i < n; i++) run.reinf.push({ t: pickType(w), elite: i < elites });
  run.reinfSpawnT = Math.min(run.reinfSpawnT, 0.8);
}
function updateReinforce(dt) {
  const w = run.wave;
  if (!run.boss || run.boss.state === 'dead') { run.reinf.length = 0; return; }
  // Boss hayattayken düşük yoğunlukta sürekli takviye: sahada (boss/kopya hariç) az düşman varsa 1-2 düşman
  run.reinfT -= dt;
  if (run.reinfT <= 0) {
    run.reinfT = 4;
    let n = 0; for (const e of enemies) if (e.state !== 'dead' && !e.def.boss && !e.def.ai) n++;
    if (n < REINF_MIN + Math.floor(w / 4) && !run.reinf.length) queueReinforce(w >= 10 ? 2 : 1);
  }
  if (run.reinf.length) {
    run.reinfSpawnT -= dt;
    let alive = 0; for (const e of enemies) if (e.state !== 'dead') alive++;
    if (run.reinfSpawnT <= 0 && alive < Q.cap - 1) {
      const q = run.reinf.shift();
      spawnEnemy(q.t, { elite: q.elite, summoned: true });
      run.reinfSpawnT = 0.45;
    }
  }
}
const REINF_MIN = 5;
const WAVE_OVERLAP = 40;  // bir dalga bu kadar saniyeden uzun sürerse sonraki dalga beklemeden gelir
function updateWaves(dt) {
  run.waveT += dt;
  updateReinforce(dt);
  // Yavaş temizleyen oyuncuya baskı: süre dolunca sıradaki dalga üst üste biner (boss dalgalarında değil)
  if (!run.queue.length && run.waveT > WAVE_OVERLAP && run.wave < FINAL_WAVE - 1 && !run.boss && enemies.some(e => e.state !== 'dead')) {
    startWave();
    return;
  }
  if (run.queue.length) {
    run.spawnT -= dt;
    let alive = 0; for (const e of enemies) if (e.state !== 'dead') alive++;
    if (run.spawnT <= 0 && alive < Q.cap) {
      const q = run.queue.shift();
      spawnEnemy(q.t, { elite: q.elite });
      run.spawnT = Math.max(0.22, 0.9 - run.wave * 0.05);
      if (!run.queue.length) arenaGates.closeAll();   // akın bitti → parmaklıklar iner
    }
  } else if (run.wave === FINAL_WAVE && !run.won) {
    // Son dalga: Kemik Kral ölene kadar devam
  } else if (!enemies.some(e => e.state !== 'dead')) {
    if (run.breakT <= 0) {
      run.breakT = 1.0;   // dalgalar arası kısa mola (kullanıcı isteği: beklemek sıkıcı)
      heal(run.s.maxHp * 0.15);
      for (const it of gems.items) it.pull = true;
      for (const it of coins.items) it.pull = true;
      banner('Dalga temizlendi!', 1.2);
    }
    run.breakT -= dt;
    if (run.breakT <= 0) startWave();
  }
}

// =====================================================
//  Seviye atlama
// =====================================================
function gainXp(v) {
  run.xp += v * run.s.xpMult;
  while (run.xp >= run.xpNeed) {
    run.xp -= run.xpNeed; run.level++; run.xpNeed = xpFor(run.level); run.pending++;
    emitGameEvent('levelUp', { level: run.level });
  }
  if (run.pending && state === 'play') openLevelUp();
}

// Evrimi hazır silahlar
const evoReady = () => EVOS.filter(ev => !run.evo[ev.id] && (run.up[ev.base] || 0) >= 5 && (run.up[ev.req] || 0) >= 1);
const evoChoice = ev => ({ id: 'evo:' + ev.id, icon: ev.icon, name: ev.name, evo: ev, desc: () => ev.desc });
const FILLERS = [
  { id: '_gold', icon: '🪙', name: 'Altın Kesesi', desc: () => '+25 altın' },
  { id: '_heal', icon: '🧪', name: 'Tam Şifa', desc: () => 'Canını tamamen doldurur' },
];
function randomUpgrades(n) {
  const avail = UPGRADES.filter(u => (run.up[u.id] || 0) < u.max);
  for (let i = avail.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [avail[i], avail[j]] = [avail[j], avail[i]]; }
  return avail.slice(0, n);
}
function applyChoice(u) {
  if (u.id === '_gold') run.gold += 25;
  else if (u.id === '_heal') heal(run.s.maxHp);
  else if (u.evo) {
    run.evo[u.evo.id] = true; run.evos++;
    banner(`🌟 EVRİM: ${u.evo.name}!`, 2.5); sfx.evo();
    spawnRingFx(player.obj.position, 5, 0xffd23f); particles.emit(player.obj.position, 30, GOLD_COL, 6);
  } else {
    run.up[u.id] = (run.up[u.id] || 0) + 1;
    recompute();
    if (u.id === 'hp') heal(25);
  }
  renderUpgradeBar();
}

let choices = [];
function rollChoices() {
  choices = randomUpgrades(3);
  const ev = evoReady();
  if (ev.length) choices[0] = evoChoice(ev[0]);   // evrim hazırsa ilk kartta her zaman çıkar
  if (choices.length === 0) choices = FILLERS.slice();
  const box = $('choices');
  box.innerHTML = '';
  choices.forEach((u, i) => {
    const lv = run.up[u.id] || 0;
    const b = document.createElement('button');
    b.className = 'choice' + (u.evo ? ' evo' : lv === 0 ? ' new' : lv >= 3 ? ' r-epic' : '');   // nadirlik: sıradan / nadir(yeni) / epik(Sv.4+) / efsanevi(evrim)
    const tag = u.evo ? 'EVRİM!' : u.id.startsWith('_') ? '' : lv === 0 ? 'YENİ' : `Sv. ${lv} → ${lv + 1}`;
    b.innerHTML = `<span class="ic">${u.icon}</span><span class="nm">${u.name}</span>
      <span class="lv">${tag}</span><span class="ds">${u.desc(lv)}</span><span class="key">[${i + 1}]</span>`;
    b.onclick = () => pickChoice(i);
    box.appendChild(b);
  });
  $('rerollN').textContent = run.rerolls;
  $('rerollBtn').disabled = run.rerolls <= 0;
}
function openLevelUp() {
  if (bot) {
    while (run.pending > 0) { rollChoices(); applyChoice(choices[botPick(choices)]); run.pending--; }
    return;
  }
  state = 'levelup';
  for (const k in keys) keys[k] = false;
  $('luLevel').textContent = run.level - run.pending + 1;
  rollChoices();
  ui.levelUp.classList.remove('hidden');
  sfx.level();
  spawnRingFx(player.obj.position, 3, 0x4fe39a); particles.emit(player.obj.position, 14, GEM_COL[0], 4);
}
function pickChoice(i) {
  const u = choices[i]; if (!u || state !== 'levelup') return;
  sfx.click();
  applyChoice(u);
  run.pending--;
  if (run.pending > 0) { $('luLevel').textContent = run.level - run.pending + 1; rollChoices(); return; }
  ui.levelUp.classList.add('hidden');
  state = 'play';
}
function reroll() { if (state !== 'levelup' || run.rerolls <= 0) return; run.rerolls--; sfx.click(); rollChoices(); }
$('rerollBtn').onclick = reroll;

function renderUpgradeBar() {
  const evoOf = id => EVOS.find(ev => ev.base === id && run.evo[ev.id]);
  ui.upBar.innerHTML = UPGRADES.filter(u => run.up[u.id]).map(u => {
    const ev = evoOf(u.id);
    return `<div class="upg${ev ? ' evolved' : ''}" title="${ev ? ev.name : u.name}">${ev ? ev.icon : u.icon}<i>${ev ? '★' : run.up[u.id]}</i></div>`;
  }).join('');
}

// =====================================================
//  Hazine sandığı açma
// =====================================================
let chestRewards = [], chestTimer = 0;
function openChest() {
  state = 'chest';
  for (const k in keys) keys[k] = false;
  sfx.chest();
  // Ödüller: evrim hazırsa evrim; değilse 1 (bazen 3) güçlendirme + altın
  const ev = evoReady();
  if (ev.length) chestRewards = [evoChoice(ev[0])];
  else chestRewards = randomUpgrades(Math.random() < 0.12 ? 3 : 1);
  if (!chestRewards.length) chestRewards = [FILLERS[1]];
  const gold = Math.round((10 + Math.random() * 20) * run.s.goldMult);
  chestRewards.push({ id: '_chestgold', icon: '🪙', name: `+${gold} altın`, gold, desc: () => '' });
  if (bot) { for (const r of chestRewards) { if (r.gold) run.gold += r.gold; else applyChoice(r); } state = 'play'; return; }
  const reel = $('chestReel'), list = $('chestRewards'), btn = $('chestBtn');
  list.innerHTML = ''; btn.classList.add('hidden');
  reel.classList.add('spin');
  const icons = UPGRADES.map(u => u.icon).concat(EVOS.map(e => e.icon), ['🪙', '💎']);
  ui.chest.classList.remove('hidden');
  clearInterval(chestTimer);
  let n = 0;
  chestTimer = setInterval(() => {
    reel.textContent = icons[(Math.random() * icons.length) | 0];
    if (++n % 3 === 0) sfx.click();
    if (n >= 16) {
      clearInterval(chestTimer);
      reel.classList.remove('spin');
      reel.textContent = chestRewards[0].icon;
      list.innerHTML = rows(chestRewards.map(r => [`${r.icon} ${r.name}`, r.evo ? 'EVRİM!' : r.gold ? '' : (run.up[r.id] || 0) === 0 ? 'YENİ' : `Sv. ${(run.up[r.id] || 0) + 1}`]));
      btn.classList.remove('hidden');
      sfx.buff();
    }
  }, 75);
}
function collectChest() {
  if (state !== 'chest' || $('chestBtn').classList.contains('hidden')) return;
  sfx.click();
  for (const r of chestRewards) { if (r.gold) run.gold += r.gold; else applyChoice(r); }
  ui.chest.classList.add('hidden');
  state = 'play';
  if (run.pending) openLevelUp();
}
$('chestBtn').onclick = collectChest;

// =====================================================
//  Koşu başlat / bitir
// =====================================================
function clearWorld() {
  TAL.talentReset();
  SUP.superReset();
  arenaGates.reset();
  for (const e of enemies) releaseEnemy(e);
  enemies = [];
  for (const o of orbs) scene.remove(o.m); orbs = [];
  for (const s of shots) scene.remove(s.g); shots = [];
  for (const d of buffDrops) scene.remove(d.g); buffDrops = [];
  for (const f of fxList) scene.remove(f.m); fxList = [];
  clearBossFx();
  for (const g of orbitMeshes) scene.remove(g); orbitMeshes = [];
  for (const c of chests) scene.remove(c.g); chests = [];
  gems.clear(); coins.clear(); particles.clear();
  for (const f of floats) { f.el.style.opacity = 0; floatPool.push(f.el); } floats.length = 0;
  ui.bossWrap.classList.add('hidden'); ui.combo.classList.add('hidden');
  clearInterval(chestTimer);
}

function startRun() {
  initAudio(); playMusic('savas'); sfx.start?.();
  clearWorld();
  if (!save.heroes[save.hero]) save.hero = 'knight';
  setHero(save.hero);
  setSilhouette(player, false);   // menüde kilitliyken siluet olup koşu sırasında açılan kahraman siyah kalmasın
  run = newRun();
  const H = HEROES[run.hero];
  for (const k in H.start || {}) run.up[k] = H.start[k];
  recompute();
  player.hp = run.s.maxHp;
  renderUpgradeBar(); buffsDirty = true;
  for (const el of [ui.menu, ui.over, ui.pause, ui.levelUp, ui.chest, ui.victory]) el.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.hint.style.opacity = 0.85; hintT = document.body.classList.contains('touch') ? 4 : 9;   // telefonda kısa göster
  state = 'play';
  startWave();
}

// Görevler: kayıtlı istatistik + (bitmemiş koşunun) canlı değerleri
function liveStats() {
  const s = save.stats;
  if (!run || run.counted) return s;
  return { ...s, totalKills: s.totalKills + run.kills, bestWave: Math.max(s.bestWave, run.wave), bossKills: s.bossKills + run.bossKills,
           wins: s.wins + (run.won ? 1 : 0), bestLevel: Math.max(s.bestLevel, run.level), evolutions: s.evolutions + run.evos,
           eliteKills: s.eliteKills + run.eliteKills, bestCombo: Math.max(s.bestCombo, run.bestCombo) };
}
function rewardText(r) { return r.hero ? `${HEROES[r.hero].icon} ${HEROES[r.hero].name} açılır` : `🪙 ${r.gold} altın`; }
function checkQuests() {
  const st = liveStats();
  let any = false;
  for (const q of QUESTS) {
    if (save.quests[q.id] || (st[q.stat] || 0) < q.n) continue;
    save.quests[q.id] = true; any = true;
    if (q.reward.gold) save.gold += q.reward.gold;
    if (q.reward.hero) save.heroes[q.reward.hero] = true;
    if (run) run.newQuests.push(q);
    toast(`✅ Görev tamamlandı: ${q.text} → ${rewardText(q.reward)}`);
    sfx.quest();
  }
  if (any) persist();
  updateQuestBadge();
}
function updateQuestBadge() {
  const left = QUESTS.filter(q => !save.quests[q.id]).length;
  const b = $('questBadge');
  b.textContent = left; b.classList.toggle('hidden', left === 0);
}

function showVictory() {
  if (!run || player.dead) return;
  run.won = true;
  emitGameEvent('victory', {});
  if (bot) { bot.done = 'win'; return; }
  state = 'victory';
  for (const k in keys) keys[k] = false;
  sfx.victory(); playMusic('zafer');
  const bonus = Math.round(150 * run.s.goldMult);
  run.gold += bonus;
  $('victoryStats').innerHTML = rows([['Süre', fmtTime(run.time)], ['Devrilen iskelet', run.kills]])
    + more([['Kahraman', `${HEROES[run.hero].icon} ${HEROES[run.hero].name}`], ['Seviye', run.level], ['En uzun seri', run.bestCombo]]);
  $('victoryGold').innerHTML = `🪙 Zafer bonusu +${bonus} altın`;
  ui.victory.classList.remove('hidden');
  checkQuests();
}
$('endlessBtn').onclick = () => {
  sfx.click();
  run.endless = true;
  ui.victory.classList.add('hidden');
  state = 'play';
  banner('∞ Sonsuz mod', 2); playMusic('savas');
  run.breakT = 0;
};
$('victoryEndBtn').onclick = () => { sfx.click(); ui.victory.classList.add('hidden'); endRun(); };

// Oyun sonu: son vuran + en çok hasarı verenler (ilk 4, yüzdeyle)
function damageRows() {
  const out = [];
  if (run.lastHit && !run.won) out.push(['💀 Son vuran', `${run.lastHit.src} · ${Math.round(run.lastHit.dmg)} hasar`]);
  const list = Object.entries(run.dmgBy).sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, x) => s + x[1], 0);
  if (total > 0) {
    out.push(['🩸 Alınan toplam hasar', Math.round(total).toLocaleString('tr-TR')]);
    list.slice(0, 4).forEach(([k, v], i) => out.push([`${i === 0 ? '🥇' : '·'} ${k}`, `${Math.round(v)} (%${Math.round(v / total * 100)})`]));
  }
  return out;
}

function endRun() {
  if (!run || run.counted) return;
  const bonus = Math.round(run.wave * 2 * run.s.goldMult);
  const earned = run.gold + bonus;
  save.gold += earned;
  const st = save.stats;
  const newBest = run.wave > st.bestWave;
  Object.assign(st, liveStats());
  st.runs++; st.goldEarned += earned;
  st.bestKills = Math.max(st.bestKills, run.kills); st.bestTime = Math.max(st.bestTime, run.time);
  run.counted = true;
  persist();
  checkQuests();
  ui.over.querySelector('h2').textContent = run.won ? '👑 Zafer kaydedildi!' : 'Düştün!';
  // Temel bilgiler görünür; geri kalanı "Ayrıntılar" altında (ekran kısa kalsın, kaydırma gerekmesin)
  $('overStats').innerHTML = rows([
    ['Ulaşılan dalga', run.wave + (newBest ? ' 🏆' : '')], ['Süre', fmtTime(run.time)], ['Devrilen iskelet', run.kills],
  ]) + more([
    ['Kahraman', `${HEROES[run.hero].icon} ${HEROES[run.hero].name}`], ['Seviye', run.level], ['En uzun seri', run.bestCombo],
    ['Verilen toplam hasar', Math.round(run.dmgDealt).toLocaleString('tr-TR')], ['Altın', `toplanan ${run.gold} + dalga bonusu ${bonus}`],
  ].concat(damageRows()));
  $('overGold').innerHTML = `🪙 +${earned} altın`;
  $('overQuests').innerHTML = run.newQuests.map(q => `<div>✅ ${q.text} → ${rewardText(q.reward)}</div>`).join('');
  ui.over.classList.remove('hidden');
  ui.hud.classList.add('hidden');
  state = 'over';
}

const rows = list => list.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
// Katlanır ayrıntılar: dokununca açılır
const more = list => list.length ? `<details class="more"><summary>📊 Ayrıntılar</summary><div class="statList">${rows(list)}</div></details>` : '';

function togglePause() {
  if (state === 'play') {
    state = 'paused';
    for (const k in keys) keys[k] = false;
    const S = run.s;
    $('pauseHero').textContent = `${HEROES[run.hero].icon} ${HEROES[run.hero].name}`;
    $('pauseStats').innerHTML = rows([
      ['Can', `${Math.ceil(player.hp)} / ${Math.round(S.maxHp)}`], ['Saldırı hasarı', S.atkDmg.toFixed(1)], ['Hareket hızı', S.speed.toFixed(2)],
    ]) + more([
      ['Saldırı aralığı', S.interval.toFixed(2) + ' sn'], ['Menzil', S.range.toFixed(2)],
      ['Kritik şansı', '%' + Math.round(S.crit * 100)], ['Can yenileme', S.regen.toFixed(1) + ' /sn'], ['Zırh', '%' + Math.round(S.armor * 100)],
      ['Toplama alanı', S.magnet.toFixed(1)], ['Yeniden seçim hakkı', run.rerolls],
    ].concat(TAL.talentRows(run.hero)));   // aktif kalıcı yetenekler (katlanır)
    const ups = UPGRADES.filter(u => run.up[u.id]);
    const evRows = EVOS.filter(ev => run.evo[ev.id]).map(ev => [`${ev.icon} ${ev.name}`, 'EVRİM ★']);
    const hints = EVOS.filter(ev => !run.evo[ev.id] && run.up[ev.base]).map(ev => {
      const b = UPGRADES.find(u => u.id === ev.base), r = UPGRADES.find(u => u.id === ev.req);
      return [`💡 ${ev.name}`, `${b.name} 5 + ${r.name}`];
    });
    $('pauseUps').innerHTML = ups.length ? rows(ups.map(u => [`${u.icon} ${u.name}`, `${run.up[u.id]} / ${u.max}`]).concat(evRows, hints)) : '<div><span>Henüz yok, seviye atla!</span><span></span></div>';
    ui.pause.classList.remove('hidden');
  } else if (state === 'paused') {
    if (pauseSettings) closePauseSettings(false);
    ui.pause.classList.add('hidden');
    state = 'play';
  }
}
$('pauseBtn').onclick = togglePause;

// --- Oyun hızı: ⏩ butonu ya da T tuşu ile 1x → 2x → 3x ---
const SPEEDS = [1, 2, 3];
let gameSpeed = 1;
function cycleSpeed() {
  gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length];
  const b = $('speedBtn');
  b.textContent = gameSpeed === 1 ? '⏩ 1x' : `⏩ ${gameSpeed}x`;
  b.classList.toggle('on', gameSpeed > 1);
  sfx.click();
}
$('speedBtn').onclick = cycleSpeed;
addEventListener('keydown', e => { if (e.code === 'KeyT' && !e.repeat && state === 'play') cycleSpeed(); });

// --- Test Modu anahtarı (Ayarlar) ---
$('testChk').checked = TEST_MODE;
$('testChk').onchange = e => {
  try { if (e.target.checked) localStorage.setItem('kemikArena.mode', 'test'); else localStorage.removeItem('kemikArena.mode'); } catch {}
  location.reload();
};
if (TEST_MODE) document.body.classList.add('testMode');
$('resumeBtn').onclick = () => { sfx.click(); togglePause(); };
$('quitBtn').onclick = () => { sfx.click(); ui.pause.classList.add('hidden'); endRun(); };
// Duraklatınca Ayarlar: menüdeki Ayarlar kartı açılır, Geri ile duraklat ekranına dönülür
let pauseSettings = false;
function closePauseSettings(back) {
  pauseSettings = false; document.body.classList.remove('pauseSet');
  ui.menu.classList.add('hidden');
  if (back) ui.pause.classList.remove('hidden');
}
if ($('pauseSetBtn')) $('pauseSetBtn').onclick = () => {
  sfx.click(); pauseSettings = true; document.body.classList.add('pauseSet');
  ui.pause.classList.add('hidden'); ui.menu.classList.remove('hidden'); showCard('mSettings');
};
$('againBtn').onclick = () => { sfx.click(); startRun(); };
$('overMenuBtn').onclick = () => { sfx.click(); toMenu(); };

function toMenu() {
  clearWorld();
  run = null;
  if (player) setHero(save.hero);
  menuPreview = save.hero;   // menü vitrini seçili kahramanla açılsın
  for (const el of [ui.over, ui.pause, ui.levelUp, ui.hud, ui.chest, ui.victory]) el.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  showCard('mMain');
  state = 'menu';
  playMusic('menu');
}

// =====================================================
//  Ana menü
// =====================================================
function showCard(id) {
  for (const c of ui.menu.querySelectorAll('.card')) c.classList.toggle('hidden', c.id !== id);
  for (const g of document.querySelectorAll('.goldAmt')) g.textContent = save.gold;
  if (id === 'mShop') renderShop();
  if (id === 'mStats') renderStats();
  if (id === 'mSettings') renderSettings();
  if (id === 'mQuests') renderQuests();
  // Ana menü: karakter vitrini düzeni (yarı saydam arka plan, kamera yakınlaşır)
  ui.menu.classList.toggle('home', id === 'mMain');
  if (id === 'mMain') renderHome();
  updateQuestBadge();
}

function questOf(id) { return QUESTS.find(q => q.id === id); }

// =====================================================
//  Ana menü: karakter seçme şeridi + 3B karakter vitrini
// =====================================================
let menuPreview = null;      // menüde gösterilen kahraman (kilitli de olabilir; save.hero sadece açık olanlar)
let menuAnimT = 0;           // tek seferlik "selam" animasyonu bitince Idle'a dön
const HERO_CHEER = { knight: 'Melee_1H_Attack_Chop', barbarian: 'Melee_2H_Attack_Spin', mage: 'Ranged_Magic_Raise', ranger: 'Ranged_Bow_Release', rogue: 'Melee_Dualwield_Attack_Slice' };
const heroStage = $('heroStage');
// Kilitli kahraman: siyah siluet (malzemeler paylaşıldığı için mesh başına geçici değiştirilir)
const silMat = new THREE.MeshBasicMaterial({ color: 0x050308 });
function setSilhouette(c, on) {
  if (!c || !!c.sil === on) return;
  c.sil = on;
  c.obj.traverse(o => {
    if (!o.isMesh || o === rangeRing || o === holyBubble) return;
    if (on) { o.userData.mat0 = o.material; o.material = silMat; }
    else if (o.userData.mat0) { o.material = o.userData.mat0; delete o.userData.mat0; }
  });
}
// Vitrin kaidesi: karakterin ayağının altında parlayan halka (sadece menüde)
const pedestal = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
pedestal.position.y = 0.04; pedestal.visible = false; scene.add(pedestal);

function heroLockInfo(id) {
  const q = questOf(HEROES[id].unlock), st = save.stats;
  if (!q) return { text: 'Kilitli', cur: 0, n: 1 };
  return { text: q.text, cur: Math.min(q.n, st[q.stat] || 0), n: q.n };
}
function renderHome() {
  if (!menuPreview || !HEROES[menuPreview]) menuPreview = save.hero;
  const id = menuPreview, H = HEROES[id], owned = !!save.heroes[id];
  // Şerit: 5 kahraman kartı
  $('heroStrip').innerHTML = Object.entries(HEROES).map(([hid, h]) => {
    const own = !!save.heroes[hid];
    let st = save.hero === hid ? `✔ Sv. ${TAL.heroLv(hid)}` : own ? `Sv. ${TAL.heroLv(hid)}` : '';
    if (!own) { const L = heroLockInfo(hid); st = `<span class="bar"><i style="width:${L.cur / L.n * 100}%"></i></span>`; }
    return `<button class="hcard${hid === id ? ' on' : ''}${save.hero === hid ? ' sel' : ''}${own ? '' : ' locked'}" data-pick="${hid}" title="${h.name}">
      <span class="pf"><img src="assets/ui/p-${hid}.png" alt="">${own ? '' : '<span class="lk">🔒</span>'}</span><b>${h.name}</b></button>`;
  }).join('');
  for (const b of $('heroStrip').querySelectorAll('[data-pick]')) b.onclick = () => { initAudio(); pickHero(b.dataset.pick); };
  // Bilgi paneli
  let lock = '';
  if (!owned) {
    const L = heroLockInfo(id);
    lock = `<div class="hiLock">🔒 <b>Kilitli:</b> ${L.text} <b>(${L.cur}/${L.n})</b><span class="bar"><i style="width:${L.cur / L.n * 100}%"></i></span></div>
      <button class="hiBuy" data-buyhome="${id}" ${save.gold < H.cost ? 'disabled' : ''}>🪙 ${H.cost} altınla hemen aç${save.gold < H.cost ? ` (${H.cost - save.gold} eksik)` : ''}</button>`;
  }
  $('heroInfo').innerHTML = `<div class="gName"><i>◆</i><b>${H.name}</b><i>◆</i>${owned ? `<small id="talentBtn" title="Kahraman Seviyesi">Sv. ${TAL.heroLv(id)}</small>` : ''}</div>${lock}`;
  const tb = $('talentBtn');
  if (tb) tb.onclick = () => {
    initAudio(); sfx.click();
    if (typeof window.openHeroTalents === 'function') window.openHeroTalents(save.hero);
    else toast('⬆️ Kahraman seviyesi yakında!');
  };
  const bb = $('heroInfo').querySelector('[data-buyhome]');
  if (bb) bb.onclick = () => buyHeroHome(bb.dataset.buyhome);
  // Oyna butonu: kilitliyse devre dışı + koşulu söyle
  const note = $('playNote');
  if (state !== 'loading') {
    playBtn.disabled = !owned;
    playBtn.textContent = owned ? 'OYNA' : '🔒 KİLİTLİ';
  }
  note.textContent = '';   // kilit koşulu artık isim kurdelesinin altında
  // 3B model (yüklendiyse)
  if (heroChars[id]) {
    if (player !== heroChars[id]) setHero(id);
    setSilhouette(heroChars[id], !owned);
    for (const k in heroChars) if (k !== id) setSilhouette(heroChars[k], !save.heroes[k]);
  }
}
// Kahraman seçimi (şeritten / klavyeden)
function stepHero(d) {
  const ids = Object.keys(HEROES), i = ids.indexOf(menuPreview || save.hero);
  pickHero(ids[(i + d + ids.length) % ids.length]);
}
if ($('heroPrev')) $('heroPrev').onclick = () => { initAudio(); stepHero(-1); };
if ($('heroNext')) $('heroNext').onclick = () => { initAudio(); stepHero(1); };
if ($('tabHero')) $('tabHero').onclick = () => {
  initAudio(); sfx.click();
  if (typeof window.openHeroTalents === 'function') window.openHeroTalents(save.hero);
};
function pickHero(id) {
  if (!HEROES[id] || state !== 'menu') return;
  const changed = menuPreview !== id;
  menuPreview = id;
  sfx.click();
  if (save.heroes[id] && save.hero !== id) { save.hero = id; persist(); }
  renderHome();
  if (changed && save.heroes[id]) heroCheer(false);
}
function buyHeroHome(id) {
  const H = HEROES[id];
  if (!H || save.heroes[id] || save.gold < H.cost) return;
  initAudio();
  save.gold -= H.cost; save.heroes[id] = true; save.hero = id; menuPreview = id; persist();
  sfx.buff(); showCard('mMain'); heroCheer(true);
  toast(`${H.icon} ${H.name} açıldı!`);
}
// Seçimde kısa selam animasyonu + parıltı
function heroCheer(big) {
  if (!player || state !== 'menu') return;
  const id = menuPreview || save.hero;
  const d = play(player, HERO_CHEER[id] || 'Interact', true, 0.12) || play(player, 'Interact', true, 0.12);
  menuAnimT = Math.max(0.3, d - 0.12);
  const p = player.obj.position;
  spawnRingFx(p, big ? 3.2 : 2, big ? 0xffd23f : 0xfff1c0);
  particles.emit(tmpV.set(p.x, 1, p.z), big ? 40 : 16, GOLD_COL, big ? 6 : 3.5);
}
addEventListener('keydown', e => {
  if (state !== 'menu' || !ui.menu.classList.contains('home') || ui.menu.classList.contains('hidden')) return;
  if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
  const ids = Object.keys(HEROES), i = ids.indexOf(menuPreview || save.hero);
  pickHero(ids[(i + (e.code === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]);
});

// Kamera vitrini: karakteri #heroStage kutusunun ortasına çerçeveler. Menü dışında null döner.
const VIT_R = new THREE.Vector3(), VIT_U = new THREE.Vector3();
{ const f = CAM_OFFSET.clone().negate().normalize(); VIT_R.crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(); VIT_U.crossVectors(VIT_R, f).normalize(); }
const vitOut = { focus: new THREE.Vector3(), zoom: 1 };
function updateMenuVitrine(dt, time) {
  const on = state === 'menu' && !run && player && !ui.menu.classList.contains('hidden') && ui.menu.classList.contains('home');
  pedestal.visible = false;
  if (!on) return null;
  const r = heroStage.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  if (r.width < 20 || r.height < 20) return null;
  // Karakter (silahla) ~3 birim yüksek, ~2 birim geniş görünsün; kutuya sığacak yakınlık
  const zoom = Math.max(1, Math.min(8, (r.height * 0.8 / H) * 2 * viewEff / 3.1, (r.width * 0.9 / W) * 2 * viewEff * (W / H) / 2));
  const halfH = viewEff / zoom, halfW = viewEff * (W / H) / zoom;
  // Kutunun yatayda ortası, dikeyde biraz üstü (ayaktaki kaide alttaki panele girmesin)
  const nx = (r.left + r.width / 2) / W * 2 - 1, ny = 1 - (r.top + r.height * 0.46) / H * 2;
  const p = player.obj.position;
  vitOut.focus.set(p.x, p.y + 1.2, p.z).addScaledVector(VIT_R, -nx * halfW).addScaledVector(VIT_U, -ny * halfH);
  vitOut.zoom = zoom;
  // Hafif sallanarak kameraya bakar, Idle animasyonu; selam bitince Idle'a döner
  player.obj.rotation.y = Math.PI / 4 + Math.sin(time * 0.6) * 0.4;
  if (menuAnimT > 0) { menuAnimT -= dt; if (menuAnimT <= 0) play(player, 'Idle_A', false, 0.25); }
  rangeRing.visible = false;
  pedestal.visible = true;
  pedestal.position.x = p.x; pedestal.position.z = p.z;
  pedestal.material.color.setHex(player.sil ? 0x8a8090 : 0xffd23f);
  pedestal.material.opacity = 0.35 + Math.sin(time * 2.4) * 0.12;
  updateFx(dt);   // seçim halkası efektleri menüde de oynasın
  return vitOut;
}
function renderQuests() {
  const st = save.stats;
  $('questList').innerHTML = QUESTS.map(q => {
    const done = !!save.quests[q.id], cur = Math.min(q.n, st[q.stat] || 0);
    return `<div class="quest${done ? ' done' : ''}"><div class="ic">${done ? '✅' : q.reward.hero ? HEROES[q.reward.hero].icon : '<img src=\"assets/ui/i-coin.png\" alt=\"\">'}</div>
      <div class="info">${q.text}<small>Ödül: ${rewardText(q.reward)}${done ? ' · Tamamlandı' : ` · ${cur} / ${q.n}`}</small>
      <div class="bar"><i style="width:${(done ? 1 : cur / q.n) * 100}%"></i></div></div></div>`;
  }).join('');
}
for (const b of document.querySelectorAll('[data-go]')) {
  b.addEventListener('click', () => {
    initAudio(); sfx.click();
    const go = b.dataset.go;
    if (go === 'mMain' && pauseSettings) { closePauseSettings(true); return; }
    if (go === 'play') startRun(); else showCard(go);
  });
}

function renderShop() {
  const list = $('shopList');
  list.innerHTML = SHOP.map(it => {
    const lv = shopLv(it.id), maxed = lv >= it.max, cost = shopCost(it, lv);
    const pips = Array.from({ length: it.max }, (_, i) => `<span class="${i < lv ? 'on' : ''}"></span>`).join('');
    return `<div class="shopItem"><div class="ic">${it.icon}</div>
      <div class="info"><b>${it.name}</b><span class="lv">${lv}/${it.max}</span><small>${it.desc}</small><div class="pips">${pips}</div></div>
      <button data-buy="${it.id}" ${maxed || save.gold < cost ? 'disabled' : ''}>${maxed ? 'MAKS' : '<img class="gc" src="assets/ui/i-coin.png" alt="">' + cost}</button></div>`;
  }).join('');
  for (const b of list.querySelectorAll('[data-buy]')) b.onclick = () => {
    const it = SHOP.find(s => s.id === b.dataset.buy), lv = shopLv(it.id), cost = shopCost(it, lv);
    if (lv >= it.max || save.gold < cost) return;
    save.gold -= cost; save.shop[it.id] = lv + 1; persist();
    sfx.buff(); showCard('mShop');
  };
}
function renderStats() {
  const s = save.stats;
  $('statsList').innerHTML = rows([
    ['En yüksek dalga', s.bestWave], ['En çok öldürme (tek koşu)', s.bestKills], ['En uzun süre', fmtTime(s.bestTime)], ['En yüksek seviye', s.bestLevel],
    ['Toplam koşu', s.runs], ['Toplam devrilen iskelet', s.totalKills], ['Devrilen boss', s.bossKills], ['Toplam kazanılan altın', s.goldEarned],
  ]);
}
function renderSettings() {
  const st = save.settings;
  for (const b of document.querySelectorAll('#qualitySeg button')) b.classList.toggle('on', b.dataset.q === st.quality);
  $('soundChk').checked = st.sound; $('volRange').value = st.volume; $('fpsChk').checked = st.fps; $('autoQChk').checked = st.autoQ;
}
for (const b of document.querySelectorAll('#qualitySeg button')) b.onclick = () => {
  const old = save.settings.quality;
  save.settings.quality = b.dataset.q; persist(); sfx.click();
  // Kenar yumuşatma (antialias) sadece sayfa yüklenirken ayarlanabiliyor
  if ((old === 'yuksek') !== (b.dataset.q === 'yuksek')) { location.reload(); return; }
  applyQuality(); renderSettings();
};
$('soundChk').onchange = e => { save.settings.sound = e.target.checked; setAudio(save.settings.sound, save.settings.volume); persist(); };
$('volRange').oninput = e => { save.settings.volume = +e.target.value; setAudio(save.settings.sound, save.settings.volume); persist(); };
$('volRange').onchange = () => sfx.coin();
$('fpsChk').onchange = e => { save.settings.fps = e.target.checked; ui.fps.classList.toggle('hidden', !e.target.checked); persist(); };
$('autoQChk').onchange = e => { save.settings.autoQ = e.target.checked; persist(); };
$('resetBtn').onclick = () => {
  if (!confirm('Tüm altın, kalıcı geliştirmeler ve istatistikler silinsin mi?')) return;
  save.gold = 0; save.shop = {}; save.heroes = Object.fromEntries(Object.keys(HEROES).map(id => [id, true])); save.hero = 'knight'; save.quests = {}; save.heroTalents = {}; save.heroLevels = {};
  for (const k in save.stats) save.stats[k] = 0; persist(); setHero('knight'); showCard('mSettings');
  toast('İlerleme sıfırlandı');
};

// --- Kahraman yetenekleri (talents.js) ---
TAL.initTalents({
  get save() { return save; }, get run() { return run; }, get player() { return player; }, get enemies() { return enemies; }, scene, sfx,
  persist, heal, damageEnemy, killEnemy, floatText, spawnRingFx, fireShot, nearestEnemies, isActive,
  shake: v => { shake = Math.max(shake, v); },
  // Seviye atlayınca (özellikle Sv.10 silah görünümü) menüdeki model hemen güncellensin
  onHeroLevel(heroId) { if (heroChars[heroId]) equipWeapons(heroChars[heroId], heroId, TAL.hasMilestone(heroId, 'weapon') ? 1 : 0); heroLevelFx(heroId); },
});
// Süper yetenekler (super.js)
SUP.initSuper({
  get run() { return run; }, get player() { return player; }, get enemies() { return enemies; }, scene, sfx, G,
  hero: () => HEROES[run.hero], play, banner, shake: v => { shake = Math.max(shake, v); },
  damageEnemy, nearestEnemies, isActive, spawnRingFx, floatText, burst: (p, n, c, s) => particles.emit(p, n, c, s),
});
// Seviye atlama görsel geri bildirimi (menü vitrininde halka + parıltı)
function heroLevelFx(id) {
  if (!player || state !== 'menu' || !heroChars[id] || player !== heroChars[id]) return;
  const p = player.obj.position;
  spawnRingFx(p, 3, 0xffd23f);
  particles.emit(tmpV.set(p.x, 1, p.z), 24, GOLD_COL, 5);
}
// Yetenek kartını aç (ana menüdeki "Geliştir" butonu bunu çağırır) — kahraman seviyesi ekranı
function openHeroTalents(heroId) {
  showCard('mTalents');
  const id = HEROES[heroId] ? heroId : save.hero;
  TAL.renderTalents(id);
  // Vitrin modeli o kahramana geçsin (sekme değişince de)
  if (save.heroes[id] && state === 'menu' && heroChars[id] && player !== heroChars[id]) setHero(id);
}
window.openHeroTalents = openHeroTalents;

// =====================================================
//  HUD güncelleme
// =====================================================
let buffsDirty = true, hintT = 0, comboPop = 0;
function updateHud(dt) {
  // Öldürme serisi
  if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
  const showCombo = run.combo >= 5;
  ui.combo.classList.toggle('hidden', !showCombo);
  if (showCombo) {
    setText(ui.comboN, 'x' + run.combo);
    ui.combo.classList.toggle('hot', run.combo >= 50);
    ui.combo.classList.toggle('pop', comboPop > 0);
  }
  if (comboPop > 0) comboPop -= dt;
  const S = run.s;
  setWidth(ui.hpFill, player.hp / S.maxHp * 100);
  setText(ui.hpTxt, `${Math.ceil(Math.max(0, player.hp))} / ${Math.round(S.maxHp)}`);
  setWidth(ui.xpFill, run.xp / run.xpNeed * 100);
  setText(ui.lvl, `SEVİYE ${run.level}`);
  setText(ui.lvlNum, String(run.level));
  setWidth(ui.dash, player.dashCd <= 0 ? 100 : (1 - player.dashCd / (player.dashMax || 0.9)) * 100);   // Hafif Ayak yeteneği bekleme süresini kısaltır
  setText(ui.time, fmtTime(run.time));
  setText(ui.kills, String(run.kills));
  setText(ui.gold, String(run.gold));
  setText(ui.waveSub, run.wave === FINAL_WAVE && !run.won ? 'Kemik Kral\'ı devir!'
    : run.queue.length || enemies.some(e => e.state !== 'dead') ? `Kalan iskelet: ${run.waveLeft}` : 'Sıradaki dalga geliyor…');
  if (run.boss) setWidth(ui.bossFill, run.boss.hp / run.boss.hpMax * 100);

  // Süreli güçlendirmeler
  let changed = buffsDirty;
  for (const k in run.buffs) {
    const before = Math.ceil(run.buffs[k]);
    run.buffs[k] -= dt;
    if (run.buffs[k] <= 0) { delete run.buffs[k]; changed = true; }
    else if (Math.ceil(run.buffs[k]) !== before) changed = true;
  }
  if (changed) {
    buffsDirty = false;
    ui.buffs.innerHTML = Object.entries(run.buffs).map(([k, t]) => `<div class="buff" title="${BUFFS[k].desc}">${BUFFS[k].icon} ${Math.ceil(t)}</div>`).join('');
  }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) ui.hint.style.opacity = 0; }

  // Süper çubuğu (masaüstü #superHud, mobil #superBtn): dolum halkası + hazırsa parlar
  const sc = SUP.superCharge(), sr = SUP.superReady(), sIc = HEROES[run.hero].super.icon;
  const sKey = Math.round(sc * 100) + (sr ? 'r' : '') + (SUP.superBusy() ? 'a' : '') + sIc;
  if (sKey !== superKey) {
    superKey = sKey;
    const sh = $('superHud');
    sh.style.setProperty('--p', Math.round(sc * 100));
    sh.classList.toggle('ready', sr); sh.classList.toggle('active', SUP.superBusy());
    if ($('superIc').textContent !== sIc) $('superIc').textContent = sIc;
    touch.setSuper(sc, sr, sIc);
  }
}
let superKey = '';
$('superHud').addEventListener('pointerdown', e => { e.stopPropagation(); if (state === 'play' && !bot && e.pointerType === 'mouse') SUP.superUse(moveInput()); });

// =====================================================
//  Ana döngü
// =====================================================
const clock = new THREE.Clock();
let fpsFrames = 0, fpsT = 0, slowT = 0, lastNow = performance.now();
const camFocus = new THREE.Vector3();

let forcedDt = null;   // test için: oyunu sabit adımlarla ilerletme
function loop() {
  let dt = forcedDt !== null ? forcedDt : Math.min(0.05, clock.getDelta());
  if (forcedDt === null && gameSpeed !== 1) dt = Math.min(0.1, dt * gameSpeed);   // hızlandırma (1x/2x/3x)
  const time = clock.elapsedTime;
  const realDt = dt;
  // Vuruş duraksaması (hit-stop): önemli anlarda oyun bir an yavaşlar
  if (freeze > 0) { freeze -= realDt; dt *= 0.06; }
  const frozen = state === 'paused' || state === 'levelup' || state === 'chest' || state === 'victory';

  if (state === 'play' || state === 'dying') {
    if (state === 'play') run.time += dt;
    updatePlayer(dt);
    for (const e of enemies) updateEnemy(e, dt);
    if (enemies.some(e => e.removed)) enemies = enemies.filter(e => !e.removed);
    separate();
    updateOrbs(dt);
    updateBossFx(dt);
    updateWeapons(dt);
    run.gemT -= dt; if (run.gemT <= 0) run.gemChain = 0;
    updatePickups(gems, dt, it => { sfx.gem(run.gemChain++); run.gemT = 0.5; gainXp(it.v); });
    updatePickups(coins, dt, it => { sfx.coin(); const g = Math.max(1, Math.round(it.v * run.s.goldMult)); run.gold += g; });
    updateBuffDrops(dt, time);
    updateChests(dt);
    if (state === 'play') updateWaves(dt);
    arenaGates.update(dt, time, enemies);
    updateFx(dt);
    updateHud(realDt);
    for (const e of enemies) e.mixer.update(dt);
    run.questT -= realDt; if (run.questT <= 0 && !bot) { run.questT = 1; checkQuests(); }
  }
  if (player && !frozen) player.mixer.update(dt);
  if (!frozen) particles.update(dt);
  gems.sync(time); coins.sync(time); particles.sync(); syncBlobs();
  updateFloats(frozen ? 0 : realDt);

  // Kamera
  // Menüde karakter vitrini: yakınlaş + karakteri menünün kapatmadığı alana çerçevele
  const vit = updateMenuVitrine(realDt, time);
  camFocus.lerp(vit ? vit.focus : player && run ? player.obj.position : tmpV.set(0, 0, 0), vit ? 0.12 : 0.15);
  const zoomT = vit ? vit.zoom : 1;
  if (camera.zoom !== zoomT) {
    camera.zoom = Math.abs(zoomT - camera.zoom) < 0.002 ? zoomT : camera.zoom + (zoomT - camera.zoom) * 0.1;
    camera.updateProjectionMatrix();
  }
  camera.position.copy(camFocus).add(CAM_OFFSET);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; camera.position.z += (Math.random() - 0.5) * shake; }
  camera.lookAt(camFocus);
  sun.position.copy(camFocus).add(tmpV2.set(-12, 25, 8));
  sun.target.position.copy(camFocus);
  torchMat.color.setHSL(0.76, 1, 0.62 +Math.sin(time * 9) * 0.05);

  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) ui.banner.style.opacity = 0; }

  if (bot && bot.fast) return;   // simülasyonda çizim yok
  crowd.update(realDt, camera);   // seyirciler: uniform + ekran dışı dilimleri gizleme (ucuz)
  // Menünün alt sayfalarında (dükkan, görevler…) sahne çizilmez; arkada #menuBg görünür
  const subMenu = !vit && (state === 'menu' || state === 'loading') && !run && !ui.menu.classList.contains('hidden');
  if (subMenu !== subDraw) { subDraw = subMenu; document.body.classList.toggle('gMenu', subMenu); }
  document.body.classList.toggle('gLoad', state === 'loading');
  if (subMenu) return;
  // Gotik ana menü: sahneyi değil sadece kahramanı (katman 1) şeffaf zeminle çiz; arkada #menuBg resmi görünür
  const homeOnly = !!vit;
  if (homeOnly !== homeDraw) {
    homeDraw = homeOnly;
    document.body.classList.toggle('gHome', homeOnly);
    scene.background = homeOnly ? null : sceneBg;
    camera.layers.set(homeOnly ? 1 : 0);
  }
  if (homeOnly && player) {
    menuKey.position.copy(player.obj.position).add(CAM_OFFSET); menuKey.target = player.obj;
    menuRim.position.copy(player.obj.position).add(tmpV2.set(-CAM_OFFSET.x, 8, -CAM_OFFSET.z)); menuRim.target = player.obj;
  }
  if (homeOnly && player && !player.obj.userData.l1) { player.obj.traverse(o => o.layers.enable(1)); player.obj.userData.l1 = true; }
  renderer.render(scene, camera);

  // FPS ölçümü + kasarsa kaliteyi otomatik düşür
  const now = performance.now();
  fpsFrames++; fpsT += (now - lastNow) / 1000; lastNow = now;
  if (fpsT >= 0.5) {
    const fps = fpsFrames / fpsT;
    if (save.settings.fps) setText(ui.fps, `${Math.round(fps)} FPS · ${enemies.length} düşman`);
    if (state === 'play' && save.settings.autoQ && !document.hidden) {
      slowT = fps < 40 ? slowT + fpsT : 0;
      if (slowT > 4) {
        const i = Q_ORDER.indexOf(save.settings.quality);
        if (i > 0) {
          save.settings.quality = Q_ORDER[i - 1]; persist(); applyQuality();
          toast('Oyun kastığı için grafik kalitesi düşürüldü (Ayarlar\'dan değiştirebilirsin)');
        }
        slowT = 0;
      }
    }
    fpsFrames = 0; fpsT = 0;
  }
}

// =====================================================
//  Başlangıç
// =====================================================
function decorate() {
  for (let i = 0; i < 14; i++) {
    const k = i < 11 ? 'sArrow' : 'sShieldB';
    const m = G[k].scene.clone();
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * (ARENA_R - 3);
    m.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
    m.rotation.set(k === 'sShieldB' ? -Math.PI / 2 : Math.PI / 2, 0, Math.random() * Math.PI * 2);
    scene.add(m);
  }
}

// Gölgelendiricileri önceden derle ve birkaç düşmanı havuza hazırla → ilk doğuşta takılma olmasın
function prewarm() {
  const temp = [];
  for (const type of ['minion', 'rogue', 'warrior', 'mage', 'minion', 'warrior']) {
    const c = getEnemy(type); c.type = type; c.obj.position.set(Math.random() * 4 - 2, 0, Math.random() * 4 - 2); temp.push(c);
  }
  const bits = [new THREE.Mesh(orbGeo, orbMat), new THREE.Mesh(boltGeo, boltMat), G.dagger.scene.clone(), G.arrow.scene.clone(), G.orbShield.scene.clone(), G.mug.scene.clone()];
  bits.forEach(b => scene.add(b));
  gems.add(0, 0, 1, GEM_COL[0]); coins.add(0, 0, 1); gems.sync(0); coins.sync(0);
  particles.emit(new THREE.Vector3(), 3, BONE_COL); particles.sync();
  dropChest(2, 2);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  temp.forEach(releaseEnemy);
  bits.forEach(b => scene.remove(b));
  gems.clear(); coins.clear(); particles.clear();
  for (const c of chests) scene.remove(c.g); chests = [];
  for (const f of floats) { f.el.style.opacity = 0; floatPool.push(f.el); } floats.length = 0;
}

ui.fps.classList.toggle('hidden', !save.settings.fps);
applyQuality();
showCard('mMain');
renderer.setAnimationLoop(loop);

loadAll().then(() => {
  decorate();
  crowd.useModels(G, CLIPS);   // seyirciler: KayKit modellerini pozlarda pişirip kurar (arka planda, bloklamaz)
  // Tüm kahramanları önceden oluştur (menüde seçim anında takılmasın), sonra seçiliyi göster
  for (const id in HEROES) setHero(id);
  if (!save.heroes[save.hero]) save.hero = 'knight';
  setHero(save.hero);
  prewarm();
  state = 'menu';
  checkQuests();
  playBtn.disabled = false; playBtn.textContent = 'Oyna';
  if (!ui.menu.classList.contains('hidden')) renderHome();   // seçili kahraman modeli + Oyna butonu
  if (migRefund > 0) toast(`⬆️ Yetenek dükkanı artık Kahraman Seviyesi! Harcadığın 🪙 ${migRefund} altın iade edildi.`);
}).catch(err => { console.error(err); playBtn.textContent = 'Yükleme hatası (konsola bak)'; });

// Geliştirme için: konsoldan oyun durumuna bakmak
window.__game = {
  keys, scene, renderer, camera, G, events: gameEvents, get state() { return state; }, get run() { return run; }, get player() { return player; }, get enemies() { return enemies; },
  // Performans testi: N düşman oluşturup kareleri senkron çizer, ortalama süreleri döner
  bench(n = 25, frames = 40) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const temp = [];
    const types = ['minion', 'warrior', 'rogue', 'mage'];
    for (let i = 0; i < n; i++) {
      const t = types[i % 4], c = getEnemy(t); c.type = t;
      const a = i / n * Math.PI * 2, r = 2 + (i % 5);
      c.obj.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      play(c, 'Skeletons_Walking'); temp.push(c);
    }
    const res = {};
    for (const shadows of [renderer.shadowMap.enabled, false]) {
      const prevS = renderer.shadowMap.enabled; renderer.shadowMap.enabled = shadows;
      sync();
      let tu = 0, tr = 0;
      for (let f = 0; f < frames; f++) {
        let t0 = performance.now();
        for (const c of temp) c.mixer.update(1 / 60);
        player.mixer.update(1 / 60);
        tu += performance.now() - t0;
        t0 = performance.now(); renderer.render(scene, camera); sync(); tr += performance.now() - t0;
      }
      renderer.shadowMap.enabled = prevS;
      res[shadows ? 'golgeli' : 'golgesiz'] = { animMs: +(tu / frames).toFixed(2), renderMs: +(tr / frames).toFixed(2) };
    }
    res.drawCalls = renderer.info.render.calls; res.triangles = renderer.info.render.triangles;
    res.pixelRatio = renderer.getPixelRatio(); res.size = [innerWidth, innerHeight];
    temp.forEach(releaseEnemy);
    return res;
  },
  // Test yardımcıları (sadece geliştirme için)
  dev: {
    start(hero, wave = 1) { save.heroes[hero] = true; save.hero = hero; startRun(); if (wave > 1) { clearWorld(); run.wave = wave - 1; startWave(); } },
    spawn: (t, elite) => spawnEnemy(t, { elite }), chest: () => dropChest(player.obj.position.x + 1.5, player.obj.position.z), xp: v => gainXp(v),
    up(id, n) { run.up[id] = n; recompute(); renderUpgradeBar(); }, god() { player.hp = 1e6; run.s.maxHp = 1e6; },
    get save() { return save; },
    // Süper testi: çubuğu doldur / kullan; kahraman seviyesini (geçici) ayarla ve koşuyu yeniden hesapla
    superFill() { SUP.superFill(); }, superUse() { return SUP.superUse(null); }, superCharge: () => SUP.superCharge(),
    level(hero, n) { save.heroLevels = { ...save.heroLevels, [hero]: n }; if (heroChars[hero]) equipWeapons(heroChars[hero], hero, TAL.hasMilestone(hero, 'weapon') ? 1 : 0); if (run) recompute(); },
    sim(sec) { forcedDt = 1 / 30; for (let i = 0; i < sec * 30; i++) loop(); forcedDt = null; clock.getDelta(); },
    // Bot ile tam bir koşu simüle et → dalga dalga sonuç döner. shop: geçici kalıcı-geliştirme seviyeleri
    // heroLevel: kahraman seviyesi 0..20 (yetenekler + stat + silah + Süper ustalığı buradan türer) — geçici, kalıcı kayda yazılmaz
    async botRun(hero, { shop = {}, maxMin = 25, heroLevel = 0, noSuper = false } = {}) {
      const realShop = save.shop, realHeroes = save.heroes, realHero = save.hero, realLv = save.heroLevels;
      save.shop = shop; save.heroes = { ...realHeroes, [hero]: true }; save.hero = hero;
      save.heroLevels = { ...realLv, [hero]: heroLevel };
      bot = { fast: true, done: null, noSuper };
      startRun();
      const waves = []; let lastWave = 1, waveStart = 0, hpAtStart = player.hp, minHp = 1;
      forcedDt = 1 / 30;
      try {
        while (!bot.done && run.time < maxMin * 60) {
          for (let i = 0; i < 4000 && !bot.done; i++) {
            if (state === 'chest') state = 'play';
            loop();
            if (run.time > 5) minHp = Math.min(minHp, player.hp / run.s.maxHp);
            if (run.wave !== lastWave) {
              waves.push({ w: lastWave, sec: Math.round(run.time - waveStart), hpLost: Math.round(hpAtStart - player.hp + 0), lvl: run.level });
              lastWave = run.wave; waveStart = run.time; hpAtStart = player.hp;
            }
          }
          await new Promise(r => setTimeout(r, 0));
        }
      } catch (err) { bot.error = String(err && err.stack || err).slice(0, 400); }
      finally {
        forcedDt = null; clock.getDelta();
        const res = { hero, result: bot.error ? 'HATA: ' + bot.error : bot.done || 'timeout', wave: run.wave, time: Math.round(run.time), level: run.level, kills: run.kills,
                      hp: Math.round(player.hp), maxHp: Math.round(run.s.maxHp), minHpPct: Math.round(minHp * 100), gold: run.gold,
                      upLevels: Object.values(run.up).reduce((a, b) => a + b, 0), ups: { ...run.up }, evo: Object.keys(run.evo), waves };
        bot = null;
        save.shop = realShop; save.heroes = realHeroes; save.hero = realHero; save.heroLevels = realLv;
        run.counted = true;   // istatistiklere/kayda yazılmasın
        toMenu();
        return res;
      }
    },
    get chests() { return chests.length; }, get shots() { return shots.length; }, get particles() { return particles.items.length; },
  },
  info: () => ({ state, wave: run && run.wave, kills: run && run.kills, lvl: run && run.level, hp: player && Math.round(player.hp), enemies: enemies.length }),
};

// Telefonda uzun basınca açılan sistem menüsünü engelle
addEventListener('contextmenu', e => e.preventDefault());
