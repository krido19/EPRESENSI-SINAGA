'use strict';
const { Router } = require('express');
const router = Router();

const { loadConfig, saveConfig }  = require('../config');
const { supabase }                = require('../supabase');
const { addLog }                  = require('../logger');
const { getActiveSchools, buildTenantCfg, runWeeklyRekapLogic, runMonthlyRekapLogic, runDailyArchiverLogic, runBackfillLogic, runSchedulerLogic } = require('../scheduler');

// POST /api/scheduler/run-now
router.post('/run-now', async (req, res) => {
  const type = req.body.type || 'pagi';
  try {
    if (type === 'rekap_mingguan') {
      const schools = await getActiveSchools();
      if (!schools || schools.length === 0) return res.json({ success: false, error: 'Tidak ada sekolah aktif di database.' });
      let totalSent = 0;
      const results = [];
      for (const schoolRow of schools) {
        const cfg    = buildTenantCfg(schoolRow);
        const result = await runWeeklyRekapLogic(cfg, true); // true = isTest
        totalSent   += result.sent || 0;
        results.push({ sekolah: cfg.namaSekolah, ...result });
      }
      return res.json({ success: true, message: `Rekap mingguan selesai. Total ${totalSent} pesan terkirim.`, results });
    }
    if (type === 'rekap_bulanan') {
      const schools = await getActiveSchools();
      if (!schools || schools.length === 0) return res.json({ success: false, error: 'Tidak ada sekolah aktif di database.' });
      let totalSent = 0;
      const results = [];
      for (const schoolRow of schools) {
        const cfg    = buildTenantCfg(schoolRow);
        const result = await runMonthlyRekapLogic(cfg, true); // true = isTest
        totalSent   += result.sent || 0;
        results.push({ sekolah: cfg.namaSekolah, ...result });
      }
      return res.json({ success: true, message: `Rekap bulanan selesai. Total ${totalSent} pesan terkirim.`, results });
    }
    if (type === 'archiver') {
      const schools = await getActiveSchools();
      if (!schools || schools.length === 0) return res.json({ success: false, error: 'Tidak ada sekolah aktif di database.' });
      const results = [];
      for (const schoolRow of schools) {
        const cfg    = buildTenantCfg(schoolRow);
        const result = await runDailyArchiverLogic(cfg);
        results.push({ sekolah: cfg.namaSekolah, ...result });
      }
      return res.json({ success: true, message: results.map(r => `${r.sekolah}: ${r.message || r.error}`).join('\n'), results });
    }
    if (type === 'backfill') {
      const schools = await getActiveSchools();
      if (!schools || schools.length === 0) return res.json({ success: false, error: 'Tidak ada sekolah aktif di database.' });
      const results = [];
      for (const schoolRow of schools) {
        const cfg    = buildTenantCfg(schoolRow);
        const result = await runBackfillLogic(cfg, req.body.date);
        results.push({ sekolah: cfg.namaSekolah, ...result });
      }
      return res.json({ success: true, message: results.map(r => `${r.sekolah}: ${r.message || r.error}`).join('\n'), results });
    }
    const validType = ['pagi', 'siang', 'pulang'].includes(type) ? type : 'pagi';
    const result    = await runSchedulerLogic(validType);
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET /api/scheduler/config-status — cek status konfigurasi tanpa expose secrets
router.get('/config-status', (req, res) => {
  res.json({
    telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_ID),
    fonnteConfigured:   !!(process.env.FONNTE_TOKEN),
  });
});

module.exports = router;
