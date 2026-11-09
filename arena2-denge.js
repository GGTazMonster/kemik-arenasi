// =====================================================
//  2. Arena (Kızıl Dökümhane) — DENGE SAYILARI
//  Sahibi: "Dengeleme" sohbeti. Bölümler sohbeti bu dosyayı arena2.js'ten içe aktarır, sayıları burada değiştirmez.
//  Görünüm (model, boy, boya, hareket) arena2-models.js'te; buradaki `model` anahtarları oradaki A2_MODELS ile aynı.
//
//  NASIL ÇALIŞIR
//  1) Tüm can/hasar sayıları "1. arena birimi"dir: game.js spawnEnemy 1. arenanın dalga formülünü aynen uygular
//     (can ×(1+0.22(w-1)), hasar ×(1+0.08(w-1)), Kahraman Seviyesi etkisi) — Kral gibi noScale olanlar hariç.
//  2) Üstüne TEK BİR arena çarpanı biner: A2_MUL → koşu başlarken `run.mul = A2_MUL` (game.js spawnEnemy bunu
//     tüm düşmanlara, boss'lar ve noScale dahil, uygular). Zorluk ince ayarı tek düğmeden yapılır.
//  3) Ödüller: altın A2_REWARD.gold ile çarpılır (game.js altın toplama noktasında uygulanmalı).
//
//  NEDEN 2.0 / 1.6? (bot ölçümü, 8 Kasım 2026 — 1. arenada tüm düşmanlar çarpanla; Okçu/Büyücü/Şövalye/Barbar)
//  Her koşu 1. seviyeden başlar, koşu içi güçlendirmeler sıfırlanır → 2. arenaya giren kahramanın gücü
//  1. arenanın 15. dalgası değil, sadece KALICI ilerlemesi kadardır (dükkan + Kahraman Seviyesi):
//    P0 "Kral'ı yeni yendi"  : dükkan yok, Sv.0                         (~0 altın)
//    P1 "orta"               : Güç 5, Dayanıklılık 5, Zırh 2, Çeviklik 2, Sv.10   (~1200 altın ≈ 1 kazanılmış koşu)
//    P2 "ileri"              : dükkan neredeyse tam + İkinci Şans, Sv.20          (~10500 altın)
//  Sonuç (çarpan = can; hasar = 1 + 0.6·(çarpan-1)):
//    ×1.5 → P0: 10/5/20/18. dalga  · P1: 3/4 kazanır      · P2: 4/4 kazanır (can ≥%80)
//    ×2.0 → P0: 13/5/5/5. dalga    · P1: 12 koşuda 4 kazanma (Okçu 0/3, ölümler D10-18) · P2: 4/4 kazanır (can %48-79)
//    ×2.5 → P0: 3-5. dalga         · P1: ~yarısı, zor     · P2: 4/4 kazanır (can %30-71)
//    ×3.5 → P2 Şövalye kazandı (can %28) → tam güçlü oyuncunun sonsuz modda bolca payı var
//  Arena şekli (9 Kas, 1. arena düşmanları, çarpan 1, P0, 8'er koşu): daire 4/8 kazanma (ölümler D6-13),
//  dikdörtgen 26×40 5/8 (ölümler D14-20) → şekil biraz kolaylaştırıyor ama küçük; A2_MUL şimdilik aynı kalsın.
//  GERÇEK 2. ARENA ÖLÇÜMÜ (9 Kas, botRun {arena:2}):
//    İlk ayar (×2.0/1.6, Cellat 170/15, tank+ejder D4): P0 4/4 D4-5'te ölür · P1 0/8 (çoğu D4-6, katil: elit Cellat) · P2 3/4
//    Son ayar (×1.8/1.5, Cellat 110/9, Muhafız hasar 9, tank+ejder D5): P0 D5-8'de ölür · P1 7/12 kazanır
//      (Şövalye 3/3, Barbar 3/3, Büyücü 1/3, Okçu 0/3; menzillilerin duvarı D10 Cüruf Devi) · P2 4/4 kazanır (can %55-88)
//  Seçim ×2.0: Kral'ı yeni yenen oyuncu ilk denemelerde 5-13. dalgada düşer, altınla güçlenip döner
//  (kullanıcının "ölüp geliştirsin" isteği); ~1 koşuluk yatırımla yarı yarıya kazanılır; tam güçlenen için sonsuz mod.
// =====================================================

// 9 Kas: gerçek 2. arena düşmanlarıyla ölçüm → 2.0/1.6'da orta oyuncu 8/8 kaybetti (çoğu D4-5) → 1.8/1.5
export const A2_MUL = { hp: 1.8, dmg: 1.5 };
export const A2_REWARD = { gold: 1.5, xp: 1 };   // 1. arenada kazanılan koşu ≈1200 altın → 2. arenada ≈1800+

// Düşmanlar — alanlar data.js ENEMIES ile aynı anlamda (hp, speed, dmg, reach/ranged, xp, radius, gold: [şans, miktar], light: geri itilir)
// Karşılaştırma için 1. arena: Minion 12/2.4/5 · Haydut 9/4.1/5 · Savaşçı 34/1.8/10 · Büyücü 18/2.0/7 (menzilli)
export const A2_ENEMIES = {
  // Sürü (1. arenanın Minion'u yerine)
  ember:    { name: 'Kor İskelet',     model: 'kaykit:minion', hp: 13, speed: 2.6, dmg: 5,  reach: 1.4, xp: 1, radius: 0.45, gold: [0.15, 1], light: true },
  // Hızlı yakın dövüş (Haydut yerine)
  alien:    { name: 'Cüruf Gözcüsü',   model: 'alien',     hp: 14, speed: 3.9, dmg: 6,  reach: 1.4, xp: 1, radius: 0.5,  gold: [0.2, 1],  light: true },
  // Uçan sürü: hızlı, kırılgan; az hasar ama kalabalık gelir
  tribal:   { name: 'Kor Maskesi',     model: 'tribal',    hp: 8,  speed: 4.4, dmg: 4,  reach: 1.3, xp: 1, radius: 0.45, gold: [0.15, 1], light: true, fly: true },
  ashwing:  { name: 'Kül Kanat',       model: 'alpaking',  hp: 16, speed: 3.6, dmg: 6,  reach: 1.5, xp: 2, radius: 0.55, gold: [0.25, 1], light: true, fly: true },
  // Orta yakın dövüş
  bellows:  { name: 'Körük Bekçisi',   model: 'monkroose', hp: 26, speed: 2.3, dmg: 8,  reach: 1.6, xp: 2, radius: 0.55, gold: [0.3, 1] },
  // Tank (Savaşçı yerine): yavaş, çok canlı
  guard:    { name: 'Demirci Muhafız', model: 'kaykit:warrior', hp: 48, speed: 1.6, dmg: 9, reach: 1.6, xp: 4, radius: 0.55, gold: [0.4, 2] },
  cactoro:  { name: 'Çivili Kalfa',    model: 'cactoro',   hp: 38, speed: 1.9, dmg: 10, reach: 1.7, xp: 3, radius: 0.55, gold: [0.35, 2] },
  // Bölünen: ölünce 2 Cüruf Damlası (toplam etkin can 26 + 2×8 = 42)
  slag:     { name: 'Cüruf Balçığı',   model: 'blob_big',  hp: 26, speed: 1.9, dmg: 8,  reach: 1.5, xp: 2, radius: 0.7,  gold: [0.3, 1],  split: { into: 'drop', n: 2 } },
  drop:     { name: 'Cüruf Damlası',   model: 'blob_small', hp: 8, speed: 3.0, dmg: 4,  reach: 1.2, xp: 1, radius: 0.4,  gold: [0.1, 1],  light: true },
  // Menzilli (Büyücü yerine): ateş topu 1. arenanın büyü topu gibi (hız 6.5, yana çekilince kaçılır)
  drake:    { name: 'Kor Ejderi',      model: 'dragon',    hp: 22, speed: 2.0, dmg: 7,  ranged: true, shotSpeed: 6.5, xp: 3, radius: 0.6, gold: [0.3, 2], fly: true },
  // Elit: ELITE çarpanı UYGULANMAZ (zaten güçlü tanımlı), sandık düşürür
  // 9 Kas: 170/15 → 110/10 (bot: orta oyuncuyu D4'te tek başına öldürüyordu; 1. arenada D4-5 eliti güçlendirilmiş Minion ≈ 72 can / 7 hasar)
  orc:      { name: 'Zincirli Cellat', model: 'orc',       hp: 110, speed: 1.9, dmg: 9, reach: 2.2, xp: 15, radius: 0.8, gold: [1, 6], elite: true },

  // Boss'lar — 1. arena boss'larına yakın tabanlar (A2_MUL ve dalga formülü üstüne biner)
  ashking:  { name: 'Kül Kanat Kralı', model: 'alpaking_evo', hp: 430, speed: 2.0, dmg: 24, reach: 2.6, xp: 40, radius: 1.2, gold: [1, 40], boss: true, fly: true },
  slaggiant:{ name: 'Cüruf Devi',      model: 'puglin',    hp: 420, speed: 1.6, dmg: 24, reach: 2.6, xp: 60, radius: 1.3, gold: [1, 55], boss: true },
  imp:      { name: 'İblis Lordu',     model: 'imp',       hp: 380, speed: 2.6, dmg: 24, reach: 2.4, xp: 80, radius: 1.1, gold: [1, 70], boss: true },
  // Final (D20): dalgayla güçlenmez (Kral gibi noScale); A2_MUL ile ≈ 5600 can / 77 hasar
  moltendragon: { name: 'Erimiş Ejder', model: 'dragon_evo', hp: 2800, speed: 1.5, dmg: 48, reach: 3.0, xp: 120, radius: 1.6, gold: [1, 90], boss: true, king: true, noScale: true },
};

export const A2_FINAL_WAVE = 20;
export const A2_BOSSES = { 5: 'ashking', 10: 'slaggiant', 15: 'imp', 20: 'moltendragon' };
// Sonsuz modda boss sırası (25, 30, 35…): 1. arenadaki gibi döner
export const A2_BOSS_CYCLE = ['ashking', 'slaggiant', 'imp'];

// Dalga içeriği: ağırlıklı rastgele seçim (game.js pickType gibi). Yeni türler kademeli girer.
export function a2PickType(w) {
  const o = [['ember', 5]];
  if (w >= 2) o.push(['bellows', 1.5 + w * 0.1]);
  if (w >= 2) o.push(['tribal', 2]);               // uçan sürü erken gelir (kolay ama yeni)
  if (w >= 3) o.push(['slag', 1.2 + w * 0.08]);
  if (w >= 5) o.push(['guard', 1 + w * 0.15]);     // 9 Kas: 4 → 5 (D4'te tank + ejder + elit aynı anda geliyordu)
  if (w >= 5) o.push(['drake', 0.5 + w * 0.15]);   // menzilliler yavaş artar (1. arenadaki büyücü dersi)
  if (w >= 6) o.push(['alien', 2]);
  if (w >= 7) o.push(['ashwing', 1 + w * 0.08]);
  if (w >= 9) o.push(['cactoro', 0.8 + w * 0.12]);
  let r = Math.random() * o.reduce((s, x) => s + x[1], 0);
  for (const [t, wt] of o) { r -= wt; if (r <= 0) return t; }
  return 'ember';
}
// Dalga büyüklüğü 1. arenayla aynı (5 + 3w; boss dalgasında 4 + 1.2w / 2w eşlikçi).
// Elit (Zincirli Cellat): çift dalgalarda 1, D14'ten sonra 2 — 1. arenayla aynı kural, ama tür her zaman 'orc'.
export const a2Elites = w => (w >= 4 && w % 2 === 0 ? (w >= 14 ? 2 : 1) : 0);
