# Çalışma alanı yedeği

`initial-workspace.json`, GitHub deposu oluşturulurken alınan yerel çalışma alanı kopyasıdır. Dosyanın `exportedAt` alanı kesin yedek zamanını belirtir. Otomatik testlerin o tarihte yerel veritabanına yazdığı şablonlar ve raporlar dosyadan çıkarılmıştır; mumlar ve diğer raporlar değiştirilmemiştir.

Diğer bilgisayarda projeyi çalıştırdıktan sonra **Veri Merkezi → Yedek dosyası seç → İçe aktarmayı başlat** yolunu kullanın. Mevcut kayıtlar korunur; yeni mumlar, raporlar ve şablonlar yerel SQLite veritabanına eklenir. Yedekteki varsayılan ayarlar uygulanır.

Bu dosya uygulama kullanılırken otomatik güncellenmez. Son değişiklikleri taşımak için Veri Merkezi'nden yeni bir JSON yedeği oluşturun.
