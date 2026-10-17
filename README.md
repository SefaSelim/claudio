# Claudio Ofis

Claude Code ajanlarını masaüstünün sağ altında, her şeyin üstünde duran küçük bir 3D ofiste gösteren masaüstü uygulaması. Tauri 2 + three.js.

Tasarım ve yol haritası: https://claude.ai/artifact/G8Fc75oiVbtYyUCbwLJZLQ

## Durum

- Faz 0: şeffaf, çerçevesiz, hep üstte, görev çubuğunda görünmeyen pencere. Sadece ofis, yan çubuk ve açık paneller tıklanır; geri kalan her yere tıklama alttaki pencereye geçer. Tutamaçla taşınır, konum hatırlanır.
- Faz 1: ofis, Claude Agent SDK ile kendi Claude oturumunu açar. Alt ajanlar sahnede belirip kaybolur, araç kullanımı animasyona ve baloncuklara dönüşür. Sohbet, izin kartları ve AskUserQuestion soru kartları ofisin üstünde açılır; izin modu ayarlardan değişir.

## API anahtarı

Anthropic, Agent SDK ile yapılan uygulamaların claude.ai girişini kullanmasına izin vermiyor; ofis bir API anahtarıyla çalışır. Claude Console'dan anahtar alıp:

```powershell
setx ANTHROPIC_API_KEY "anahtar"
```

Sonra terminali kapatıp yeniden açın. Bedrock, Vertex ve Foundry ortam değişkenleri de desteklenir.

## Demo modu

Anahtar olmadan akışı denemek için yan süreç senaryolu bir oturum oynatabilir:

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
