'use strict';
const { Router }  = require('express');
const router      = Router();
const { createClient } = require('@supabase/supabase-js');

const { loadConfig, saveConfig }    = require('../config');
const { supabase }                  = require('../supabase');
const { addLog }                    = require('../logger');
const { doLogin }                   = require('../epresensi');
const { generateAuthToken, authLimiter, authCache } = require('../auth');
const { setupScheduler, invalidateSchoolsCache } = require('../scheduler');
const { initBaileys, getWaState, BAILEYS_AUTH_DIR } = require('../whatsapp');

const fs   = require('fs');
const path = require('path');

// POST /api/auth/app-login
router.post('/auth/app-login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email dan password wajib diisi.' });
  try {
    const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) { console.error('[Login] Supabase error:', error?.message); return res.status(401).json({ success: false, error: 'Email atau password salah. Silakan periksa kembali.' }); }
    const { data: roleRows, error: roleError } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).limit(1);
    if (roleError) console.error('[DEBUG LOGIN] roleError:', roleError.message);
    const roleData = roleRows && roleRows.length > 0 ? roleRows[0] : null;
    const role     = roleData?.role || 'school_admin';
    const schoolId = role === 'super_admin' ? null : (roleData?.school_id || process.env.DEFAULT_SCHOOL_ID);
    console.log(`[DEBUG LOGIN] email: ${email}, userId: ${data.user.id}, assigned role: ${role}`);
    addLog(null, { type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    res.json({ success: true, token: data.session.access_token, role, schoolId });
  } catch (err) {
    console.error('[Login] Server error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat login.' });
  }
});

// POST /api/auth/change-app-password
router.post('/auth/change-app-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const cfg       = loadConfig();
  const validPass = cfg.appPassword || process.env.APP_PASSWORD || 'SMK3magelang';
  if (oldPassword !== validPass) return res.json({ success: false, error: 'Password lama salah.' });
  if (!newPassword || newPassword.length < 4) return res.json({ success: false, error: 'Password baru minimal 4 karakter.' });
  cfg.appPassword = newPassword;
  saveConfig(cfg);
  addLog({ type: 'info', message: '🔑 Password akses aplikasi berhasil diperbarui.' });
  const newToken = generateAuthToken(newPassword);
  res.json({ success: true, message: 'Password akses aplikasi berhasil diperbarui!', token: newToken });
});

// GET /api/accounts
router.get('/accounts', (req, res) => {
  const cfg      = loadConfig();
  const accounts = (cfg.accounts || []).map(a => ({ id: a.id || a.username, username: a.username, namaUser: a.namaUser || a.username, namaSekolah: a.namaSekolah || 'Unit Sekolah', unitCode: a.unitCode || 'F208007700', opdCode: a.opdCode || 'F200000000', lastLogin: a.lastLogin, isActive: a.username === cfg.username }));
  res.json({ activeAccount: { username: cfg.username || '', namaUser: cfg.namaUser || '', namaSekolah: cfg.namaSekolah || 'SMKN 3 MAGELANG', unitCode: cfg.unitCode || 'F208007700' }, accounts });
});

// POST /api/accounts/login
router.post('/accounts/login', async (req, res) => {
  const { username, password, customSchoolName } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Username (NIP) dan Password diperlukan.' });
  const loginRes = await doLogin(username.trim(), password.trim());
  if (!loginRes.success) return res.json({ success: false, error: loginRes.error || 'Gagal login ke ePresensi Jateng.' });
  const cfg = loadConfig();
  cfg.username = username.trim(); cfg.password = password.trim();
  if (customSchoolName && customSchoolName.trim()) cfg.namaSekolah = customSchoolName.trim();
  if (!cfg.accounts) cfg.accounts = [];
  const accIdx = cfg.accounts.findIndex(a => a.username === cfg.username);
  const accData = { id: cfg.username, username: cfg.username, password: cfg.password, namaUser: cfg.namaUser || cfg.username, namaSekolah: cfg.namaSekolah || customSchoolName || 'Unit Sekolah', unitCode: cfg.unitCode || 'F208007700', opdCode: cfg.opdCode || 'F200000000', lastLogin: new Date().toISOString() };
  if (accIdx >= 0) cfg.accounts[accIdx] = { ...cfg.accounts[accIdx], ...accData };
  else cfg.accounts.push(accData);
  saveConfig(cfg);
  res.json({ success: true, count: cfg.accounts.length });
});

// GET /api/wa/status
router.get('/wa/status', (req, res) => {
  const cfg = loadConfig();
  const { waConnectionStatus, waConnectedUser, waQrCodeDataUrl } = getWaState();
  res.json({ gateway: cfg.waGateway || 'baileys', status: waConnectionStatus, user: waConnectedUser, qr: waQrCodeDataUrl });
});

// POST /api/wa/restart
router.post('/wa/restart', async (req, res) => {
  console.log('[WhatsApp Web] Permintaan regenerasi QR / restart koneksi...');
  initBaileys();
  res.json({ success: true, message: 'Memulai ulang koneksi WhatsApp Web...' });
});

// POST /api/wa/logout
router.post('/wa/logout', async (req, res) => {
  console.log('[WhatsApp Web] Logout session...');
  const { waSock } = getWaState();
  try { if (waSock) await waSock.logout().catch(() => {}); } catch(e) {}
  try { fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true }); } catch(e) {}
  addLog({ type: 'info', message: '📱 Sesi WhatsApp Web telah diputus/logout.' });
  setTimeout(initBaileys, 1000);
  res.json({ success: true, message: 'WhatsApp Web berhasil diputuskan.' });
});

// GET /api/config
router.get('/config', async (req, res) => {
  const localCfg = loadConfig();
  const base     = req.tenantCfg || localCfg;

  // Selalu ambil school_configs langsung dari Supabase agar nilai jadwal akurat
  let schoolCfg = null;
  const schoolId = req.schoolId;
  if (schoolId) {
    try {
      const { data } = await supabase.from('school_configs').select('*').eq('school_id', schoolId).single();
      schoolCfg = data;
    } catch(e) { /* fallback ke base */ }
  }

  res.json({
    authMode:    base.authMode    || 'auto',
    username:    base.username    || '', usernameSet: !!base.username, passwordSet: !!base.password,
    cookieSet:   !!base.cookie, cookieExpiry: base.cookieExpiry,
    waGateway:   base.waGateway   || 'baileys',
    fonnteSet:   !!base.fonnteToken, fonnteToken: base.fonnteToken || '',
    waNumber:    base.waNumber    || '', waNumberSet: !!base.waNumber,

    // Scheduler — prioritaskan Supabase school_configs
    schedulerEnabled:       schoolCfg?.scheduler_enabled       ?? base.schedulerEnabled       ?? true,
    schedulerPagiEnabled:   schoolCfg?.scheduler_pagi_enabled  ?? base.schedulerPagiEnabled   ?? true,
    pagiHour:               schoolCfg?.pagi_hour               ?? base.pagiHour               ?? 7,
    pagiMinute:             schoolCfg?.pagi_minute             ?? base.pagiMinute             ?? 30,
    schedulerSiangEnabled:  schoolCfg?.scheduler_siang_enabled ?? base.schedulerSiangEnabled  ?? true,
    siangHour:              schoolCfg?.siang_hour              ?? base.siangHour              ?? 15,
    siangMinute:            schoolCfg?.siang_minute            ?? base.siangMinute            ?? 30,
    schedulerPulangEnabled: schoolCfg?.scheduler_pulang_enabled ?? base.schedulerPulangEnabled ?? true,
    pulangHour:             schoolCfg?.pulang_hour             ?? base.pulangHour             ?? 18,
    pulangMinute:           schoolCfg?.pulang_minute           ?? base.pulangMinute           ?? 0,

    // Template pesan — Supabase dulu, lalu local
    message:            base.message            || '',
    messagePagi:        schoolCfg?.message_pagi        || base.messagePagi        || '',
    messagePagiSudah:   schoolCfg?.message_pagi_sudah  || base.messagePagiSudah   || '',
    messageSiang:       schoolCfg?.message_siang       || base.messageSiang       || '',
    messageSiangSudah:  schoolCfg?.message_siang_sudah || base.messageSiangSudah  || '',
    messagePulang:      schoolCfg?.message_pulang      || base.messagePulang      || '',
    messagePulangSudah: schoolCfg?.message_pulang_sudah || base.messagePulangSudah || '',
    testModeSudahAbsen: base.testModeSudahAbsen || false,
  });
});


// POST /api/config
router.post('/config', async (req, res) => {
  const current = loadConfig();
  const allowed = ['authMode','username','password','cookie','waGateway','fonnteToken','waNumber','schedulerEnabled','schedulerPagiEnabled','pagiHour','pagiMinute','schedulerSiangEnabled','siangHour','siangMinute','schedulerPulangEnabled','pulangHour','pulangMinute','message','messagePagi','messagePagiSudah','messageSiang','messageSiangSudah','messagePulang','messagePulangSudah','testModeSudahAbsen'];
  const updated = { ...current };
  for (const key of allowed) { if (req.body[key] !== undefined && req.body[key] !== '') updated[key] = req.body[key]; }
  saveConfig(updated);
  const schoolId = req.schoolId || req.user?.schoolId;
  const syncData = { scheduler_enabled: updated.schedulerEnabled !== false, scheduler_siang_enabled: updated.schedulerSiangEnabled !== false, pagi_hour: Number(updated.pagiHour ?? 7), pagi_minute: Number(updated.pagiMinute ?? 30), siang_hour: Number(updated.siangHour ?? 15), siang_minute: Number(updated.siangMinute ?? 30), pulang_hour: Number(updated.pulangHour ?? 18), pulang_minute: Number(updated.pulangMinute ?? 0), message_pagi: updated.messagePagi || null, message_pagi_sudah: updated.messagePagiSudah || null, message_siang: updated.messageSiang || null, message_siang_sudah: updated.messageSiangSudah || null, message_pulang: updated.messagePulang || null, message_pulang_sudah: updated.messagePulangSudah || null };
  if (schoolId) { supabase.from('school_configs').update(syncData).eq('school_id', schoolId).then(({ error }) => { if (error) console.error('[Config] Gagal sync ke Supabase:', error.message); else console.log(`[Config] Jadwal sync untuk schoolId: ${schoolId}`); }); }
  else { supabase.from('school_configs').update(syncData).not('school_id', 'is', null).then(({ error }) => { if (error) console.error('[Config] Gagal sync semua sekolah:', error.message); else console.log('[Config] Jadwal sync ke semua sekolah.'); }); }
  const schedulerFields = ['schedulerEnabled','schedulerPagiEnabled','pagiHour','pagiMinute','schedulerSiangEnabled','siangHour','siangMinute','schedulerPulangEnabled','pulangHour','pulangMinute'];
  const schedulerChanged = schedulerFields.some(k => req.body[k] !== undefined && req.body[k] !== '');
  if (schedulerChanged) {
    console.log('[Config] Setting jadwal berubah — reset cache & restart scheduler...');
    invalidateSchoolsCache(); // reset scheduler cache
    authCache.clear();        // reset auth cache agar tenantCfg fresh di request berikutnya
    setupScheduler();
  } else {
    // Selalu clear auth cache saat config apapun berubah
    authCache.clear();
  }
  res.json({ success: true });
});

// POST /api/login (ePresensi login)
router.post('/login', async (req, res) => {
  const cfg = loadConfig();
  const username = req.body.username || cfg.username;
  const password = req.body.password || cfg.password;
  if (!username || !password) return res.json({ success: false, error: 'Username dan password diperlukan.' });
  if (req.body.username && req.body.password) { const c = loadConfig(); c.username = req.body.username; c.password = req.body.password; c.authMode = 'auto'; saveConfig(c); }
  res.json(await doLogin(username, password));
});

module.exports = router;
