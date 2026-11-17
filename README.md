# Tarama → Metin

Taranmış PDF'leri **aranabilir (kopyalanabilir) PDF'e** ve **Word'e (.docx)** çeviren, içindekilere **köprü** ekleyen tarayıcı uygulaması.

Tüm işlem tarayıcıda yapılır, belgeler hiçbir sunucuya gönderilmez. İnternetten yalnızca kütüphaneler ve Türkçe OCR dil verisi indirilir. Bunlar ilk kullanımdan sonra önbelleğe alınır.

## Özellikler

**OCR Dönüştür**
- Taranmış PDF ya da JPG/PNG görüntülerden Türkçe (veya Türkçe + İngilizce) metin tanıma
- Aranabilir PDF: sayfa görüntüsü aynen kalır, arkasına seçilebilir/aranabilir metin katmanı eklenir
- Word: paragraflar birleştirilir, satır sonu tirelemeleri düzeltilir, sayfa numaraları ayıklanır
- Kalite seçimi (150 / 220 / 300 dpi) ve sayfa aralığı (örn. `1-10, 15`)

**İçindekiler Köprüsü**
- "İÇİNDEKİLER" sayfasını ve `Başlık ........ 12` biçimindeki satırları otomatik bulur
- Basılı sayfa numarası ile PDF sayfası arasındaki kaymayı başlıkları sayfalarda arayarak kendisi hesaplar
- İçindekilerdeki satıra tıklayınca → ilgili sayfadaki başlığa gider
- Hedef sayfada **başlığa** ya da sağ üstteki **"↑ İçindekiler"** düğmesine tıklayınca → içindekilerde o satırın olduğu yere döner
- PDF yer imleri (kenar paneli), 1 / 1.1 / 1.1.1 seviyeleriyle
- Word çıktısında da aynı köprüler (Ctrl+tıklama); içindekiler noktalı sekmelerle düzenlenir
- Uygulamadan önce kontrol ekranı: başlıkları düzeltme, hedef sayfayı değiştirme, satır çıkarma, kaymayı toplu uygulama
- İkinci sekme metni zaten olan PDF'lere de (Word'den kaydedilmiş PDF, bu uygulamanın çıktısı) köprü ekler. Orijinal PDF bozulmaz.

## GitHub'a yükleme (GitHub Pages)

1. GitHub'da yeni bir depo açın (örn. `tarama-metin`).
2. **Add file → Upload files** ile bu klasördeki **tüm dosya ve klasörleri** (`index.html`, `app.js`, `core.js`, `toc.js`, `sw.js`, `manifest.webmanifest`, `fonts/`, `icons/`) sürükleyip bırakın → **Commit changes**.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: `main`, klasör: `/ (root)` → **Save**.
4. 1–2 dakika sonra uygulama `https://KULLANICIADI.github.io/tarama-metin/` adresinde açılır.
5. Telefonda: tarayıcı menüsünden **Ana ekrana ekle**.

### Diğer uygulamalarla çakışma

Aynı `KULLANICIADI.github.io` alanında başka PWA'larınız varsa bu uygulama onlarla çakışmaz:
- `manifest.webmanifest` içindeki `id` (`./?pwa=tarama-metin-ocr-kopru`) ve `scope` (`./`, yani yalnızca kendi klasörü) bu uygulamaya özeldir. Ana ekranda ayrı bir uygulama olarak görünür.
- Service worker yalnızca kendi klasöründe çalışır. Önbellek adları `tarama-metin-ocr-kopru-` önekiyle başlar ve güncellemede yalnızca bu önekle başlayan eski önbellekler silinir.

Güncelleme yaptığınızda `sw.js` içindeki `VERSION` değerini artırırsanız (`v1` → `v2`) kullanıcılar yeni sürümü hemen alır.

## İpuçları

- Eğik veya soluk taramalarda **Yüksek (300 dpi)** daha iyi sonuç verir ama daha yavaştır.
- İçindekilerde `?` işaretli satırlar: başlık hedef sayfada bulunamamıştır. Köprü yine o sayfaya gider, yalnızca sayfanın en üstüne konumlanır. Gerekirse PDF sayfa numarasını elle düzeltin.
- İçindekiler bulunamazsa, içindekilerin bulunduğu PDF sayfa numarasını yazıp **Yeniden tara**'ya basın.
- "↑ İçindekiler" düğmesi baskıda da görünür. İstemiyorsanız seçeneği kapatın; başlığa tıklayarak dönüş yine çalışır.
- OCR hatasız değildir. Önemli belgelerde rakamları ve isimleri kontrol edin.

## Kullanılan açık kaynak bileşenler

[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0), [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), [JSZip](https://github.com/Stuk/jszip) (MIT), DejaVu Sans yazı tipi (serbest lisans, bkz. `fonts/LICENSE-DejaVu.txt`).
