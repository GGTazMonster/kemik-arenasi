// 2. Arena (Kızıl Dökümhane) düşman modelleri: dosya, rol, boy, hareket adları ve dökümhane boyası.
// Sadece görünüm ayarları burada; can/hasar/hız gibi denge sayıları arena2.js'te (Dengeleme sohbetiyle ayarlanır).
// Modeller: Quaternius Ultimate Monsters (CC0) + Zindan Canavarları bedava Imp/Puglin (QAL),
// Imp/Puglin hareketleri Universal Animation Library'den (CC0) ayıklanmış ual-lite.glb'den gelir.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const DIR = new URL('assets/arena2/', import.meta.url).href;   // bu dosyaya göre (deneme sayfalarından da çalışsın)
// Ultimate Monsters hareket adları (iki aile: yürüyenler ve uçanlar)
const WALKER = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch', alt: 'Weapon', hit: 'HitReact', death: 'Death' };
const CRITTER = { idle: 'Idle', walk: 'Walk', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death' };
const FLYER = { idle: 'Flying_Idle', walk: 'Fast_Flying', attack: 'Headbutt', alt: 'Punch', hit: 'HitReact', death: 'Death' };
const UAL = { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', attack: 'Sword_Attack', alt: 'Punch_Cross', cast: 'Spell_Simple_Shoot', hit: 'Hit_Chest', death: 'Death01' };

// h: oyundaki boy (dünya birimi; KayKit iskelet ≈ 2.2). fly: yerden yükseklik. paint: boyama ayarı.
export const A2_MODELS = {
  // sig: imza rengi (Grafik Tasarım, 10 Kas; kullanıcı onayladı): her tür kendi rengiyle okunur; c = gövde, hot = en açık kaç ton lav, accent = altın süs
  blob_big:     { file: 'blob_big.glb',     name: 'Cüruf Balçığı',      role: 'bölünür',       h: 1.8, anim: CRITTER, sig: { c: 0xe0b030, hot: 1 } },   // cüruf sarısı
  blob_small:   { file: 'blob_small.glb',   name: 'Cüruf Damlası',      role: 'balçık parçası', h: 1.0, anim: CRITTER, sig: { c: 0xe0b030, hot: 1 } },
  tribal:       { file: 'tribal.glb',       name: 'Kor Maskesi',        role: 'uçan sürü',     h: 1.7, fly: 0.9, anim: FLYER, sig: { c: 0xa8a2b4, hot: 1 } },   // kül grisi
  alpaking:     { file: 'alpaking.glb',     name: 'Kül Kanat',          role: 'uçan sürü',     h: 1.9, fly: 1.0, anim: FLYER, sig: { c: 0xb4aec0, hot: 1 } },
  dragon:       { file: 'dragon.glb',       name: 'Kor Ejderi',         role: 'uzaktan ateş',  h: 2.3, fly: 1.2, anim: FLYER, sig: { c: 0xa8302a, hot: 1 } },   // koyu kırmızı
  monkroose:    { file: 'monkroose.glb',    name: 'Körük Bekçisi',      role: 'yakın dövüş',   h: 2.3, anim: WALKER, sig: { c: 0xd2c6b0, hot: 1 } },   // kül beyazı
  cactoro:      { file: 'cactoro.glb',      name: 'Çivili Kalfa',       role: 'yakın dövüş',   h: 2.4, anim: WALKER, sig: { c: 0x4a9a80, hot: 1 } },   // bakır pası yeşili
  alien:        { file: 'alien.glb',        name: 'Cüruf Gözcüsü',      role: 'hızlı yakın',   h: 2.3, anim: WALKER, sig: { c: 0x8a5ac0, hot: 1 } },   // gotik mor
  orc:          { file: 'orc.glb',          name: 'Zincirli Cellat',    role: 'elit',          h: 3.0, anim: WALKER, sig: { c: 0x5a84c8, hot: 1, accent: 0xd8a83a } },   // demir mavisi + altın
  // Boss'lar: parts = malzeme adı sonu → renk ('lava' = parlayan lav), glow = gövdede hafif iç kor; dokulu boss'larda tint
  alpaking_evo: { file: 'alpaking_evo.glb', name: 'Kül Kanat Kralı',    role: 'boss D5',       h: 4.8, fly: 1.4, anim: FLYER,
                  sig: { c: 0xb4aec0, parts: { _Main: 0xb4aec0, _Secondary: 0xd8a83a, Wings: 0x4a3a50, Eye_White: 'lava', Eye_Black: 0x140a10 } } },   // kül + altın taç
  puglin:       { file: 'puglin.glb',       name: 'Cüruf Devi',         role: 'boss D10',      h: 5.2, anim: UAL, ual: true, tint: 0xc89060 },   // cüruf-bronz (eski 0xffb08a)
  imp:          { file: 'imp.glb',          name: 'İblis Lordu',        role: 'boss D15',      h: 6.2, anim: UAL, ual: true, tint: 0xff7060 },   // daha kızıl (eski 0xffc0a0)
  dragon_evo:   { file: 'dragon_evo.glb',   name: 'Erimiş Ejder',       role: 'final boss D20', h: 6.5, fly: 1.6, anim: FLYER,
                  sig: { c: 0x241a20, glow: 0.12, parts: { _Main: 0x241a20, _Secondary: 'lava', _Horn: 0xd8a83a, Eye_White: 'lava', Eye_Black: 0x140a10 } } },   // obsidyen + lav + altın boynuz
};

// Dökümhane paleti
const COAL = new THREE.Color(0x2a1e30), PURP = new THREE.Color(0x4a2a5e), LILAC = new THREE.Color(0x7a4a8e), LAVA = new THREE.Color(0xff6a1a);
const lum = c => { const s = c.clone().convertLinearToSRGB(); return s.r * 0.3 + s.g * 0.59 + s.b * 0.11; };

// Dokusuz modeller: her modelin kendi renkleri açıklığa göre sıralanır; en açık ~%25 lav gibi parlar, gerisi kömür→mor.
// Dokulu modeller (Imp/Puglin): dokusu korunur, sıcak bir tonla çarpılır.
function paintForge(root, def) {
  const mats = new Map();
  root.traverse(m => { if (!m.isMesh) return;
    const arr = Array.isArray(m.material) ? m.material : [m.material];
    const nm = arr.map(mt => { if (!mats.has(mt)) mats.set(mt, mt.clone()); return mats.get(mt); });
    m.material = Array.isArray(m.material) ? nm : nm[0]; });
  const list = [...mats.values()];
  const order = [...new Set(list.filter(m => !m.map).map(m => m.color.getHex()))]
    .sort((a, b) => lum(new THREE.Color(a)) - lum(new THREE.Color(b)));
  if (def.sig) return paintSig(list, order, def);
  for (const m of list) {
    if (m.map) { m.color.set(def.tint || 0xffc0a0); continue; }
    const t = order.length < 2 ? 0.5 : order.indexOf(m.color.getHex()) / (order.length - 1);
    // Gövde ("…_Main") hiç lav olmaz: yoksa tüm canavar düz turuncu bir siluete dönüyor (oyunda görüldü, 9 Kas)
    const hot = !/_Main$/.test(m.name) && (t >= (def.hot ?? 0.75) || (order.length <= 3 && t === 1));
    m.color.copy(hot ? LAVA : COAL.clone().lerp(PURP, Math.min(1, t / 0.7)).lerp(LILAC, Math.max(0, t - 0.45)));
    if (m.emissive) { m.emissive.copy(LAVA); m.emissiveIntensity = hot ? 1.2 : 0; }
  }
}

// İmza renkli boya: gövde = imza rengi, koyu tonlar = onun gölgesi, açık tonlar = onun açığı;
// lav sadece en açık `hot` tonda (göz, diken ucu), `accent` varsa ondan bir önceki ton altın. Deneme: _deneme/imza-renk.html
const SIG_LIGHT = new THREE.Color(0xf4e2c8), SIG_DARK = new THREE.Color(0x140a10);
function paintSig(list, order, def) {
  const s = def.sig, n = order.length, base = new THREE.Color(s.c);
  for (const m of list) {
    if (m.map) { m.color.set(def.tint || 0xffc0a0); continue; }
    const i = order.indexOf(m.color.getHex()), t = n < 2 ? 0.5 : i / (n - 1), main = /_Main$/.test(m.name);
    const part = s.parts && Object.keys(s.parts).find(k => m.name.endsWith(k));
    if (part) {   // boss'larda parça parça elle seçilmiş renk
      const v = s.parts[part], lava = v === 'lava';
      m.color.copy(lava ? LAVA : new THREE.Color(v));
      if (m.emissive) { m.emissive.copy(LAVA); m.emissiveIntensity = lava ? 1.5 : 0;
        if (!lava && s.glow && part === '_Main') { m.emissive.setHex(0x8a1800); m.emissiveIntensity = s.glow; } }
      continue;
    }
    const hot = !main && n >= 3 && i >= n - s.hot;
    let c;
    if (hot) c = LAVA.clone();
    else if (s.accent && !main && n >= 4 && i === n - s.hot - 1) c = new THREE.Color(s.accent);
    else if (main || Math.abs(t - 0.5) < 0.2) c = base.clone();
    else c = t < 0.5 ? base.clone().lerp(SIG_DARK, 0.55 - t) : base.clone().lerp(SIG_LIGHT, (t - 0.5) * 0.6);
    m.color.copy(c);
    if (m.emissive) { m.emissive.copy(LAVA); m.emissiveIntensity = hot ? 1.3 : 0; }
  }
}

const loader = new GLTFLoader();
const templates = {};     // key → { scene (boyanmış, ölçeklenmiş), clips }
let ualClips = null;

// İstenen modelleri bir kez yükler (sadece 2. arena seçilince çağrılır → ilk açılış yavaşlamaz).
export async function loadArena2Models(keys = Object.keys(A2_MODELS)) {
  if (keys.some(k => A2_MODELS[k].ual) && !ualClips) ualClips = (await loader.loadAsync(DIR + 'ual-lite.glb')).animations;
  await Promise.all(keys.filter(k => !templates[k]).map(async k => {
    const def = A2_MODELS[k], g = await loader.loadAsync(DIR + def.file);
    const root = new THREE.Group(), body = g.scene;
    paintForge(body, def);
    body.traverse(m => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(body);
    body.scale.setScalar(def.h / Math.max(0.01, box.max.y - box.min.y));
    body.position.y = -box.min.y * body.scale.y + (def.fly || 0);   // ayakları yere (uçanlar havada)
    root.add(body);
    templates[k] = { scene: root, clips: def.ual ? ualClips : g.animations };
  }));
  return templates;
}

export const a2Template = key => templates[key];

// Yeni bir kopya: { obj, mixer, play(name, {once}) } — name: idle/walk/run/attack/alt/cast/hit/death
export function spawnArena2Model(key) {
  const t = templates[key], def = A2_MODELS[key];
  if (!t) throw new Error('arena2 modeli yüklenmedi: ' + key);
  const obj = SkeletonUtils.clone(t.scene), mixer = new THREE.AnimationMixer(obj);
  let cur = null;
  const find = n => { const want = def.anim[n] || def.anim.idle;
    return t.clips.find(c => c.name === want || c.name.endsWith('|' + want)) || t.clips.find(c => c.name.endsWith('|' + def.anim.idle)) || t.clips[0]; };
  function play(n, { once = false, fade = 0.15 } = {}) {
    const clip = find(n); if (!clip) return null;
    const a = mixer.clipAction(clip);
    if (cur === a && !once) return a;
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    if (cur) a.crossFadeFrom(cur, fade, false);
    a.play(); cur = a; return a;
  }
  play('idle');
  return { obj, mixer, play, def };
}
