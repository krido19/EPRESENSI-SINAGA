const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Find the broken block: from "if (targets.length === 0)" containing scheduler code
// through setupScheduler()
const MARKER_START = "  if (targets.length === 0) {\r\n    const msg = `${labelWaktu}: Ada ${targets_raw.length} guru target, tapi nomor WA belum terdaftar di sistem.`;\r\n    addLog({ type: 'info', message: msg });\r\n    return;\r\n  }\r\n\r\n  // 1. Jadwal Pagi (Absen Masuk)";
const MARKER_END   = "setupScheduler();\r\n\r\n// ─── Manual Trigger Scheduler";

const startIdx = c.indexOf(MARKER_START);
const endIdx   = c.indexOf(MARKER_END);

if (startIdx === -1 || endIdx === -1) {
  console.error('❌ Could not find broken block');
  console.log('start:', startIdx, 'end:', endIdx);
  process.exit(1);
}

const CORRECT_BLOCK = `  if (targets.length === 0) {
    const msg = \`\${labelWaktu}: Ada \${targets_raw.length} guru target, tapi nomor WA belum terdaftar di sistem.\`;
    addLog({ type: 'info', message: msg });
    return { success: true, sent: 0, total: 0, message: msg };
  }

  let sentCount = 0;
  const defaultMsgPagiSudah = "Halo *{nama}*! 👋\\n\\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pagi / masuk hari ini di ePresensi Jateng. Selamat bertugas! 🏢✨\\n\\n_Pesan otomatis ePresensi_";
  const defaultMsgPulangSudah = "Halo *{nama}*! 👋\\n\\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pulang hari ini di ePresensi Jateng. Selamat beristirahat! 🏡✨\\n\\n_Pesan otomatis ePresensi_";

  const msgPagiSudah   = config.messagePagiSudah   || defaultMsgPagiSudah;
  const msgPulangSudah = config.messagePulangSudah  || defaultMsgPulangSudah;
  const msgBelumPagi   = config.messagePagi   || config.message;
  const msgBelumPulang = config.messagePulang || config.message;

  const logsArr = [];
  for (const t of targets) {
    let template = '';
    if (type === 'pagi')   template = t.isHadir ? msgPagiSudah   : msgBelumPagi;
    else                   template = t.isHadir ? msgPulangSudah  : msgBelumPulang;
    const msg = template.replace(/\\{nama\\}/gi, t.nama);
    const sRes = await sendWhatsApp(config.fonnteToken, t.nomor, msg);
    if (sRes.success) { sentCount++; logsArr.push({ nama: t.nama, nomor: t.nomor, text: msg }); }
    await new Promise(r => setTimeout(r, 1000));
  }

  const summaryMsg = \`\${labelWaktu}: Notifikasi WA terkirim ke \${sentCount}/\${targets.length} guru (Laporan Status).\`;
  addLog({ type: sentCount > 0 ? 'sent' : 'error', message: summaryMsg, detailMessage: 'Menjalankan pengiriman laporan ke semua guru.', targets: logsArr });
  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
}

// ─── Scheduler (Master 1-Menit — baca config.json lokal, tanpa query Supabase) ─
let masterCron = null;

function setupScheduler() {
  if (masterCron) { masterCron.stop(); masterCron = null; }

  // Satu cron berjalan tiap 1 menit — tidak butuh query ke Supabase sama sekali
  masterCron = cron.schedule('* * * * *', async () => {
    const cfg = loadConfig();
    if (!cfg.schedulerEnabled) return;

    const now = new Date();
    const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const H = wib.getHours();
    const M = wib.getMinutes();

    // Cek jadwal Pagi
    if (cfg.schedulerPagiEnabled !== false) {
      if (H === (cfg.pagiHour ?? 7) && M === (cfg.pagiMinute ?? 30)) {
        console.log(\`[Scheduler 🌅 Pagi] Memulai pada \${String(H).padStart(2,'0')}:\${String(M).padStart(2,'0')} WIB...\`);
        try { await runSchedulerLogic('pagi'); }
        catch (err) { addLog({ type: 'error', message: \`🌅 Error scheduler pagi: \${err.message}\` }); }
      }
    }

    // Cek jadwal Pulang
    if (cfg.schedulerPulangEnabled !== false) {
      if (H === (cfg.pulangHour ?? 18) && M === (cfg.pulangMinute ?? 0)) {
        console.log(\`[Scheduler 🌆 Pulang] Memulai pada \${String(H).padStart(2,'0')}:\${String(M).padStart(2,'0')} WIB...\`);
        try { await runSchedulerLogic('pulang'); }
        catch (err) { addLog({ type: 'error', message: \`🌆 Error scheduler pulang: \${err.message}\` }); }
      }
    }
  });

  const cfg = loadConfig();
  if (cfg.schedulerEnabled) {
    const ph = String(cfg.pagiHour ?? 7).padStart(2,'0');
    const pm = String(cfg.pagiMinute ?? 30).padStart(2,'0');
    const uh = String(cfg.pulangHour ?? 18).padStart(2,'0');
    const um = String(cfg.pulangMinute ?? 0).padStart(2,'0');
    console.log(\`[Scheduler] Master Cron aktif → Pagi \${ph}:\${pm} | Pulang \${uh}:\${um} WIB\`);
  } else {
    console.log('[Scheduler] Nonaktif (bisa diaktifkan dari Pengaturan)');
  }
}
setupScheduler();

// ─── Manual Trigger Scheduler`;

const endFull = MARKER_END;
c = c.slice(0, startIdx) + CORRECT_BLOCK + c.slice(endIdx + endFull.length);
fs.writeFileSync('server.js', c);
console.log('✅ Master cron applied successfully');
