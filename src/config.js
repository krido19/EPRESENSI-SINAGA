'use strict';
const fs   = require('fs');
const path = require('path');

// ─── Default WhatsApp Templates ───────────────────────────────────────────────
const DEF_MSG_PAGI         = "Halo {nama}! 👋\n\nPengingat presensi pagi:\nAnda tercatat:\n\n██████████████████\n██  B E L U M  ██\n██████████████████\n\nmelakukan absen pagi / masuk hari ini di ePresensi Jateng.\n\nSegera lakukan presensi masuk sekarang ya! 🏃💨\n\nE-PRESENSI SINAGA";
const DEF_MSG_PAGI_SUDAH   = "Halo {nama}! 👋\n\nTerima kasih, Anda tercatat:\n\n██████████████████\n██  S U D A H  ██\n██████████████████\n\nmelakukan presensi pagi / masuk hari ini di ePresensi Jateng. Selamat bertugas! 🏢✨\n\nE-PRESENSI SINAGA";
const DEF_MSG_SIANG        = "Halo {nama}! 👋\n\nPengingat presensi siang:\nAnda tercatat:\n\n██████████████████\n██  B E L U M  ██\n██████████████████\n\nmelakukan absen siang hari ini di ePresensi Jateng.\n\nSegera lakukan presensi siang sekarang ya! 🏃💨\n\nE-PRESENSI SINAGA";
const DEF_MSG_SIANG_SUDAH  = "Halo {nama}! 👋\n\nTerima kasih, Anda tercatat:\n\n██████████████████\n██  S U D A H  ██\n██████████████████\n\nmelakukan presensi siang hari ini di ePresensi Jateng. Selamat bertugas kembali! 🏢✨\n\nE-PRESENSI SINAGA";
const DEF_MSG_PULANG       = "Halo {nama}! 👋\n\nPengingat presensi pulang:\nAnda tercatat:\n\n██████████████████\n██  B E L U M  ██\n██████████████████\n\nmelakukan absen pulang hari ini di ePresensi Jateng.\n\nJangan lupa lakukan presensi pulang sebelum batas waktu berakhir! 🏃💨\n\nE-PRESENSI SINAGA";
const DEF_MSG_PULANG_SUDAH = "Halo {nama}! 👋\n\nTerima kasih, Anda tercatat:\n\n██████████████████\n██  S U D A H  ██\n██████████████████\n\nmelakukan presensi pulang hari ini di ePresensi Jateng. Selamat beristirahat! 🏡✨\n\nE-PRESENSI SINAGA";
const DEF_MSG              = "Halo {nama}! 👋\n\nPengingat presensi:\nAnda belum melakukan absen hari ini di ePresensi Jateng. Segera absen sekarang! 🏃💨";

// ─── Default WA Templates — Penerima Eksternal (Beda Sekolah) ────────────────
const DEF_MSG_EXTERNAL_PAGI   = "Halo {nama}! 👋\n\nIni pengingat absensi pagi dari E-PRESENSI SINAGA untuk {sekolah_asal}.\n\nJangan lupa lakukan presensi masuk sesuai jadwal sekolah Anda sekarang ya! 🏃💨\n\nE-PRESENSI SINAGA";
const DEF_MSG_EXTERNAL_SIANG  = "Halo {nama}! 👋\n\nIni pengingat absensi siang dari E-PRESENSI SINAGA untuk {sekolah_asal}.\n\nJangan lupa lakukan presensi siang sesuai jadwal sekolah Anda sekarang ya! ☀️\n\nE-PRESENSI SINAGA";
const DEF_MSG_EXTERNAL_PULANG = "Halo {nama}! 👋\n\nIni pengingat absensi pulang dari E-PRESENSI SINAGA untuk {sekolah_asal}.\n\nJangan lupa lakukan presensi pulang sebelum batas waktu berakhir! 🏡\n\nE-PRESENSI SINAGA";

// ─── Default WA Template — Rekap Mingguan (Sabtu Pagi) ───────────────────────
const DEF_MSG_REKAP_MINGGUAN = "Halo {nama}! 👋\n\n📊 *REKAP HADIR MINGGU INI*\n({tanggal_mulai} – {tanggal_selesai})\n\n{detail_hari}\n\n✅ Total hadir: {total_hadir}/{total_hari_kerja} hari kerja\n\nE-PRESENSI SINAGA";

// ─── Storage File Paths ───────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const LOG_FILE    = path.join(__dirname, '..', 'logs.json');

// ─── loadConfig ───────────────────────────────────────────────────────────────
function loadConfig() {
  let data = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading config.json (korup):', e.message);
      const bakFile = CONFIG_FILE + '.bak';
      if (fs.existsSync(bakFile)) {
        try {
          data = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
          console.warn('[Config] ⚠️ config.json korup, berhasil restore dari config.json.bak');
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (e2) {
          console.error('[Config] ❌ Backup juga gagal dibaca:', e2.message);
        }
      }
    }
  }

  const username    = process.env.EPRESENSI_USERNAME || data.username    || '';
  const password    = process.env.EPRESENSI_PASSWORD || data.password    || '';
  const fonnteToken = process.env.FONNTE_TOKEN       || data.fonnteToken || '';
  const appPassword = process.env.APP_PASSWORD       || data.appPassword || 'SMK3magelang';
  const waNumber    = process.env.WA_NUMBER          || data.waNumber    || '';

  return {
    authMode:                data.authMode || 'auto',
    username, password,
    cookie:                  data.cookie       || '',
    cookieExpiry:            data.cookieExpiry || null,
    fonnteToken,
    waGateway:               data.waGateway || 'baileys',
    waNumber,
    schedulerEnabled:        data.schedulerEnabled       !== false,
    schedulerPagiEnabled:    data.schedulerPagiEnabled   !== false,
    pagiHour:                data.pagiHour   ?? 7,
    pagiMinute:              data.pagiMinute ?? 30,
    schedulerPulangEnabled:  data.schedulerPulangEnabled !== false,
    pulangHour:              data.pulangHour   ?? 18,
    pulangMinute:            data.pulangMinute ?? 0,
    jumatPulangEnabled:      data.jumatPulangEnabled !== false,
    jumatPulangHour:         data.jumatPulangHour   ?? 14,
    jumatPulangMinute:       data.jumatPulangMinute ?? 0,
    messagePagi:             data.messagePagi           || DEF_MSG_PAGI,
    messagePagiSudah:        data.messagePagiSudah      || DEF_MSG_PAGI_SUDAH,
    messageSiang:            data.messageSiang          || DEF_MSG_SIANG,
    messageSiangSudah:       data.messageSiangSudah     || DEF_MSG_SIANG_SUDAH,
    messagePulang:           data.messagePulang         || DEF_MSG_PULANG,
    messagePulangSudah:      data.messagePulangSudah    || DEF_MSG_PULANG_SUDAH,
    message:                 data.message               || DEF_MSG,
    messageExternalPagi:     data.messageExternalPagi   || DEF_MSG_EXTERNAL_PAGI,
    messageExternalSiang:    data.messageExternalSiang  || DEF_MSG_EXTERNAL_SIANG,
    messageExternalPulang:   data.messageExternalPulang || DEF_MSG_EXTERNAL_PULANG,
    messageRekapMingguan:    data.messageRekapMingguan  || DEF_MSG_REKAP_MINGGUAN,
    appPassword,
    namaSekolah:             data.namaSekolah || 'SMKN 3 MAGELANG',
    unitCode:                data.unitCode    || 'F208007700',
    opdCode:                 data.opdCode     || 'F200000000',
    namaUser:                data.namaUser    || '',
    waAdminNumber:           data.waAdminNumber || '',
    accounts:                Array.isArray(data.accounts) ? data.accounts : []
  };
}

// ─── saveConfig ───────────────────────────────────────────────────────────────
function saveConfig(cfg) {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch (e) {}
    }
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tempFile, CONFIG_FILE);
  } catch (e) {
    console.error('[Config] Error saveConfig:', e.message);
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); } catch(e2) {}
  }
}

module.exports = {
  loadConfig, saveConfig, CONFIG_FILE, LOG_FILE,
  DEF_MSG_PAGI, DEF_MSG_PAGI_SUDAH, DEF_MSG_SIANG, DEF_MSG_SIANG_SUDAH,
  DEF_MSG_PULANG, DEF_MSG_PULANG_SUDAH, DEF_MSG,
  DEF_MSG_EXTERNAL_PAGI, DEF_MSG_EXTERNAL_SIANG, DEF_MSG_EXTERNAL_PULANG,
  DEF_MSG_REKAP_MINGGUAN
};
