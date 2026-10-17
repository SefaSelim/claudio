# Claudio Ofis

Claude Code ajanlarını masaüstünün sağ altında, her şeyin üstünde duran küçük bir 3D ofiste gösteren masaüstü uygulaması. Tauri 2 + three.js.

Tasarım ve yol haritası: https://claude.ai/artifact/G8Fc75oiVbtYyUCbwLJZLQ

## Durum

- Faz 0: şeffaf, çerçevesiz, hep üstte, görev çubuğunda görünmeyen pencere. Sadece ofis, yan çubuk ve açık paneller tıklanır; geri kalan her yere tıklama alttaki pencereye geçer. Tutamaçla taşınır, konum hatırlanır.
- Faz 1: ofis, makinedeki herhangi bir açık Claude Code oturumuna bağlanır (API anahtarı gerekmez). Alt ajanlar sahnede belirip kaybolur, araç kullanımı animasyona ve baloncuklara dönüşür. Sohbet, izin kartları ve AskUserQuestion soru kartları ofisin üstünde açılır; ofisten yazılan mesajlar oturuma iletilir.

## Claude Code'a bağlanma

İlk açılışta yan çubuktaki **Oturum** panelinden **Bağlantıyı kur**'a bas. Ofis `~/.claude/settings.json` dosyasını `settings.json.claudio-backup` olarak yedekler ve kendi hook'larını ekler. Bu hook'lar bütün oturumlarda çalışır, açık oturumlar da yeniden başlatmadan alır; ofis kapalıyken hiçbir şeyi engellemez. **Kaldır** yalnızca ofisin hook'larını siler.

Sonra listeden bir oturum seç:

- **İzleme:** oturum listesi `~/.claude/sessions`'tan, sohbet oturumun kayıt dosyasından, ajan ve araç durumları hook'lardan gelir.
- **İzin ve sorular:** `PermissionRequest` ve `AskUserQuestion` ofisten cevaplanabilir. "Terminalde cevapla" kararı terminale bırakır; ayarlardan tamamen kapatılabilir.
- **Mesajlar:** Claude Code'a dışarıdan kullanıcı mesajı yazmanın resmi bir yolu yok. Ofisten yazılanlar şöyle iletilir:
  - tur sürerken bir sonraki araç çağrısından sonra eklenen bağlam olarak,
  - tur biterken `Stop` hook'uyla,
  - oturum boştayken `asyncRewake` bekçisiyle (`sidecar/claudio-waiter.mjs`).

  Claude bunları "Kullanıcı Claudio Ofis'ten yazdı" notu olarak görür. Alt ajana yazılan mesaj o ajanın bir sonraki adımında teslim edilir.

## Demo modu

Gerçek oturum olmadan akışı denemek için köprü senaryolu bir oturum oynatabilir:

```bash
CLAUDIO_FAKE=1 npm run tauri dev
```

## Gereksinimler (Windows)

- Node.js 20+
- Rust (stable, `x86_64-pc-windows-msvc`)
- MSVC C++ derleme araçları + Windows SDK (Visual Studio Installer'da "Desktop development with C++")
- WebView2 (Windows 11'de hazır gelir)

## Çalıştırma

```bash
npm install
npm run tauri dev
```

Uygulamayı kapatmak için yan çubuğun altındaki çarpı düğmesini kullan.

## Nasıl çalışır

- `src/hitRegions.js`: `data-hit` öznitelikli öğelerin kutularını Rust'a bildirir.
- `src-tauri/src/lib.rs`: imleci ~60 Hz ile yoklar; imleç bu kutuların dışındayken `set_ignore_cursor_events(true)` ile tıklamaları alttaki pencereye geçirir.
