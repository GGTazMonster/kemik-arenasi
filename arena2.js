// =====================================================
//  2. Arena (Kızıl Dökümhane): düşmanları oyuna bağlayan köprü
//  - Denge sayıları arena2-denge.js'te (Dengeleme sohbetinin; burada değiştirilmez)
//  - Görünüm/model/hareket adları arena2-models.js'te
//  Burası: düşman tanımlarını game.js'in beklediği biçime çevirir, modelleri yükler,
//  KayKit hareket adlarını (Skeletons_Walking, Melee_1H_Attack_Chop…) yeni modellerin hareketlerine eşler.
// =====================================================
import * as THREE from 'three';
import { ENEMIES } from './data.js';
import { A2_ENEMIES, A2_BOSSES, A2_BOSS_CYCLE, A2_FINAL_WAVE, a2PickType, a2Elites, A2_REWARD, A2_MUL } from './arena2-denge.js';
import { A2_MODELS, loadArena2Models, a2Template } from './arena2-models.js';

export { a2PickType, a2Elites, A2_REWARD, A2_MUL, A2_FINAL_WAVE };

// Boss yapay zekâsı (bosses.js'teki saldırı desenleri)
const A2_AI = { ashking: 'ashking', slaggiant: 'slaggiant', imp: 'implord', moltendragon: 'molten' };

// game.js biçiminde düşman tanımları. KayKit iskeletleri 1. arenanın modelini/silahını kullanır + kor boyası (kor: true).
export const A2_DEFS = {};
for (const [k, d] of Object.entries(A2_ENEMIES)) {
  if (d.model.startsWith('kaykit:')) {
    const base = ENEMIES[d.model.slice(7)];
    A2_DEFS[k] = { ...d, model: base.model, right: base.right, left: base.left, walk: base.walk, walkAnim: base.walkAnim, scale: base.scale, kor: true };
  } else {
    A2_DEFS[k] = { ...d, a2: d.model, walk: 'walk', walkAnim: d.speed > 3.5 ? 1.3 : 1.0, fire: !!d.ranged };
  }
  if (A2_AI[k]) A2_DEFS[k].ai = A2_AI[k];
}

// Boss sırası: 5/10/15 ara boss, 20 final; sonsuz modda (25, 30…) döngü
export function a2BossFor(w) {
  if (A2_BOSSES[w]) return A2_BOSSES[w];
  return A2_BOSS_CYCLE[(w / 5 - 1) % A2_BOSS_CYCLE.length];
}

// Modelleri bir kez yükle (sadece 2. arena seçilince). Yüklenirken tekrar çağrılırsa aynı söz döner.
let loading = null, loaded = false;
export const a2Loaded = () => loaded;
export function ensureArena2() {
  if (loaded) return Promise.resolve();
  if (!loading) loading = loadArena2Models([...new Set(Object.values(A2_DEFS).filter(d => d.a2).map(d => d.a2))]).then(() => { loaded = true; });
  return loading;
}

// KayKit hareket adı → yeni modelin hareket rolü (idle/walk/run/attack/alt/cast/hit/death)
function roleOf(name) {
  if (name === 'walk' || /Walk|Running/.test(name)) return 'walk';
  if (/Death/.test(name)) return 'death';
  if (/Hit_|Awaken/.test(name)) return 'hit';   // doğuşta kısa sarsılma (uzun "uyanma" yerine)
  if (/Throw|Spell|Cast|Magic/.test(name)) return 'cast';
  if (/Attack|Melee|Slam|Spin|Chop|Slice|Stab/.test(name)) return 'attack';
  return 'idle';
}
const clipCache = new Map();
export function a2Clip(key, name) {
  const id = key + '|' + name;
  if (clipCache.has(id)) return clipCache.get(id);
  const t = a2Template(key), def = A2_MODELS[key];
  let role = roleOf(name);
  if (role === 'cast' && !def.anim.cast) role = 'attack';
  const want = def.anim[role] || def.anim.idle;
  const clip = t.clips.find(c => c.name === want || c.name.endsWith('|' + want)) || t.clips.find(c => c.name.endsWith('|' + def.anim.idle)) || t.clips[0];
  clipCache.set(id, clip);
  return clip;
}

// Yeni model kopyası (game.js makeChar karşılığı)
export function makeA2Char(scene, key, cloneFn) {
  const obj = cloneFn(a2Template(key).scene);
  scene.add(obj);
  return { obj, blob: null, mixer: new THREE.AnimationMixer(obj), actions: {}, current: null, shadowOn: null, wp: {}, a2: key };
}

// KayKit iskeletine kor boyası: dokusu korunur, sıcak tonla çarpılır + hafif kor ışıması (malzeme kopyalanır, 1. arena etkilenmez)
const korCache = new Map();
export function paintKor(obj) {
  obj.traverse(m => {
    if (!m.isMesh) return;
    const conv = mt => {
      if (!korCache.has(mt)) {
        const c = mt.clone();
        c.color.setHex(0xa86a5c);   // isli, kömürleşmiş kemik
        if (c.emissive) { c.emissive.setHex(0x8a2400); c.emissiveIntensity = 0.45; }   // içten kor parıltısı
        korCache.set(mt, c);
      }
      return korCache.get(mt);
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}
