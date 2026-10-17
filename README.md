# Claudio Ofis

Claude Code ajanlarını masaüstünün sağ altında, her şeyin üstünde duran küçük bir 3D ofiste gösteren masaüstü uygulaması. Tauri 2 + three.js.

Tasarım ve yol haritası: https://claude.ai/artifact/G8Fc75oiVbtYyUCbwLJZLQ · Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md) · **Nasıl kullanılır:** [docs/KULLANIM.md](docs/KULLANIM.md) · Yol haritası: [docs/plan-v1.md](docs/plan-v1.md)

## Neler yapar

- **Ofis:** ana ajan önde kendi masasında oturur; alt ajanlar kapıdan girip boş bir masaya yürür, işleri bitince çıkar. Araç kullanımı animasyona ve baloncuklara dönüşür. Gündüz ve akşam ışığı saate göre değişir.
- **Ajan kartı:** bir karaktere tıklayınca **Sohbet** ve **Adımlar** sekmeleri açılır. Ana ajana ya da tek bir alt ajana özel mesaj, resim ve dosya gönderilebilir (Ctrl+V ile yapıştırma, sürükle-bırak). Hızlı komutlar yazı kutusunun üstünde durur.
- **İzin ve sorular:** izin istekleri ve `AskUserQuestion` ofisin üstünde kart olarak açılır. "Bu oturumda hep izin ver", "düzenlemeleri otomatik onayla" ve "Terminalde cevapla" seçenekleri var.
- **Toplantı:** yan çubuktaki **Toplantı** düğmesi konu ve katılımcı sorar. Katılımcılar toplantı odasına yürür, Claude masanın başına geçer. Toplantı sırasında araya girilebilir; Claude karar gereken yerlerde soru sorar ve sonunda bir özet yazar. Özet kapatılana kadar ekranda kalır.
- **Diğer oturumlar:** ofisin bağlı olmadığı bir oturum izin ya da soru beklerse oturum listesinde işaretlenir, yan çubuktaki oturum düğmesi yanıp söner ve bildirim gelir.
- **Ekip ve görevler:** bağlı projede kullanılabilen ajanlar, beceriler ve komutlar; birine tek satırla görev verilebilir. Oturumun görev listesi panelde ve toplantı odasındaki tahtada post-it olarak görünür.
- **Sinyaller ve alarm:** deploy, derleme, test ve push komutları ajanın üstünde simge olarak görünür; deploy başarısız olursa ya da hatalar üst üste gelirse ofis kırmızıya döner. Rozetin altındaki çubuk bağlam doluluğunu ve dakika başına tokenı gösterir.
- **Tepsi ve klavye:** tepsi simgesiyle göster/gizle; izin kartlarında Enter, N ve T.
- **Ayarlar:** ofisten cevaplama, ajanların soru sorması, her yeni görevde sorma, Windows bildirimleri, ses ve Windows ile başlatma. Ayarlar'da tanılama bölümü kurulumun her adımını denetler.

## Claude Code'a bağlanma

API anahtarı gerekmez. İlk açılışta yan çubuktaki **Oturum** panelinden **Bağlantıyı kur**'a bas. Ofis `~/.claude/settings.json` dosyasını `settings.json.claudio-backup` olarak yedekler ve kendi hook'larını ekler. Bu hook'lar bütün oturumlarda çalışır, açık oturumlar da yeniden başlatmadan alır; ofis kapalıyken hiçbir şeyi engellemez. **Kaldır** yalnızca ofisin hook'larını siler.

Sonra listeden bir oturum seç:

- **İzleme:** oturum listesi `~/.claude/sessions`'tan, sohbet oturumun kayıt dosyasından, ajan ve araç durumları hook'lardan gelir. Alt ajanların sohbeti kendi kayıt dosyalarından okunur.
- **İzin ve sorular:** `PermissionRequest` ve `AskUserQuestion` ofisten cevaplanana kadar bekletilir. Ayarlardan tamamen kapatılabilir.
- **Mesajlar:** Claude Code'a dışarıdan kullanıcı mesajı yazmanın resmi bir yolu yok. Ofisten yazılanlar şöyle iletilir:
  - tur sürerken bir sonraki araç çağrısından sonra eklenen bağlam olarak,
  - tur biterken `Stop` hook'uyla,
  - oturum boştayken `asyncRewake` bekçisiyle (`sidecar/claudio-waiter.mjs`).

  Claude bunları "Kullanıcı Claudio Ofis'ten yazdı" notu olarak görür. Alt ajana yazılan mesaj o ajanın bir sonraki adımında teslim edilir. Ekler uygulama veri klasörüne kaydedilir ve yolları mesaja eklenir; Claude onları Read ile açar.
- **Toplantı:** toplantı, ana ajana gönderilen yapılandırılmış bir istemdir. Claude açık alt ajanlara `SendMessage` ile sorar ve `## Toplantı özeti` başlığıyla bitirir; ofis bu başlığı görünce toplantıyı kapatır.

## Gereksinimler (Windows)

- Node.js 20+ (köprü Node ile çalışır; kurulu sürümde de gerekir)
- Rust (stable, `x86_64-pc-windows-msvc`)
- MSVC C++ derleme araçları + Windows SDK
- WebView2 (Windows 11'de hazır gelir)

## Çalıştırma

```bash
npm install
npm run tauri dev
```

Uygulamayı kapatmak için yan çubuğun altındaki çarpı düğmesini kullan.

Gerçek oturum olmadan akışı denemek için:

```bash
CLAUDIO_FAKE=1 npm run tauri dev
```

Arayüzü Tauri olmadan tarayıcıda denemek için `npx vite build && npx vite preview` çalıştırıp `/?scene-demo` adresini aç. Sayfa sahte bir oturum, alt ajanlar, kartlar ve toplantı akışı oynatır.

## Paketleme

```bash
npm run tauri build
```

`sidecar/` klasörü uygulamanın kaynaklarına eklenir; kurulu sürüm köprüyü oradan başlatır. Geliştirme sürümü proje klasöründeki `sidecar/`'ı kullanır. Hook'lar başka bir klasördeki eski bir kurulumu gösteriyorsa köprü bağlanırken onları kendiliğinden yeniler; kullanıcının kendi hook'larına dokunmaz.

## Nasıl çalışır

| Parça | Görev |
|---|---|
| `src-tauri/` | Şeffaf pencere. İmleci ~60 Hz yoklar; imleç `data-hit` kutularının dışındayken tıklamaları alttaki pencereye geçirir. Konum hafızası, köprü süreci, Windows ile başlatma. |
| `sidecar/index.mjs` | `127.0.0.1:47821` üzerinde hook alıcısı. Oturum listesi, kayıt dosyası takibi, mesaj kuyruğu, bekletilen izin ve sorular. |
| `sidecar/hooks-config.mjs` | `settings.json`'a hook ekleme ve çıkarma. |
| `src/scene.js`, `src/office.js`, `src/characters.js` | three.js ofisi, keçe Clawd karakterleri, yürüme yolları. Bir şey hareket etmiyorsa kare hızı düşer. |
| `src/session.js` | Köprü olaylarından oturum durumu; mesaj, toplantı ve ayar komutları. |
| `src/ui.js` | Yan çubuk, paneller, kartlar, ajan etiketleri. |
| `sidecar/roster.mjs`, `sidecar/signals.mjs` | Projedeki ajanlar, beceriler ve görev listesi; kabuk komutlarının sınıflandırılması. |
| `test/` | `npm test`: okuyucular, sınıflandırıcı ve köprünün uçtan uca testleri. |
