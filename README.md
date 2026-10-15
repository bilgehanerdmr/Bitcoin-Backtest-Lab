# Bitcoin Backtest Lab

[English research overview](README.en.md)

Türkçe arayüzlü, yerel çalışan BTC/USDT araştırma ve backtest platformu.

## GitHub deposu ve başlangıç verileri

Depo: [bilgehanerdmr/Bitcoin-Backtest-Lab](https://github.com/bilgehanerdmr/Bitcoin-Backtest-Lab).

```sh
git clone https://github.com/bilgehanerdmr/Bitcoin-Backtest-Lab.git
cd Bitcoin-Backtest-Lab
npm ci
npm run dev
```

Mevcut çalışma alanının taşınabilir kopyası **`backups/initial-workspace.json`** dosyasındadır. Platformda **Veri Merkezi → Yedek dosyası seç** üzerinden bu dosyayı açıp **İçe aktarmayı başlat** düğmesine basın. Dosya; alındığı andaki mumları ve raporları içerir. Otomatik testlerin oluşturduğu şablon ve raporlar dosyadan çıkarılmıştır. Otomatik olarak içe aktarılmaz ve sonraki yerel değişikliklerle kendiliğinden güncellenmez. Güncel verileri taşımak için uygulamadan yeni bir yedek dışa aktarın.

Çalışan SQLite dosyaları, bağımlılık klasörü ve oluşturulmuş derleme/test çıktıları Git tarafından dışarıda tutulur. Veriler depoda taşınabilir JSON yedeği olarak bulunur.

## Başlatma

Node.js **22.13 veya üzeri** gerekir (SQLite için Node'un yerleşik `node:sqlite` modülü kullanılır).

```sh
npm install
npm run dev
```

Arayüz: **http://127.0.0.1:5173** · API: http://127.0.0.1:3001

Üretim derlemesini yerel olarak çalıştırmak için:

```sh
npm run build
npm start
```

Bu modda arayüz ve API birlikte **http://127.0.0.1:3001** üzerinden sunulur. `PORT` ile sunucu portu değiştirilebilir; `npm run dev` sırasında geliştirme proxy'si de aynı `PORT` değerini kullanır.

## Özellikler

- Binance Spot BTC/USDT gerçek zamanlı WebSocket fiyatları ve mum grafiği; yeniden bağlanma ve 30 saniyelik REST yedeği.
- 1m, 5m, 15m, 1h, 4h, 1d mumlar; kaydırma, yakınlaştırma, SMA göstergeleri ve hacim.
- Tarih aralığına göre sayfalı geçmiş veri indirme, veri eksikliği kontrolü, Binance kesintilerinin doğrulanması ve SQLite önbelleği.
- SMA kesişimi, Wilder RSI ortalamaya dönüş ve Donchian kanal kırılımı stratejileri.
- Özel mum stratejisi editörü: fiyat, gövde, fitil, yüzde ve hacim koşulları; ayrı giriş/çıkış grupları ve kaydedilebilir formasyonlar.
- Python Strateji Atölyesi: `.py` yükleme, kod düzenleme, sözdizimi kontrolü, yerel şablon kaydı ve Python sinyalleriyle backtest.
- Sermaye, pozisyon oranı, iki yönlü komisyon/kayma, stop-loss ve take-profit ayarları.
- Net getiri, al & tut, maksimum düşüş, kazanma oranı, kâr faktörü, yıllık Sharpe, toplam ücretler.
- Sermaye/düşüş grafikleri, sayfalı işlem dökümü, CSV dışa aktarımı.
- Otomatik kaydedilen raporlar, üç rapora kadar karşılaştırma, tekli/toplu silme ve eski raporları sayfalı yükleme.
- SQLite içine kaydedilen strateji şablonları ve sermaye/risk varsayılanları.
- Açıkça etiketlenmiş, deterministik sentetik demo modu; canlı veri başarısız olduğunda kendiliğinden devreye girmez.
- Masaüstü ve mobil Türkçe arayüz; UTC zamanları.

1 dakikalık backtest için terminalde **Zaman dilimi → 1m** seçin. Grafiğin zaman dilimi ayrıca üstteki **1m** düğmesinden seçilir. Geçmiş 1 dakikalık mumlar Binance'ten sayfalar halinde indirilir ve önbelleğe alınır. Test başına 50.000 mum sınırı yaklaşık 34,7 güne karşılık gelir; tam gün seçerken en fazla 34 gün kullanın. Oluşmakta olan mum backteste dahil edilmez.

## Özel mum stratejisi oluşturma

**Stratejiler → Özel strateji oluştur** veya terminalde **Strateji → Özel Mum Stratejisi → Mum kurallarını düzenle** yolunu kullanın.

Her koşul bir mumun değerini sabit bir sayıyla veya başka bir mumun değeriyle karşılaştırır. Örnekler:

- Yeşil mum: son kapanan mumun kapanışı > aynı mumun açılışı.
- Uzun alt fitil: son kapanan mumun alt fitili ≥ aynı mumun gövdesi × 2.
- Fiyat kırılımı: son kapanan mumun kapanışı > 1 mum önceki en yüksek fiyat.
- Küçük gövde: gövde / toplam mum ≤ %10.
- Hacim artışı: son kapanan mumun hacmi > 1 mum önceki hacim × 1,5.

“Son kapanan mum” sinyal mumudur; geriye bakış 0–20 mum arasındadır. Gövde `abs(kapanış − açılış)`, üst fitil `en yüksek − max(açılış, kapanış)`, alt fitil `min(açılış, kapanış) − en düşük` olarak hesaplanır. Toplam mum uzunluğu `en yüksek − en düşük` değeridir; sıfır uzunlukta yüzde oranları tanımsızdır ve ilgili koşul eşleşmez. Fiyat/uzunluk USDT, hacim BTC, oranlar yüzde birimindedir. Mum değerleri karşılaştırılırken birimler aynı olmalıdır; sabit sayılar soldaki alanın birimiyle yorumlanır.

Giriş ve çıkış için ayrı **VE** (tümü) veya **VEYA** (en az biri) grupları oluşturulur. Giriş grubu 1–20, çıkış grubu 0–20 koşul içerir. İç içe mantık grupları, özel Python/JavaScript çalıştırma ve gösterge ifadeleri bu editöre dahil değildir. Çıkış grubunu boş bırakmak, yalnızca mevcut stop-loss/take-profit ve test sonu çıkışını kullanır. Hazır örnekler: yükseliş yutan mum, uzun alt fitil, üç yükselen mum; örnek düğmesi mevcut giriş/çıkış kurallarını değiştirir.

Formasyon sadece kapanmış mumlarla değerlendirilir, sonraki mum açılışında işlem yapılır. Tüm giriş/çıkış koşullarının en büyük geriye bakışı kadar veri beklenir. Giriş ve çıkış aynı anda eşleşirse çıkış önceliklidir. Tek pozisyon tutulur; özel stratejilerde çıkış yapılan mumda yeniden giriş yapılmaz. Şartlar sonraki mumda yeniden sağlanırsa yeni giriş mümkündür.

Editör önizlemesi mevcut grafiğin kapanmış mumlarındaki eşleşmeleri sayar; pozisyon, komisyon veya stop kurallarını simüle etmez. Kesin işlem sayısı için backtesti çalıştırın. **Kuralları uygula** mevcut test yapılandırmasını günceller. **Stratejiyi şablon olarak kaydet** kuralları yerel SQLite deposunda tekrar kullanmak üzere saklar; tamamlanan raporlarda kullanılan kurallar ayrıca SQLite içinde kalır ve “Test edilen mum kuralları” altında görüntülenir.

## Veri kaynağı

REST: `https://data-api.binance.vision/api/v3`

WebSocket: `wss://data-stream.binance.vision/stream`

API anahtarı gerekmez. İnternet bağlantısı ve Binance veri alan adlarına erişim gerekir. Bölgesel erişim kısıtları veya ağ hatalarında arayüz bağlantı durumunu gösterir. 429/418 yanıtlarında sunucu `Retry-After` süresine uyar. Ticker verisi sunucuda 5 saniye önbelleğe alınır; tarihsel mum indirmeleri sıraya alınır.

Resmi kaynaklar: [Binance public market data](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), [WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md).

Grafikler [TradingView Lightweight Charts™](https://www.tradingview.com/) ile oluşturulur. Kaynak lisansı: [Apache 2.0 ve NOTICE](https://github.com/tradingview/lightweight-charts).

## Backtest metodolojisi

1. Sadece kapanmış ve kesintisiz OHLCV mumları kullanılır. Tek istisna Binance'in kendi kesintileridir (ör. 8–9 Şubat 2018 bakımı, 24 Mart 2023 12:39–14:00 UTC): Binance daha sonraki bir mumu döndürdüğünde atlanan mumların borsada hiç oluşmadığı kesinleşir; bu mumlar uydurulmaz, atlanır ve raporda sayıları gösterilir. Sonrası henüz yayınlanmamış eksik mumlar hata verir. Canlı veri 17 Ağustos 2017'de (BTCUSDT listelemesi) başlar; daha önceki başlangıç tarihleri reddedilir. En fazla 50.000 mum işlenir. Gelecekteki bitiş tarihleri son kapanmış muma kırpılır. Kesintiden sonraki ilk mum, göstergeler ve mum kuralları için “bir önceki mum” sayılır.
2. Göstergelerin ısınması seçilen aralık içindedir. Önceki kapanışta hesaplanan sinyal bir sonraki mum açılışında işlenir. Spot, long-only, kaldıraçsız ve tek pozisyon modelidir.
3. Alım fiyatı kayma kadar artırılır, satış fiyatı azaltılır. Her iki yönde komisyon alınır. Pozisyon bütçesi giriş komisyonunu içerir; kullanılmayan sermaye nakitte kalır.
4. Stop-loss / take-profit girişteki kaymalı fiyata göre belirlenir. 0 değeri kuralı kapatır. Bir mumda iki seviye de aşılırsa stop-loss önce işlenir. Açılıştaki stop boşluğu o mumun açılışından doldurulur. Ardından strateji çıkış sinyali ve mum içi seviyeler değerlendirilir.
5. Son mum kapanışında açık pozisyon kapatılır. Giriş/çıkış zamanları, işlemin gerçekleştiği mumun açılış zamanıdır; mum içi kesin zaman OHLCV verisinden çıkarılamaz.
6. Sermaye her kapanışta piyasa fiyatına göre değerlenir. Maksimum düşüş bu seri üzerinden hesaplanır; mum içi düşüşü ölçmez. Açık pozisyon değerinde varsayımsal çıkış komisyonu düşülmez, gerçekleşen çıkışlarda düşülür.
7. Sharpe, mumluk getiriler ve örneklem standart sapmasıyla, sıfır risksiz getiri ve 365 gün üzerinden yıllıklandırılır. Sıfır varyansta hesaplanmaz. Zarar eden işlem yoksa kâr faktörü `null` / `—` gösterilir.
8. Al & tut aynı aralığın ilk mum açılışından son kapanışına, %100 sermaye ve aynı komisyon/kayma oranlarıyla hesaplanır. Gösterilen eğri her mumda varsayımsal net tasfiye değeridir.

Likidite, kısmi dolumlar, miktar/fiyat adımları, piyasa etkisi, vadeli işlemler ve fonlama ücretleri modellenmez. Gerçek emir gönderimi yoktur. Tarihsel sonuçlar gelecek performansı garanti etmez.

## Depolama ve mimari

- `src/`: React + TypeScript arayüzü ve grafikler.
- `shared/engine.ts`: bağımsız hesaplama motoru ve doğrulama.
- `server/`: Express API, Binance istemcisi ve SQLite.
- `data/bitcoin-lab.sqlite`: otomatik oluşan gerçek mum önbelleği ve rapor veritabanı. Demo mumları gerçek veri tablosuna kaydedilmez; demo raporları kaynak etiketiyle kaydedilir.
- `DATABASE_PATH`: alternatif SQLite dosyası. Klasörünün mevcut olması gerekir.
- Şablonlar ve tercihler aynı SQLite dosyasının `workspace` tablosunda tutulur. Önceki sürümden kalan `localStorage` şablonları ilk açılışta SQLite içine birleştirilir; başarılı kayıttan sonra eski anahtarlar kaldırılır.

Uygulama `127.0.0.1` üzerinde tek kullanıcıya yönelik yerel çalışma alanıdır. Hesaplar, bulut senkronizasyonu, JavaScript kodu çalıştırma veya otomatik parametre optimizasyonu bulunmaz. Python çalıştırıcısı güvenilen yerel kod içindir; internete açık çok kullanıcılı dağıtım için uygun değildir.

## Python stratejisi yükleme

**Stratejiler → Python stratejisi yükle** veya **Backtest Terminali → Strateji → Python Stratejisi → Python kodunu yükle / düzenle** alanını açın.

1. `.py` dosyanızı seçin veya kodu editöre yapıştırın. En fazla 64 KB UTF-8 kaynak kodu kabul edilir. **Örnek .py indir** ile çalışan bir yutan mum stratejisi alın.
2. **Sözdizimini kontrol et**, Python kodunu çalıştırmadan sözdizimini ve `on_candle` tanımını kontrol eder. Çalışma zamanı hataları backtestte gösterilir.
3. **Kaydet ve kullan**, kodu ve mevcut test ayarlarını yerel SQLite şablon kütüphanesine kaydeder. Değiştirilmiş sürüm yeni şablon olarak eklenir; eskisi korunur.
4. Zaman dilimini (örneğin **1m**), tarihleri ve risk ayarlarını seçip **Backtest Başlat** düğmesine basın. Test raporu kullanılan kodun kopyasını içerir. Rapor içindeki **Test edilen Python kodu** bölümünden inceleyebilirsiniz.

Fonksiyon arayüzü:

```python
def on_candle(candles, state):
    if len(candles) < 2:
        return "hold"
    previous, current = candles[-2], candles[-1]
    if current["close"] > previous["high"]:
        return "buy"
    if current["close"] < previous["low"]:
        return "sell"
    return "hold"
```

- `candles`, o ana kadar kapanmış mumların salt okunur sıralı görünümüdür; indeksleme, dilimleme, döngü ve `len()` desteklenir. Fonksiyona gelecek mumlar verilmez. Binance kesintilerinde ardışık iki mumun `time` farkı zaman diliminden büyük olabilir. Her mumda `time` (UTC Unix saniyesi), `open`, `high`, `low`, `close`, `volume` (BTC) alanları bulunur.
- Fonksiyon her mum için çağrılır; göstergelerinizin ısınma süresini kendi kodunuzda kontrol edin. Son mumdaki sinyal için sonraki mum bulunmadığından yeni işlem açılmaz.
- `state`, test başında boş olan ve çağrılar arasında korunan sözlüktür. Kendi hesaplamalarınızı saklayın. Gerçek portföy veya açık pozisyon bilgisi değildir; pozisyon açıldığını varsayan sayaçlar stop-loss/take-profit ile uyuşmayabilir.
- `"buy"` long giriş, `"sell"` long çıkış, `"hold"` veya `None` bekleme sinyalidir. İşlemler sonraki mumun açılışında gerçekleşir. Açık pozisyonda alım ve boş portföyde satış yok sayılır. Short ve pozisyon artırma desteklenmez.
- Komisyon, kayma, sermaye, stop-loss, take-profit ve test sonu kapanışı ortak backtest motorundan uygulanır. Backtrader gibi başka bir framework için yazılmış dosyalar `on_candle` arayüzüne uyarlanmalıdır.

Python **3.9+** gerekir. Varsayılan komut `python3`; farklı yorumlayıcı veya sanal ortam için sunucuyu `BTC_PYTHON=/tam/yol/.venv/bin/python npm run dev` ile başlatın. Ek paketler otomatik yüklenmez; gerekiyorsa seçtiğiniz ortama kendiniz kurun. Kullanıcının site-packages dizini `-I` nedeniyle yüklenmez; paketler seçilen sanal ortamda kurulu olmalıdır. [Python isolated mode belgesi](https://docs.python.org/3/using/cmdline.html#cmdoption-I).

**Yalnızca güvendiğiniz kodu çalıştırın.** Python ayrı süreçte çalışır ancak bir güvenlik sandbox'ı değildir: kullanıcı yetkileriyle dosyalara ve ağa erişebilir. Kod yüklemek, yedek içe aktarmak ve sözdizimi kontrolü kodu çalıştırmaz; **Backtest Başlat** çalıştırır. Ortam değişkenlerindeki uygulama sırları alt sürece aktarılmaz. API dış site Origin/Host isteklerini reddeder; bu kontroller kullanıcı kimlik doğrulamasının yerini tutmaz.

Çalıştırma 15 saniye, kaynak kodu 64 KB, süreç çıktısı 2 MB, `print` günlükleri 16 KB ile sınırlıdır. Günlükler rapora eklenmez. Linux'ta süreç adres alanı ayrıca 512 MB ile sınırlandırılır; macOS/Windows'ta aynı bellek sınırı uygulanmaz. Süre sınırı için hesabı optimize edin veya tarih aralığını daraltın.

Python kaynakları şablon ve raporlarla birlikte **Veri Merkezi** yedeklerine dahil edilir. Başka bilgisayarda güncel platform kodu, Python ve gerekli paketlerle aynı yedeği içe aktarabilirsiniz. Kodunuzu içeren yedekleri paylaşmadan önce inceleyin; gizli anahtarları stratejilere yazmayın. Eski platform sürümleri Python stratejisi içeren yedekleri açamaz; önce uygulamayı güncelleyin.

## Test geçmişini silme ve başka bilgisayara taşıma

- **Test Geçmişi:** Satırdaki çöp kutusuyla bir raporu veya kutucuklarla birden fazla raporu seçip **Seçilenleri sil** ile kaldırın. Onay penceresinde seçili raporlar gösterilir. Mumlar, strateji şablonları ve önceden indirilmiş yedek dosyaları silinmez. **Daha eski raporları yükle** ile ilk 100 rapordan öncekilere erişebilirsiniz.
- **Stratejiler → Kaydettiğiniz Şablonlar:** Şablon kartındaki çöp kutusuyla şablonu kaldırın. Bu şablonla oluşturulan raporlar ve mum verileri korunur.
- **Veri Merkezi → Tüm verileri dışa aktar:** Yerel deponun tamamını sürümlü bir JSON yedeği olarak indirir: tüm zaman dilimlerindeki mumlar, tüm raporlar/işlemler/sermaye eğrileri, özel strateji kuralları, şablonlar ve risk varsayılanları.
- Diğer bilgisayarda bu projenin kodunu kopyalayın, `npm install` ve `npm run dev` çalıştırın. **Veri Merkezi → Yedek dosyası seç** ile JSON dosyasını açın, içerik sayımlarını inceleyip **İçe aktarmayı başlat** düğmesine basın.

İçe aktarma yerel SQLite veritabanına yapılır. Aynı zaman dilimi ve açılış zamanına sahip mevcut mumlar, aynı kimliğe sahip mevcut raporlar korunur. Yeni kayıtlar eklenir; aynı ad ve yapılandırmaya sahip şablonlar çoğaltılmaz. Yedekte bulunan varsayılan ayarlar uygulanır. Önce tüm dosya doğrulanır, ardından mumlar, raporlar ve çalışma alanı tek SQLite işlemi içinde yazılır; hata olursa tamamı geri alınır. Silinmiş raporlar silmeden önce oluşturulmuş yedek içe aktarılarak geri getirilebilir.

JSON yedek sınırı **100 MB**, 1.000.000 mum, 10.000 rapor ve 1.000 şablondur. CSV çıktıları analiz amaçlıdır ve bu yedek içe aktarımına uygun değildir. Daha büyük depolar için uygulamayı kapatıp `data/` klasörünün tamamını diğer bilgisayara kopyalayabilirsiniz. Özellikle uygulama açıkken `.sqlite` dosyasını tek başına kopyalamayın; WAL dosyasında henüz aktarılmamış kayıtlar olabilir.

Yedek bir dosya olarak sizin kontrolünüzdedir; otomatik bulut senkronizasyonu yapılmaz. Aynı kodun diğer bilgisayarda bulunması tek başına verileri taşımaz; JSON yedeğini veya kapalı uygulamanın `data/` klasörünü de aktarmanız gerekir. İçe alınan mumlar ilgili tarih aralığını tamamen kapsıyorsa backtest bunları internet bağlantısı olmadan kullanabilir; canlı fiyatlar için internet gerekir.

## Kontroller

```sh
npm test
npm run lint
npm run format:check
npm run build
```

Lint için ESLint yerine [Oxlint](https://oxc.rs/docs/guide/usage/linter) kullanılır: ESLint'in TypeScript eklentisi, projenin kullandığı TypeScript 7'de bulunmayan TypeScript JavaScript API'sine ihtiyaç duyar. Kurallar `.oxlintrc.json` içindedir.

GitHub'a gönderilen her commit ve pull request'te `.github/workflows/ci.yml` tür denetimi, lint, biçim kontrolü, birim testleri ve derlemeyi Node 22.13 ile 24 üzerinde; tarayıcı testlerini ayrıca Chrome üzerinde çalıştırır.

Tarayıcı uçtan uca testleri (Google Chrome kurulu olmalı):

```sh
npm run test:e2e
```

Testler demo backtesti, rapor kalıcılığı, CSV indirme, şablon kaydetme, karşılaştırma ve mobil taşma kontrolünü içerir. Ekran görüntüleri `test-results/` içine yazılır. Playwright kendi geliştirme sunucusunu 5273 (arayüz) ve 3101 (API) portlarında, geçici dizinde yeni bir SQLite dosyasıyla başlatır; `data/` içindeki verileriniz ve yedekleriniz etkilenmez. Çalışan bir sunucuya karşı test etmek için `PLAYWRIGHT_BASE_URL` belirtin; bu durumda testlerin oluşturduğu kayıtlar o sunucunun veritabanında kalır.

Gerçek Binance bağlantısını ve gerçek verili backtesti ayrıca test etmek için:

```sh
LIVE_TESTS=1 npm run test:e2e -- live.spec.ts
```

Bu entegrasyon testi internet erişimi gerektirir; standart test çalıştırmasında atlanır. Birim testleri geçici bellek veritabanıyla 1000 mum üzeri sayfalamayı, önbelleği, eksik veriyi, kapanmamış mumları ve 429 bekleme kuralını da doğrular.

## Lisans

ISC. Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
