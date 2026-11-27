# Ollama Quota

Ekstensi GNOME Shell untuk memantau sisa kuota **Ollama Cloud** langsung dari panel atas.

- UUID: `ollama-quota@abdasis.github.io`
- Shell: `46`–`50` (lihat `metadata.json`; perbarui daftar bila ada versi lain yang diuji)
- Bahasa UI: Indonesia
- Tanpa dependensi runtime di luar GNOME Shell (Soup 3, St, Adwaita)

## Tampilan

Panel atas menampilkan persen sisa kuota. Bila API hanya memberi nominal (tanpa allowance),
panel menampilkan saldo USD; bila tidak ada data, tampil `—`.

Klik indikator membuka menu:

```
Sisa kuota                    72% · $72.50 dari $100.00
██████████████░░░░░░░░░
Reset                                    01/12/2026 07:00
Pemakaian 24 jam                 42 request · $3.20
Diperbarui                                        21:14
──────────────────────────────────────────────────────
Segarkan
Buka dashboard
Atur API key
```

- Bilah kuota menggambarkan persen sisa (0–100%).
- Warna berubah otomatis: kuning di bawah 20%, merah di bawah 5%.
- Menu dibuka → data langsung disegarkan. Segarkan juga berjalan otomatis tiap interval.
- Arahkan kursor ke indikator panel untuk melihat pesan kesalahan terakhir sebagai tooltip.

## Kebutuhan

- GNOME Shell 46–50
- `libsoup` 3.0 dan GJS (sudah termasuk dalam GNOME Shell)
- API key Ollama Cloud: https://ollama.com/settings/keys

## Instalasi

### Dari repo (mode pengembangan)

Symlink supaya perubahan kode langsung terbaca:

```bash
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/ollama-quota@abdasis.github.io
gnome-extensions enable ollama-quota@abdasis.github.io
```

Muat ulang shell setelah perubahan kode:

- X11: `Alt+F2`, ketik `r`, Enter
- Wayland: logout lalu login

### Paket `.zip` untuk distribusi

```bash
gnome-extensions pack --extra-source=lib --extra-source=icons
gnome-extensions install --force ollama-quota@abdasis.github.io.shell-extension.zip
```

## Konfigurasi

Buka preferensi lewat menu **Atur API key**, atau:

```bash
gnome-extensions prefs ollama-quota@abdasis.github.io
```

| Setelan | Key GSettings | Default | Keterangan |
|---|---|---|---|
| API key | `api-key` | kosong | Kunci dari halaman API keys Ollama |
| Interval penyegaran | `refresh-interval` | `5` | Menit, 1–60 |

Bisa juga lewat CLI:

```bash
gsettings --schemadir schemas set org.gnome.shell.extensions.ollama-quota api-key 'xxxxx'
gsettings --schemadir schemas set org.gnome.shell.extensions.ollama-quota refresh-interval 10
```

Tanpa API key, indikator menampilkan `—` dan tooltip "Belum ada API key".

## Cara kerja

- `GET https://ollama.com/api/balance` dengan header `Authorization: Bearer <api-key>` → ringkasan kuota.
- `GET https://ollama.com/api/usage?range=24h` → jumlah request dan biaya 24 jam. Opsional: bila gagal,
  baris pemakaian menampilkan "tidak tersedia" tanpa membatalkan penyegaran.
- Batas waktu tiap permintaan 15 detik. Permintaan dibatalkan saat ekstensi dinonaktifkan.
- Dua bentuk respons didukung (`lib/balance.js`):
  - **credit** — `included.balance_usd` dibagi `included.allowance_usd` → persen; `period.until` → waktu reset.
  - **legacy** — `included.session.remaining_percent` dan `included.weekly.remaining_percent`;
    dipakai persen terkecil, reset diambil dari tanggal terdekat.
- Persen di-clamp 0–100 dan tidak dibulatkan di lapisan data; pembulatan hanya untuk tampilan.
- Reset kuota dibaca dari API, bukan dihitung sendiri.

Kode kesalahan yang diterjemahkan ke pesan Indonesia: `401`/`403` (kunci ditolak), `429` (batas
permintaan), `503` (layanan tidak tersedia). `429` tidak diulang otomatis; timer berikutnya tetap jalan.

## Struktur

```
extension.js                 indikator panel, menu, bilah kuota, klien HTTP
prefs.js                     halaman preferensi (Adw)
lib/balance.js               normalisasi respons API + format tampilan
schemas/*.gschema.xml        definisi setelan
stylesheet.css               gaya label, bilah kuota, warna peringatan
icons/ollama-quota.png       ikon panel
test/balance.test.mjs        unit test logika (node:test)
metadata.json                metadata ekstensi
```

## Test

```bash
node --test test/
```

Butuh Node.js 20+. Yang diuji hanya logika murni di `lib/balance.js` (normalisasi bentuk credit dan
legacy, clamp, format USD/persen, fraksi lebar bilah); bagian GNOME Shell tidak tercakup.

## Pemecahan masalah

| Gejala | Penyebab umum |
|---|---|
| Indikator tidak muncul | Ekstensi belum aktif, atau `shell-version` di `metadata.json` tidak memuat versi shell (`gnome-shell --version`) |
| `—` terus muncul | API key kosong/ salah, atau jaringan gagal. Hover indikator untuk pesan |
| "API key ditolak" | Kunci dicabut atau salah salin. Buat ulang di halaman API keys |
| "Batas permintaan tercapai" | Terkena `429`; tunggu satu interval |
| Perubahan kode tidak terbaca | Shell belum dimuat ulang, atau folder terpasang berupa salinan, bukan symlink |
| Log | `journalctl -f -o cat /usr/bin/gnome-shell` |

## Keamanan

API key disimpan apa adanya di dconf milik user (`org.gnome.shell.extensions.ollama-quota api-key`),
bukan di keyring. Siapa pun yang bisa membaca sesi user dapat membacanya. Gunakan kunci khusus
untuk ekstensi ini dan cabut bila tidak dipakai lagi.

## Lisensi

GPL-3.0-or-later. Teks lengkap ada di [LICENSE](LICENSE). Setiap file sumber memuat penanda
`SPDX-License-Identifier: GPL-3.0-or-later`; kamu boleh memakai, mengubah, dan menyebarkan ulang
selama hasil turunannya tetap berlisensi sama.
