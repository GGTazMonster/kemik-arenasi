// =====================================================
//  Oyun verileri: düşmanlar, geliştirmeler, dükkan, güçlendirmeler
//  Denge ayarlarını buradan değiştirebilirsin.
// =====================================================

export const ENEMIES = {
  minion:  { name: 'Minion',  model: 'minion',  hp: 12, speed: 2.4, dmg: 5,  reach: 1.4, right: 'sAxe',   left: null,      walk: 'Skeletons_Walking', walkAnim: 1.3, xp: 1, radius: 0.45, gold: [0.15, 1], light: true },
  rogue:   { name: 'Haydut',  model: 'rogue',   hp: 9,  speed: 4.1, dmg: 5,  reach: 1.4, right: 'sBlade', left: null,      walk: 'Running_A',         walkAnim: 1.0, xp: 1, radius: 0.45, gold: [0.2, 1],  light: true },
  warrior: { name: 'Savaşçı', model: 'warrior', hp: 34, speed: 1.8, dmg: 10, reach: 1.6, right: 'sBlade', left: 'sShield', walk: 'Skeletons_Walking', walkAnim: 1.2, xp: 3, radius: 0.5,  gold: [0.35, 2] },
  mage:    { name: 'Büyücü',  model: 'mage',    hp: 18, speed: 2.0, dmg: 7,  ranged: true, right: 'sStaff', left: null,  walk: 'Walking_A',         walkAnim: 1.2, xp: 3, radius: 0.45, gold: [0.3, 2],  light: true },
  boss:    { name: 'Kemik Devi', model: 'warrior', hp: 420, speed: 1.7, dmg: 26, reach: 2.4, right: 'sAxe', left: 'sShield', walk: 'Skeletons_Walking', walkAnim: 0.9, xp: 40, radius: 1.1, gold: [1, 30], scale: 2.2, boss: true, ai: 'giant' },
  // Boss saldırı desenleri bosses.js'te (ai alanı). Dalga 5: Kemik Devi, 10: Kemik Nekromantı, 15: Gölge Haydut
  necro:   { name: 'Kemik Nekromantı', model: 'mage', hp: 400, speed: 1.9, dmg: 20, reach: 2.4, right: 'sStaff', left: null, walk: 'Walking_A', walkAnim: 1.0, xp: 60, radius: 1.0, gold: [1, 40], scale: 2.3, boss: true, ai: 'necro' },
  shade:   { name: 'Gölge Haydut', model: 'rogue', hp: 380, speed: 3.4, dmg: 22, reach: 2.2, right: 'sBlade', left: 'sBlade', walk: 'Running_A', walkAnim: 1.0, xp: 80, radius: 0.9, gold: [1, 50], scale: 2.0, boss: true, ai: 'shade' },
  // Gölge Haydut'un kopyası: tek atılma yapar, sonra toz olur
  shadeClone: { name: 'Gölge', model: 'rogue', hp: 25, speed: 0, dmg: 22, reach: 1.4, right: 'sBlade', left: 'sBlade', walk: 'Running_A', walkAnim: 1.0, xp: 1, radius: 0.45, gold: [0, 0], scale: 1.4, ai: 'clone', noScale: true },
  // Final boss (Dalga 20): 3 faz (%66 ve %33 canda yeni desenler) — bkz. bosses.js
  // denge 8 Kas: Kral dalgayla güçlenmiyor (noScale); 15. dalga Gölge Haydut'tan (~1550 can, ~47 hasar) zayıf kalıyordu → 2000/28 → 2600/45
  king:    { name: 'Kemik Kral', model: 'mage', hp: 2600, speed: 1.5, dmg: 45, reach: 2.6, right: 'sStaff', left: null, walk: 'Skeletons_Walking', walkAnim: 0.8, xp: 100, radius: 1.3, gold: [1, 60], scale: 2.8, boss: true, king: true, noScale: true, ai: 'king' },
};

export const FINAL_WAVE = 20;

// Dalga başına düşman güçlenmesi (1. dalga = x1). 10. dalgaya kadar eski eğri (başlangıç iyi, 10. dalga Nekromant duvarı aynı);
// 10. dalgadan sonra eğim artar (denge 10 Kas: geç oyun fazla kolaydı — veride 11. dalgadan sonra can hep %90+, dalgalar 20-30 sn).
// Karşılaştırma: Brotato 20. dalgada ortalama can x11, hasar x16 (hasar/dalga her düşmanda 0.6-1.15 sabit); bizde eskiden can x5, hasar x2,5.
export const WAVE_SCALE = { hp: 0.22, dmg: 0.08, lateFrom: 10, lateHp: 0.40, lateDmg: 0.16 };
export const waveHpMul = (w, S = WAVE_SCALE) => 1 + S.hp * (w - 1) + Math.max(0, w - S.lateFrom) * (S.lateHp - S.hp);
export const waveDmgMul = (w, S = WAVE_SCALE) => 1 + S.dmg * (w - 1) + Math.max(0, w - S.lateFrom) * (S.lateDmg - S.dmg);

// Elit düşman çarpanları (Dalga 3'ten itibaren; sandık düşürür)
export const ELITE = { hp: 6, dmg: 1.4, scale: 1.35, xp: 5 };

// Oynanabilir kahramanlar
//  attack: melee (önüne savurma) · spin (360°) · fast (çok hızlı savurma) · bolt (patlayan büyü) · arrow (delen ok)
//  mods: hp, armor, dmg, speed, crit = bonus; interval, range = temel değerin yerine geçer
export const HEROES = {
  knight:    { name: 'Şövalye', icon: '🛡️', model: 'knight',    right: 'sword',  left: 'shield', attack: 'melee', cost: 0,
               desc: 'Dengeli savaşçı. Kılıcıyla önündeki düşmanlara savurur.', perks: ['+40 maks. can', '%20 zırh', '+%15 hasar', 'Saniyede 1 can yeniler'], mods: { hp: 40, armor: 0.2, regen: 1, dmg: 0.15, interval: 0.78, range: 2.65 } },   // denge 7 Kas: başlangıç kahramanı daha rahat
  barbarian: { name: 'Barbar',  icon: '🪓', model: 'barbarian', right: 'axe2',   left: null,     attack: 'spin',  cost: 300, unlock: 'w10',
               desc: 'Çift elli baltasıyla etrafındaki herkese vurur.', perks: ['360° saldırı', '+%35 hasar', '+30 maks. can', 'Daha yavaş saldırı'], mods: { dmg: 0.35, hp: 30, armor: 0.1, interval: 1.1, range: 2.6 } },
  mage:      { name: 'Büyücü',  icon: '🔮', model: 'heroMage',  right: 'staff',  left: null,     attack: 'bolt',  cost: 500, unlock: 'boss1',
               desc: 'Uzaktan patlayan büyü topları fırlatır.', perks: ['Menzilli alan hasarı', 'Kutsal Dalga ile başlar', '-30 maks. can'], mods: { hp: -30, dmg: -0.15, interval: 1.05, range: 7.5 }, start: { nova: 1 } },
  ranger:    { name: 'Okçu',    icon: '🏹', model: 'ranger',    right: null,     left: 'bow',    attack: 'arrow', cost: 700, unlock: 'k1000',
               desc: 'Düşmanları delip geçen hızlı oklar atar.', perks: ['Oklar 2 düşmanı deler', '+%10 hareket hızı', 'Uzun menzil', '-10 maks. can'], mods: { hp: -10, dmg: -0.15, speed: 0.1, interval: 0.8, range: 8.5 } },
  rogue:     { name: 'Haydut',  icon: '🗡️', model: 'heroRogue', right: 'dagger', left: 'dagger', attack: 'fast',  cost: 1000, unlock: 'win',
               desc: 'Çok hızlı, kritik vuruşlarla ölümcül.', perks: ['+%15 kritik', '+%8 hız', 'Hançer Yağmuru ile başlar', '%10 zırh'], mods: { crit: 0.15, speed: 0.08, armor: 0.1, dmg: -0.18, interval: 0.5, range: 2.1 }, start: { dagger: 1 } },   // denge 7-8 Kas: veri: 33. dalga, can hiç %93 altına inmedi
};

// Silah evrimleri: ana silah 5. seviye + gereken pasif ≥1 → seviye atlarken / sandıktan çıkar
export const EVOS = [
  { id: 'storm', base: 'dagger', req: 'crit',  icon: '🌪️', name: 'Ölüm Fırtınası', desc: 'Hançerler tüm düşmanları deler, +3 hançer, 2x atış hızı' },
  { id: 'aegis', base: 'orbit',  req: 'hp',    icon: '🔆', name: 'Kutsal Siper',   desc: 'Kalkanlar büyür, daha geniş vurur, 2x hasar' },   // denge 9 Kas: artık mermi silmiyor
  { id: 'sun',   base: 'nova',   req: 'regen', icon: '☀️', name: 'İlahi Patlama',  desc: 'Dalga 1.6x geniş, 2x hasar, her patlamada 4 can' },
];

// Görevler — tamamlanınca ödül anında verilir
export const QUESTS = [
  { id: 'k100',    text: 'Toplam 100 iskelet devir',        stat: 'totalKills', n: 100,  reward: { gold: 50 } },
  { id: 'w5',      text: "Dalga 5'e ulaş",                  stat: 'bestWave',   n: 5,    reward: { gold: 50 } },
  { id: 'boss1',   text: "Kemik Devi'ni devir",             stat: 'bossKills',  n: 1,    reward: { hero: 'mage' } },
  { id: 'w10',     text: "Dalga 10'a ulaş",                 stat: 'bestWave',   n: 10,   reward: { hero: 'barbarian' } },
  { id: 'elite10', text: '10 elit düşman devir',            stat: 'eliteKills', n: 10,   reward: { gold: 80 } },
  { id: 'evo',     text: 'Bir silahı evrimleştir',          stat: 'evolutions', n: 1,    reward: { gold: 150 } },
  { id: 'combo50', text: '50\'lik öldürme serisi yap',       stat: 'bestCombo',  n: 50,   reward: { gold: 80 } },
  { id: 'lvl20',   text: 'Tek koşuda 20. seviyeye ulaş',    stat: 'bestLevel',  n: 20,   reward: { gold: 100 } },
  { id: 'k1000',   text: 'Toplam 1000 iskelet devir',       stat: 'totalKills', n: 1000, reward: { hero: 'ranger' } },
  { id: 'win',     text: 'Bir koşuyu kazan (Dalga 20)',     stat: 'wins',       n: 1,    reward: { hero: 'rogue' } },
  { id: 'k5000',   text: 'Toplam 5000 iskelet devir',       stat: 'totalKills', n: 5000, reward: { gold: 300 } },
  { id: 'win3',    text: '3 koşu kazan',                    stat: 'wins',       n: 3,    reward: { gold: 400 } },
];

// Koşu içi (geçici) geliştirmeler — seviye atlayınca seçilir, koşu bitince sıfırlanır
export const UPGRADES = [
  { id: 'dmg',    icon: '⚔️', name: 'Keskin Kılıç',    max: 5, desc: () => 'Tüm hasar +%25' },
  { id: 'aspd',   icon: '⚡', name: 'Çevik Kol',        max: 5, desc: () => 'Saldırı hızı +%15' },
  { id: 'area',   icon: '🌀', name: 'Geniş Savuruş',    max: 5, desc: () => 'Saldırı menzili ve alanı +%15' },
  { id: 'speed',  icon: '👢', name: 'Hafif Adımlar',    max: 5, desc: () => 'Hareket hızı +%10' },
  { id: 'hp',     icon: '❤️', name: 'Demir Yürek',      max: 5, desc: () => 'Maks. can +25 ve 25 can yeniler' },
  { id: 'regen',  icon: '✚',  name: 'Yenilenme',        max: 5, desc: () => 'Saniyede +0,4 can yeniler' },
  { id: 'crit',   icon: '🎯', name: 'Kritik Vuruş',     max: 5, desc: () => '+%8 kritik şansı (2x hasar)' },
  { id: 'vamp',   icon: '🩸', name: 'Kan Emici',        max: 3, desc: () => 'Her öldürmede +0,5 can (en çok 3 can/sn)' },
  { id: 'magnet', icon: '🧲', name: 'Mıknatıs',         max: 3, desc: () => 'Toplama alanı +%60' },
  { id: 'dagger', icon: '🗡️', name: 'Hançer Yağmuru',   max: 5, desc: l => l === 0 ? 'En yakın düşmana otomatik hançer fırlatır' : '+1 hançer, daha sık atış' },
  { id: 'orbit',  icon: '🛡️', name: 'Dönen Kalkanlar',  max: 5, desc: l => l === 0 ? 'Etrafında dönen ve çarpan bir kalkan' : '+1 kalkan, +%15 hasar' },
  { id: 'nova',   icon: '✨', name: 'Kutsal Dalga',     max: 5, offerW: 0.7, desc: l => l === 0 ? 'Belli aralıklarla etrafa hasar dalgası' : 'Daha sık, daha geniş, daha güçlü' },
];

// Kalıcı geliştirmeler — altınla ana menüden alınır, kaydedilir
export const SHOP = [
  { id: 'power',    icon: '⚔️', name: 'Güç',            max: 10, base: 20,  desc: '+%8 hasar' },
  { id: 'vitality', icon: '❤️', name: 'Dayanıklılık',   max: 10, base: 20,  desc: '+10 maks. can' },
  { id: 'swift',    icon: '👢', name: 'Çeviklik',       max: 5,  base: 30,  desc: '+%5 hareket hızı' },
  { id: 'armor',    icon: '🛡️', name: 'Zırh',           max: 5,  base: 40,  desc: 'Alınan hasar -%6' },
  { id: 'greed',    icon: '💰', name: 'Açgözlülük',     max: 5,  base: 30,  desc: '+%15 altın' },
  { id: 'wisdom',   icon: '📘', name: 'Bilgelik',       max: 5,  base: 30,  desc: '+%10 tecrübe' },
  { id: 'reroll',   icon: '🎲', name: 'Yeniden Seçim',  max: 3,  base: 60,  desc: 'Her koşuda +1 yeniden seçim hakkı' },
  { id: 'revive',   icon: '👼', name: 'İkinci Şans',    max: 1,  base: 250, desc: 'Ölünce bir kez %50 canla dirilirsin' },
];
export const shopCost = (item, lv) => Math.round(item.base * Math.pow(1.6, lv));

// Kahramana özel kalıcı yetenekler (yetenek ağacı) — altınla alınır, sadece o kahramanda geçerli.
// Maliyet: shopCost ile aynı formül (base × 1.6^seviye). Etkiler talents.js'te uygulanır.
export const HERO_TALENTS = {
  knight: [
    { id: 'block',   icon: '🛡️', name: 'Kalkan Bloğu',  max: 5, base: 40, desc: 'Gelen saldırıyı tamamen engelleme şansı +%3' },
    { id: 'heavy',   icon: '⚔️', name: 'Ağır Kılıç',    max: 5, base: 30, desc: '+%7 hasar, savurma menzili +%3' },
    { id: 'shove',   icon: '💥', name: 'Geri İtme',     max: 3, base: 40, desc: 'Savurmalar düşmanları %60 daha güçlü iter' },
    { id: 'oath',    icon: '✝️', name: 'Kutsal Yemin',  max: 3, base: 60, desc: 'Canın %35 altındayken alınan hasar -%9, yenilenme +1/sn' },
    { id: 'riposte', icon: '⚡', name: 'Misilleme',     max: 3, base: 70, desc: 'Blokladığın her saldırı etrafa hasar dalgası yayar (+%50 güç)' },
  ],
  barbarian: [
    { id: 'bloodlust', icon: '🩸', name: 'Kan Hırsı',     max: 5, base: 35, desc: 'Kaybettiğin can oranında saldırı hızı (en fazla +%10)' },
    { id: 'wideaxe',   icon: '🪓', name: 'Geniş Balta',   max: 5, base: 30, desc: 'Dönüş menzili +%5' },
    { id: 'quake',     icon: '🌋', name: 'Deprem',        max: 3, base: 60, desc: 'Her birkaç dönüşte bir şok dalgası (4 → 3 → 2 dönüşte bir)' },
    { id: 'hide',      icon: '🐻', name: 'Barbar Derisi', max: 5, base: 25, desc: '+15 maks. can, +0,3 can yenileme' },
    { id: 'feast',     icon: '🍖', name: 'Savaş Ziyafeti', max: 3, base: 50, desc: 'Dönüşün vurduğu her düşman için +0,2 can (en çok 6 düşman)' },
  ],
  mage: [
    { id: 'chain',  icon: '🔗', name: 'Zincirleme Büyü', max: 3, base: 60, desc: 'Patlama yakındaki düşmanlara +1 küçük büyü sektirir' },
    { id: 'power',  icon: '🌀', name: 'Büyü Gücü',      max: 5, base: 30, desc: 'Patlama alanı +%12' },
    { id: 'shield', icon: '🔷', name: 'Mana Kalkanı',   max: 5, base: 40, desc: 'Hasar emen kalkan (+5 emme); 6 sn hasar almazsan yeniden dolar' },
    { id: 'quick',  icon: '⚡', name: 'Hızlı Büyü',     max: 5, base: 30, desc: 'Büyü atış hızı +%6' },
    { id: 'focus',  icon: '🔮', name: 'Arkan Odak',     max: 5, base: 35, desc: '+%6 hasar, +%2,5 kritik' },
  ],
  ranger: [
    { id: 'multi',  icon: '🎯', name: 'Çoklu Atış',   max: 2, base: 90, desc: 'Yelpaze şeklinde +1 ok (%60 hasar)' },
    { id: 'eye',    icon: '👁️', name: 'Keskin Göz',   max: 5, base: 30, desc: '+%4 kritik, kritik hasarı +%8' },
    { id: 'pierce', icon: '➶',  name: 'Delici Ok',    max: 3, base: 45, desc: 'Oklar +1 düşman deler, +%4 hasar' },
    { id: 'feet',   icon: '🍃', name: 'Hafif Ayak',   max: 4, base: 35, desc: 'Atılma bekleme süresi -%15, hareket hızı +%4' },
    { id: 'hunter', icon: '🦌', name: 'Avcı İşareti', max: 3, base: 50, desc: 'Elit ve bosslara +%12 hasar' },
  ],
  rogue: [
    { id: 'poison', icon: '🧪', name: 'Zehirli Bıçak', max: 5, base: 35, desc: 'Hançer vuruşları zehirler: 3 sn boyunca vuruş hasarının %15\'i/sn' },
    { id: 'shadow', icon: '🌑', name: 'Gölge Adım',    max: 3, base: 50, desc: 'Atılmadan sonra kısa süre tüm vuruşlar kritik (+0,5 sn)' },
    { id: 'blades', icon: '🗡️', name: 'Bıçak Ustası',  max: 3, base: 60, desc: 'Hançer Yağmuru +1 hançer fırlatır' },
    { id: 'evade',  icon: '💨', name: 'Kaçamak',       max: 5, base: 35, desc: 'Saldırılardan kaçınma şansı +%5' },
    { id: 'assassin', icon: '☠️', name: 'Suikastçı',    max: 4, base: 40, desc: 'Kritik hasarı +%15' },
  ],
};

// Yerden toplanan süreli güçlendirmeler
export const BUFFS = {
  potion: { icon: '🧪', name: 'Can İksiri',    color: 0xff4d6d, weight: 40 },
  fury:   { icon: '🔥', name: 'Öfke',          color: 0xff8a1f, weight: 20, dur: 8, desc: 'Saldırı hızı x2' },
  haste:  { icon: '💨', name: 'Rüzgar',        color: 0x5fd4ff, weight: 20, dur: 8, desc: 'Hareket hızı x1.5' },
  holy:   { icon: '🌟', name: 'Kutsal Kalkan', color: 0xffe066, weight: 10, dur: 6, desc: 'Hasar almazsın' },
  magnet: { icon: '🧲', name: 'Büyük Mıknatıs', color: 0xb07cff, weight: 10, desc: 'Tüm tecrübe taşlarını çeker' },
};
export const BUFF_DROP_CHANCE = 0.035;

// =====================================================
//  KAHRAMAN SEVİYESİ (altınla, 0..20) — her kahramanın kendine özgü 20 adımlık yolu
//  kind: 'stat' (küçük kalıcı bonus) · 'talent' (HERO_TALENTS seviyesi açar, n kadar) · 'milestone' (dönüm noktası)
//  Dönüm noktaları: Sv.5 imza yetenek (big) · Sv.10 silah görünümü · Sv.15 saldırı değişimi · Sv.20 Süper ustalığı
//  stat anahtarları: hp, armor, dmg, crit, speed, range, area (oranlar 0.04 = %4)
// =====================================================
export const HERO_MAX_LV = 20;
export const heroLevelCost = lv => Math.round(18 * Math.pow(1.15, lv));   // lv = mevcut seviye (0..19) → sonrakine geçiş; 0→20 toplam ≈ 1850 altın
const stat = (lv, name, icon, s, desc) => ({ lv, kind: 'stat', name, icon, stat: s, desc });
const tal = (lv, talent, n = 1, big = false) => ({ lv, kind: 'talent', talent, n, big });
const mile = (lv, id, name, icon, desc, s = {}) => ({ lv, kind: 'milestone', id, name, icon, desc, stat: s });

export const HERO_PATHS = {
  // Şövalye: can + zırh + blok; kalkan ve kılıç ustası
  knight: [
    stat(1, 'Çelik Kalp', '❤️', { hp: 12 }, '+12 maks. can'),
    tal(2, 'heavy'), tal(3, 'block'),
    stat(4, 'Zırh Takviyesi', '🛡️', { armor: 0.03 }, 'Alınan hasar -%3'),
    tal(5, 'riposte', 1, true),
    tal(6, 'block'),
    stat(7, 'Çelik Kalp II', '❤️', { hp: 12 }, '+12 maks. can'),
    tal(8, 'shove'), tal(9, 'heavy', 2),
    mile(10, 'weapon', 'İki Elli Kılıç & Dikenli Kalkan', '⚔️', 'Görünümün yükselir: büyük kılıç ve dikenli kalkan. +%6 hasar, -%3 alınan hasar', { dmg: 0.06, armor: 0.03 }),
    tal(11, 'oath'),
    stat(12, 'Zırh Takviyesi II', '🛡️', { armor: 0.03 }, 'Alınan hasar -%3'),
    tal(13, 'heavy', 2), tal(14, 'block', 2),
    mile(15, 'attack', 'Kalkan Dalgası', '🌊', 'Her 3. savurma önüne uzanan bir şok dalgası yollar (+%80 hasar, güçlü itme)', { dmg: 0.04 }),
    tal(16, 'shove', 2), tal(17, 'oath', 2), tal(18, 'riposte', 2), tal(19, 'block'),
    mile(20, 'super', 'Kalkan Hücumu Ustalığı', '🛡️', 'Süper güçlenir: daha uzun ve geniş hücum, bitişte şok dalgası, daha hızlı dolum', { hp: 15, armor: 0.02 }),
  ],
  // Barbar: ham hasar + can, kan hırsı; dönüş ustası
  barbarian: [
    stat(1, 'Öfke', '😤', { dmg: 0.04 }, '+%4 hasar'),
    tal(2, 'hide'), tal(3, 'wideaxe'),
    stat(4, 'Kalın Boyun', '💪', { hp: 12 }, '+12 maks. can'),
    tal(5, 'quake', 1, true),
    tal(6, 'bloodlust'),
    stat(7, 'Öfke II', '😤', { dmg: 0.04 }, '+%4 hasar'),
    tal(8, 'hide', 2), tal(9, 'wideaxe', 2),
    mile(10, 'weapon', 'Çift Balta', '🪓', 'Görünümün yükselir: devasa balta + ikinci bir balta. +%6 hasar, +10 maks. can', { dmg: 0.06, hp: 10 }),
    tal(11, 'feast'),
    stat(12, 'Kalın Boyun II', '💪', { hp: 12 }, '+12 maks. can'),
    tal(13, 'bloodlust', 2), tal(14, 'hide', 2),
    mile(15, 'attack', 'Parçalayıcı Dönüş', '🌀', 'Her dönüş dışa doğru bir şok halkası daha yollar (menzil x1,6, %50 hasar, itme)', { hp: 8 }),
    tal(16, 'quake', 2), tal(17, 'feast', 2), tal(18, 'wideaxe', 2), tal(19, 'bloodlust', 2),
    mile(20, 'super', 'Kasırga Ustalığı', '🌪️', 'Süper güçlenir: daha uzun, daha geniş ve daha sert kasırga, daha hızlı dolum', { dmg: 0.06, hp: 10 }),
  ],
  // Büyücü: alan + hasar; patlama ustası
  mage: [
    stat(1, 'Geniş Odak', '🔭', { area: 0.05 }, 'Büyü alanı +%5'),
    tal(2, 'focus'), tal(3, 'quick'),
    stat(4, 'Arkan Güç', '✨', { dmg: 0.05 }, '+%5 hasar'),
    tal(5, 'chain', 1, true),
    tal(6, 'power'),
    stat(7, 'Geniş Odak II', '🔭', { area: 0.05 }, 'Büyü alanı +%5'),
    tal(8, 'shield', 3), tal(9, 'focus', 2),
    mile(10, 'weapon', 'Asa & Büyü Kitabı', '📖', 'Görünümün yükselir: büyük asa ve açık büyü kitabı. +%6 hasar, +%5 alan', { dmg: 0.06, area: 0.05 }),
    tal(11, 'quick', 2),
    stat(12, 'Arkan Güç II', '✨', { dmg: 0.05 }, '+%5 hasar'),
    tal(13, 'power', 2), tal(14, 'shield', 2),
    mile(15, 'attack', 'Büyük Patlama', '💥', 'Büyü topları çok daha büyük patlar (alan +%35, hasar +%15)', {}),
    tal(16, 'chain', 2), tal(17, 'power', 2), tal(18, 'focus', 2), tal(19, 'quick', 2),
    mile(20, 'super', 'Meteor Yağmuru Ustalığı', '☄️', 'Süper güçlenir: daha fazla ve daha büyük meteor, daha hızlı dolum', { dmg: 0.06, area: 0.05 }),
  ],
  // Okçu: kritik + menzil; keskin nişancı
  ranger: [
    stat(1, 'Keskin Nişan', '🎯', { crit: 0.03 }, '+%3 kritik şansı'),
    tal(2, 'eye'), tal(3, 'feet'),
    stat(4, 'Uzun Nişan', '📏', { range: 0.04 }, 'Menzil +%4'),
    tal(5, 'multi', 1, true),
    tal(6, 'pierce'),
    stat(7, 'Keskin Nişan II', '🎯', { crit: 0.03 }, '+%3 kritik şansı'),
    tal(8, 'eye', 2), tal(9, 'hunter'),
    mile(10, 'weapon', 'Arbalet', '🏹', 'Görünümün yükselir: ağır arbalet. +%6 hasar, menzil +%4', { dmg: 0.06, range: 0.04 }),
    tal(11, 'feet'), tal(12, 'pierce'), tal(13, 'multi'), tal(14, 'eye', 2),
    mile(15, 'attack', 'Fazladan Ok', '➕', 'Her atışta +1 ok daha ve oklar +1 düşman deler', { crit: 0.02 }),
    tal(16, 'pierce'),
    stat(17, 'Uzun Nişan II', '📏', { range: 0.04 }, 'Menzil +%4'),
    tal(18, 'feet', 2), tal(19, 'hunter', 2),
    mile(20, 'super', 'Ok Yağmuru Ustalığı', '🌧️', 'Süper güçlenir: daha geniş alan, çok daha fazla ok, daha hızlı dolum', { crit: 0.04, dmg: 0.04 }),
  ],
  // Haydut: hız + kritik; gölge katili
  rogue: [
    stat(1, 'Hafif Adım', '👟', { speed: 0.03 }, 'Hareket hızı +%3'),
    tal(2, 'assassin'), tal(3, 'evade'),
    stat(4, 'Ölümcül Göz', '🎯', { crit: 0.03 }, '+%3 kritik şansı'),
    tal(5, 'shadow', 1, true),
    tal(6, 'poison'),
    stat(7, 'Hafif Adım II', '👟', { speed: 0.03 }, 'Hareket hızı +%3'),
    tal(8, 'evade', 2), tal(9, 'blades', 2),
    mile(10, 'weapon', 'Kısa Kılıç & Hançer', '🗡️', 'Görünümün yükselir: kısa kılıç ve iri hançer. +%6 hasar, +%3 kritik', { dmg: 0.06, crit: 0.03 }),
    tal(11, 'poison', 2), tal(12, 'blades'), tal(13, 'assassin'), tal(14, 'shadow'),
    mile(15, 'attack', 'Çifte Bıçak', '⚔️', 'Vuruşların %40 ihtimalle ikinci kez isabet eder (%70 hasar)', { speed: 0.02 }),
    tal(16, 'assassin', 2), tal(17, 'evade', 2), tal(18, 'poison', 2), tal(19, 'shadow'),
    mile(20, 'super', 'Gölge Dansı Ustalığı', '🌑', 'Süper güçlenir: 9 düşmana ışınlanma, daha sert vuruşlar, daha hızlı dolum', { crit: 0.04, speed: 0.04 }),
  ],
};

// Sv.10 silah görünümü (game.js setHero → ADV model anahtarları). scale: [sağ, sol]
export const HERO_WEAPONS = {
  knight:    { name: 'İki Elli Kılıç & Dikenli Kalkan', right: 'sword2', left: 'shieldSp', scale: [1, 1] },
  barbarian: { name: 'Çift Balta',                      right: 'axe2',   left: 'axe1',     scale: [1.3, 1.1] },
  mage:      { name: 'Asa & Büyü Kitabı',               right: 'staff',  left: 'book',     scale: [1.25, 1] },
  ranger:    { name: 'Arbalet',                         right: null,     left: 'xbow',     scale: [1, 1] },
  rogue:     { name: 'Kısa Kılıç & Hançer',             right: 'sword',  left: 'dagger',   scale: [0.85, 1.5] },
};

// Süper yetenekler (kullanım: E / Q ya da mobilde ⚡ butonu; öldürme/hasarla dolar). Mantık: super.js
HEROES.knight.super    = { name: 'Kalkan Hücumu', icon: '🛡️', desc: 'İleri hücum eder; yoldaki düşmanları iter ve ezer, hücum boyunca dokunulmazsın.' };
HEROES.barbarian.super = { name: 'Kasırga',       icon: '🌪️', desc: '3 sn boyunca hareket ederken etrafında dönen kasırga sürekli alan hasarı verir.' };
HEROES.mage.super      = { name: 'Meteor Yağmuru', icon: '☄️', desc: 'En kalabalık bölgelere 6 meteor düşürür (önce yerde uyarı belirir).' };
HEROES.ranger.super    = { name: 'Ok Yağmuru',    icon: '🌧️', desc: 'Geniş bir alana gökten ok yağdırır.' };
HEROES.rogue.super     = { name: 'Gölge Dansı',   icon: '🌑', desc: 'En yakın 6 düşmana ışınlanıp her birine kritik vuruş yapar.' };
