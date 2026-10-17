# Claudio Ofis nasıl kullanılır

Bu kılavuz, ofisi ilk kez kuran birinin bilmesi gerekenleri sırayla anlatır. Mimari ve geliştirme için [README](../README.md)'ye bak.

## 1. Kurulum

1. [Node.js 20 veya üstünü](https://nodejs.org) kur. Ofisin köprüsü Node ile çalışır.
2. [Sürümler](https://github.com/SefaSelim/claudio/releases) sayfasından `Claudio Ofis_<sürüm>_x64-setup.exe` dosyasını indirip çalıştır. Windows SmartScreen "bilinmeyen yayıncı" derse **Ek bilgi → Yine de çalıştır**.
3. Ofis ekranın sağ altında açılır. Görev çubuğunda görünmez; her zaman diğer pencerelerin üstündedir.

Kaynaktan çalıştırmak istersen: `npm install` ve `npm run tauri dev`.

## 2. Claude Code'a bağlama

1. Yan çubuktaki **zincir** düğmesine (Oturum) bas.
2. İlk seferde **Bağlantıyı kur**'a bas. Ofis `~/.claude/settings.json` dosyanı `settings.json.claudio-backup` adıyla yedekler ve yalnızca kendi hook'larını ekler. Açık oturumların yeniden başlatılması gerekmez.
3. Bir terminalde `claude` başlat (zaten açıksa gerek yok). Oturum listede görünür; ona tıkla.

Bağlanınca ana ajan "Claude" kendi masasına oturur ve sohbet paneli açılır. API anahtarı gerekmez: ofis çalışan oturumun kendisini izler.

Ofis kapalıyken hook'lar hiçbir şeyi engellemez; Claude Code her zamanki gibi çalışır. Hook'ları kaldırmak için aynı panelde **Kaldır**.

## 3. Yan çubuk

Yukarıdan aşağıya:

| Düğme | Ne yapar |
|---|---|
| Altı nokta | Sürükleyerek ofisi taşı. Çift tıklayınca sağ alta döner. |
| Zincir | Oturumlar: bağlan, bağlantıyı kes. Başka bir oturum seni beklerse burası yanıp söner. |
| Konuşma balonu | Claude'a yaz. Kırmızı sayı, bekleyen izin ve soru sayısı. |
| İki kişi | Toplantı. |
| Kareler | Ekip ve görevler. |
| Ay / güneş | Akşam ve gündüz ışığı. Tıklayınca sabitlenir, sağ tıklayınca saate göre otomatiğe döner. |
| Dişli | Ayarlar. |
| Çarpı | Ofisi kapat. |

## 4. Claude'la konuşmak

- **Sohbet** sekmesine yaz ve Enter'a bas. Mesajın altında nasıl iletileceği yazar:
  - Claude çalışıyorsa bir sonraki adımında görür.
  - Tur bitmek üzereyse turun sonunda görür.
  - Claude boştaysa ofis onu uyandırır.
- **Resim ve dosya:** ataç düğmesi, Ctrl+V ile yapıştırma ya da sürükle-bırak. Claude dosyaları kendi açar.
- **Hızlı komutlar:** yazı kutusunun üstündeki küçük düğmeler ("Ne yapıyorsun?", "Durum özeti", "Bitince dur").
- **Adımlar** sekmesi ajanın kullandığı araçları, başarısız olanları kırmızıyla, toplam süreyi ve biten alt ajanın modelini ve token sayısını gösterir.

## 5. Alt ajanlar

Claude bir alt ajan başlatınca kapıdan bir karakter girer, boş bir masaya oturur ve işi bitince çıkar. Karaktere tıklayınca o ajanın kartı açılır:

- **Sohbet**: Claude'un ona verdiği görev ve ajanın yazdıkları.
- Bu karttan yazdığın mesaj **yalnızca o ajana** gider ve bir sonraki adımında ona ulaşır.

## 6. İzinler ve sorular

Claude bir komut için izin isterse ya da `AskUserQuestion` ile soru sorarsa, kart ofisin üstünde açılır:

- **İzin ver** / **Reddet**.
- **Bu oturumda hep izin ver**: Claude Code'un önerdiği kuralı uygular.
- **İzin ver + düzenlemeleri otomatik onayla**: dosya düzenlemelerinde görünür; oturumu o moda geçirir.
- **Terminalde cevapla**: kararı terminale bırakır.

Ayarlardan:

- **İzinleri ve soruları ofisten cevapla** kapalıysa her şey terminalde sorulur.
- **Ajanlar bana soru sorsun** kapalıysa Claude soru sormak yerine makul olanı seçer ve nedenini yazar.
- **Her yeni görevde sor** açıksa Claude ofisten verdiğin her işten önce kısa bir soru sorar.

## 7. Ekip ve görevler

**Kareler** düğmesi, bağlı projede neyin kullanılabildiğini gösterir:

- **Ajanlar**: yerleşik ajanlar (`general-purpose`, `Explore`, `Plan`), kendi `~/.claude/agents` klasörün, projenin `.claude/agents` klasörü ve açık eklentilerin ajanları. Çalışanların yanında "çalışıyor" yazar.
- **Beceriler**: beceriler (`SKILL.md`) ve eğik çizgi komutları.
- **Görevler**: Claude'un `TaskCreate` ile tuttuğu iş listesi ve ilerleme çubuğu.

Bir satıra tıklayınca küçük bir görev kutusu açılır. Yazdığın görev Claude'a "bu ajanı şu görevle başlat" isteği olarak gider; Claude ajanı başlatır ve sonucu sana özetler.

Projeye yeni bir ajan eklemek için `.claude/agents/<ad>.md` dosyası oluştur:

```markdown
---
name: reviewer
description: Değişiklikleri hata ve güvenlik açısından inceler.
model: sonnet
---

Sen titiz bir kod inceleyicisisin...
```

Paneli yeniden açınca listede görünür.

Toplantı odasındaki **beyaz tahta** aynı görev listesini post-it'lerle gösterir: sarı yapılacak, mavi sürüyor, yeşil bitti, kırmızı nokta başka bir görevi bekleyen. Tahtaya tıklayınca görev listesi açılır.

## 8. Toplantı

1. **İki kişi** düğmesine bas, konuyu yaz (ya da önerilerden birini seç), katılımcıları işaretle, **Toplantıyı başlat**.
2. Katılımcılar toplantı odasına yürür, Claude masanın başına geçer.
3. Claude her katılımcının durumunu anlatır, açık alt ajanlara sorar ve karar gereken yerde sana soru sorar.
4. Alttaki kutudan **araya girebilirsin**.
5. **Toplantıyı bitir** deyince Claude bir özet yazar. Özet, **Özeti kapat** diyene kadar ekranda kalır; **Özeti kopyala** ile panoya alabilirsin.

## 9. Sinyaller, alarm ve sayaç

Ofis, ajanların çalıştırdığı komutların ne anlama geldiğini okur:

| Simge | Anlamı |
|---|---|
| 🚀 | Deploy sürüyor (vercel, fly, kubectl, terraform, `gh release create`, tag push…) |
| 🔨 | Derleme sürüyor (`npm run build`, `vite build`, `cargo build`, `tsc`…) |
| 🧪 | Testler sürüyor (`npm test`, `vitest`, `pytest`, `cargo test`…) |
| ⬆️ | `git push` |
| ✅ / ❌ | Komut bitti: başarılı ya da başarısız. Başarısızsa sohbete kısa bir satır düşer. |

**Alarm:** bir deploy başarısız olursa ya da beş dakika içinde üç araç çağrısı hata verirse ofis kırmızıya döner, arka duvardaki ışık yanar ve sağ üstte süreli bir **Alarm** düğmesi çıkar. Testler ya da derleme yeniden yeşile dönünce, başarılı bir deploy olunca, on dakika yeni hata gelmeyince ya da düğmeye tıklayınca biter; sohbete kısa bir özet yazılır.

**Sayaç:** oturum rozetinin altındaki çubuk, Claude'un bağlam penceresinin ne kadar dolu olduğunu ve son beş dakikadaki dakika başına token sayısını gösterir. %70'ten sonra sarı, %90'dan sonra kırmızıdır. Üstüne gelince ayrıntı görünür.

Bir ajan başka bir ajana `SendMessage` ile yazınca, mesajı götürmek için onun masasına yürür ve geri döner.

## 10. Ofisin dili

| Gördüğün | Anlamı |
|---|---|
| Kollar havada, zıplıyor | Seni bekliyor (izin ya da soru). |
| Klavyeye vuruyor | Dosya yazıyor ya da komut çalıştırıyor. |
| Başı önde, "z z" | Tur bitti, uyukluyor. Yazınca uyanır. |
| Masayı süpürüyor | Bağlam doldu, Claude Code konuşmayı özetliyor. |
| Kırmızı "!" | Tur bir API hatasıyla bitti (örneğin hız sınırı). |
| Konuşma balonu | Ajanın son söylediği. |

## 11. Ayarlar, tepsi ve klavye

- **Windows bildirimleri** ve **Ses**: izin, soru, uzun bir turun bitişi ve toplantı sonu.
- **Windows ile başlat**: oturum açınca ofis kendiliğinden açılır.
- Oturumun izin modu ayarlarda görünür; terminalde Shift+Tab ile değiştirilir.
- **Tanılama**: Node.js, Claude Code bağlantısı, son gelen hook, açık oturum sayısı ve köprü sürümü. Bağlantı eksik ya da eskiyse **Bağlantıyı onar** düğmesi çıkar.

**Tepsi simgesi** (saatin yanında): tıklayınca ofisi gizler ya da gösterir. Sağ tık menüsünde "Her zaman üstte", "Sağ alta taşı" ve "Ofisi kapat" var. Üstüne gelince kaç isteğin seni beklediğini söyler.

**Klavye** (ofis odaktayken, bir yazı kutusunda değilken):

| Tuş | Ne yapar |
|---|---|
| Enter veya Y | Öndeki izin kartında izin ver |
| N | Reddet |
| T | Terminalde cevapla |
| 1-9 | Soru kartında seçenek seç; Enter gönderir |
| Esc | Açık paneli kapat |

## 12. Sorun giderme

| Sorun | Çözüm |
|---|---|
| Neyin eksik olduğunu bilmiyorum | Ayarlar → **Tanılama** her adımı tek tek gösterir. |
| Ofisi gizledim, geri gelmiyor | Saatin yanındaki tepsi simgesine tıkla. |
| Oturum listesi boş | Bir terminalde `claude` çalıştır. Liste `~/.claude/sessions` klasöründen gelir. |
| Bağlandım ama hiçbir şey hareket etmiyor | Oturum panelinde bağlantının kurulu olduğuna bak. Claude ilk aracını kullanınca hareket başlar. |
| Mesajım "iletilmeyi bekliyor"da kaldı | Claude uzun bir araç çalıştırıyor olabilir; o bitince iletilir. Boştaysa birkaç saniye içinde uyanır. |
| "Köprü kapandı" | Ofisi kapatıp yeniden aç. Node.js'in kurulu olduğundan emin ol. |
| Hook'ları tamamen geri almak | Oturum panelinde **Kaldır**, ya da `~/.claude/settings.json.claudio-backup` yedeğini geri koy. |
