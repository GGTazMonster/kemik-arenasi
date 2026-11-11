// Ses dosyası eşlemesi (10 Kasım 2026, kullanıcının seçtiği CC0 sesler; kaynaklar: sounds/KAYNAKLAR.md).
// Burada olmayan efektler WebAudio sentezi olarak çalmaya devam eder.
// Değer bir dizi ise her çalışta rastgele biri seçilir.
export const SFX_FILES = {
  swing: 'sfx/swing.mp3',                                  // kılıç / balta savurma
  hit: ['sfx/hit1.ogg', 'sfx/hit2.ogg'],                   // vuruş
  kill: ['sfx/kill1.ogg', 'sfx/kill2.ogg'],                // iskelet dağılması
  dagger: ['sfx/shot1.mp3', 'sfx/shot2.mp3', 'sfx/shot3.wav'], // ok / hançer fırlatma
  arrowHit: 'sfx/arrowHit.ogg',                            // ok yağmuru çarpması
  shadow: 'sfx/shadow.mp3',                                // Haydut süper: gölge dansı
  blade: 'sfx/blade.ogg',                                  // Gölge Haydut bıçağı
  slam: 'sfx/slam.mp3',                                    // yere vuruş, boss girişi
  teleport: 'sfx/teleport.mp3',                            // ışınlanma
  nova: 'sfx/nova.ogg',                                    // büyü topu, Kutsal Dalga
  hurt: 'sfx/hurt.ogg',                                    // kahraman yaralanınca
  roar: ['sfx/roar1.mp3', 'sfx/roar2.mp3', 'sfx/roar3.ogg'], // boss faz kükremesi
  boss: 'sfx/boss.mp3',                                    // boss geliyor
  coin: 'sfx/coin.ogg',
  chest: 'sfx/chest.ogg',
  gem: 'sfx/gem.ogg',
  warn: 'sfx/warn.ogg',                                    // boss saldırı uyarısı (metal çınlama)
  shock: 'sfx/shock.ogg',                                  // şok dalgası
  meteorHit: 'sfx/shock.ogg',                              // meteor çarpması
};
// Dosya bazlı ses düzeyi (varsayılan 0.8)
export const SFX_VOL = { roar: 0.7, warn: 0.5, hit: 0.6, coin: 0.6, gem: 0.5 };
// Müzik adı (menu/savas/boss/zafer/yenilgi) -> sounds/ altındaki yol
// savas2 = 2. bölüm (Kızıl Dökümhane) savaş müziği; 2. arenada 'savas' yerine çalar (audio.js setMusicArena).
export const MUSIC_FILES = {
  menu: 'music/menu.mp3',
  savas: 'music/savas.ogg',
  savas2: 'music/savas2.ogg',
  boss: 'music/boss.mp3',
  zafer: 'music/zafer.mp3',
  yenilgi: 'music/yenilgi.mp3',
};
