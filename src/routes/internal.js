'use strict';
const { Router } = require('express');
const router = Router();

const {
  getActiveSchools, buildTenantCfg,
  runSchedulerLogic, runWeeklyRekapLogic, runMonthlyRekapLogic, runDailyArchiverLogic,
  notifyTelegramFromLog
} = require('../scheduler');

// ─── Middleware: hanya localhost ────────────────────────────────────────────────
function onlyLocalhost(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ success: false, error: 'Akses ditolak: hanya dari localhost.' });
  next();
}

// ─── Middleware: secret dari .env (opsional, tapi dianjurkan) ──────────────────
function checkSecret(req, res, next) {
  const envSecret = process.env.INTERNAL_SECRET;
  if (!envSecret) return next(); // Jika tidak di-set, lewati pengecekan
  const reqSecret = req.body?.secret || req.query?.secret;
  if (reqSecret !== envSecret) return res.status(401).json({ success: false, error: 'Secret tidak cocok.' });
  next();
}

// ─── POST /internal/run-scheduler ─────────────────────────────────────────────
// Body: { type: "pagi"|"siang"|"pulang"|"rekap_mingguan"|"rekap_bulanan"|"archiver", secret: "..." }
router.post('/run-scheduler', onlyLocalhost, checkSecret, async (req, res) => {
  const type = req.body?.type || 'pagi';
  console.log(`[Internal] Manual trigger: type=${type}`);

  try {
    const schools = await getActiveSchools();
    if (!schools || schools.length === 0) {
      return res.json({ success: false, error: 'Tidak ada sekolah aktif di database.' });
    }

    // Paralel — kedua sekolah kirim WA bersamaan (Telegram menyusul setelah semua selesai)
    const schoolResults = await Promise.all(schools.map(async (schoolRow) => {
      const cfg = buildTenantCfg(schoolRow);
      let result;
      try {
        if (type === 'rekap_mingguan') {
          result = await runWeeklyRekapLogic(cfg, true, true); // skipTelegram=true
        } else if (type === 'rekap_bulanan') {
          result = await runMonthlyRekapLogic(cfg, true, true);
        } else if (type === 'archiver') {
          result = await runDailyArchiverLogic(cfg);
        } else {
          result = await runSchedulerLogic(type, cfg, true); // skipTelegram=true
        }
      } catch (err) {
        result = { success: false, sent: 0, error: err.message };
      }
      console.log(`[Internal] WA selesai: ${cfg.namaSekolah} — ${result.message || result.error}`);
      return { cfg, sekolah: cfg.namaSekolah, type, ...result };
    }));

    // Setelah SEMUA sekolah selesai WA — baru kirim Telegram
    console.log('[Internal] Semua sekolah selesai WA — kirim laporan Telegram...');
    for (const { cfg, type: runType } of schoolResults) {
      if (runType && runType !== 'archiver') {
        await notifyTelegramFromLog(runType, cfg.namaSekolah, cfg.schoolId || null).catch(() => {});
      }
    }

    const results = schoolResults.map(({ cfg: _cfg, ...rest }) => rest);
    const totalSent = schoolResults.reduce((sum, r) => sum + (r.sent || 0), 0);

    return res.json({
      success: true,
      message: `Trigger '${type}' selesai. Total ${totalSent} pesan terkirim.`,
      results
    });

  } catch (err) {
    console.error('[Internal] Error saat run-scheduler:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }

});

module.exports = router;
