'use strict';
const { Router } = require('express');
const XLSX       = require('xlsx');
const multer     = require('multer');
const upload     = multer({ storage: multer.memoryStorage() });
const router     = Router();

const { loadConfig }              = require('../config');
const { supabase }                = require('../supabase');
const { addLog }                  = require('../logger');
const { sendWhatsApp, sendWhatsAppWithRetry, sendToAllRecipients } = require('../whatsapp');
const { ensureTenantSession, fetchColleaguesAttendance, ensureValidSession, checkAttendance } = require('../epresensi');
const { buildTenantCfg }          = require('../scheduler');

// GET /api/colleagues
router.get('/', async (req, res) => {
  const role   = req.userRole;
  const cfg    = req.tenantCfg || loadConfig();
  const day    = req.query.day   || null;
  const month  = req.query.month || null;
  const year   = req.query.year  || null;
  const forceRefresh = req.query.refresh === 'true';
  const session = role === 'super_admin'
    ? await ensureValidSession()
    : await ensureTenantSession(cfg);
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const result = await fetchColleaguesAttendance(session.cookie, day, month, year, forceRefresh, 0, cfg);
  res.json(result);
});

// GET /api/colleagues/debug-html
router.get('/debug-html', async (req, res) => {
  const cfg     = req.tenantCfg || loadConfig();
  const session = await ensureTenantSession(cfg);
  if (!session.success) return res.json({ success: false, error: session.error });
  const fetch   = require('node-fetch');
  const { HEADERS_BASE, BASE_URL } = require('../epresensi');
  const formData = new URLSearchParams();
  formData.append('opd', cfg.opdCode || 'F200000000'); formData.append('unit', cfg.unitCode || 'F208007700');
  formData.append('rl', '100'); formData.append('bulan', String(new Date().getMonth() + 1).padStart(2,'0')); formData.append('tahun', String(new Date().getFullYear())); formData.append('nip', '');
  const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, { method: 'POST', headers: { ...HEADERS_BASE, 'Cookie': session.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() });
  const html = await r.text();
  res.setHeader('Content-Type', 'text/html'); res.send(html);
});

// GET /api/colleagues/:nip/history
router.get('/:nip/history', async (req, res) => {
  const { nip } = req.params;
  const { month, year } = req.query;
  const cfg     = req.tenantCfg || loadConfig();
  const session = await ensureTenantSession(cfg);
  if (!session.success) return res.json({ success: false, error: session.error });
  const result = await fetchColleaguesAttendance(session.cookie, null, month || null, year || null, false, 0, cfg);
  if (!result.success) return res.json(result);
  const teacher = result.colleagues.find(c => c.nip === nip);
  if (!teacher) return res.json({ success: false, error: `Guru NIP ${nip} tidak ditemukan.` });
  res.json({ success: true, teacher });
});

// POST /api/check (presensi personal)
router.post('/check', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const result = await checkAttendance(session.cookie);
  if (result.success) addLog({ type: 'manual_check', message: `Cek presensi: ${result.data.status} (Masuk: ${result.data.jamMasuk || '-'})`, data: result.data });
  res.json(result);
});

// POST /api/send-unabsent
router.post('/send-unabsent', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.fonnteToken) return res.json({ success: false, error: 'Token Fonnte belum diset di menu Konfigurasi.' });
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const day = req.body.day || new Date().getDate();
  const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day);
  if (!colleaguesRes.success) return res.json({ success: false, error: colleaguesRes.error });
  const unabsentList = colleaguesRes.colleagues.filter(c => !c.isHadir && !c.status.includes('Libur'));
  if (unabsentList.length === 0) return res.json({ success: true, message: 'Semua guru sudah hadir atau hari libur.', sentCount: 0, totalUnabsent: 0 });
  let q = supabase.from('recipients').select('*').eq('aktif', true);
  if (cfg.schoolId) q = q.eq('school_id', cfg.schoolId);
  const { data } = await q;
  const registeredRecipients = data || [];
  const targets = [], unmatched = [];
  for (const guru of unabsentList) {
    const cleanGuruName = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = registeredRecipients.find(r => { const cleanRName = r.nama.toLowerCase().replace(/[^a-z0-9]/g, ''); return cleanGuruName.includes(cleanRName) || cleanRName.includes(cleanGuruName); });
    if (found && found.nomor) targets.push({ nama: guru.nama, nomor: found.nomor, nip: guru.nip });
    else unmatched.push({ nama: guru.nama, nip: guru.nip });
  }
  if (targets.length === 0) return res.json({ success: false, error: `Ditemukan ${unabsentList.length} guru belum absen, tetapi belum ada nomor WhatsApp mereka di Daftar Penerima WA.`, unabsentCount: unabsentList.length, unmatched });
  const template = req.body.message || cfg.message;
  const results  = [];
  for (const t of targets) {
    const msg     = template.replace(/\{nama\}/gi, t.nama);
    const sendRes = await sendWhatsApp(cfg.fonnteToken, t.nomor, msg);
    results.push({ nama: t.nama, nomor: t.nomor, success: sendRes.success });
    await new Promise(r => setTimeout(r, 1000));
  }
  const successCount = results.filter(r => r.success).length;
  addLog({ type: successCount > 0 ? 'sent' : 'error', message: `⚡ Notif Cepat: Terkirim ke ${successCount}/${targets.length} rekan yang belum absen`, targets: targets.map(t => ({ nama: t.nama, nomor: t.nomor, text: template.replace(/\{nama\}/gi, t.nama) })) });
  res.json({ success: true, sentCount: successCount, totalTargets: targets.length, totalUnabsent: unabsentList.length, unmatchedCount: unmatched.length, results, unmatched });
});

// POST /api/send-direct
router.post('/send-direct', async (req, res) => {
  const { nomor, nama, message, isHadir } = req.body;
  if (!nomor) return res.json({ success: false, error: 'Nomor WhatsApp tidak valid.' });
  const cfg = loadConfig();
  let finalMsg;
  if (message) {
    finalMsg = message.replace(/\{nama\}/gi, nama || 'Bapak/Ibu');
  } else {
    const jam = parseInt(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }), 10);
    const sudahHadir = isHadir === true || isHadir === 'true';
    let template;
    if (jam < 12) template = sudahHadir ? (cfg.messagePagiSudah || 'Terima kasih *{nama}*, Anda sudah tercatat hadir pagi ini! ✅') : (cfg.messagePagi || 'Halo *{nama}*, jangan lupa lakukan absensi masuk di ePresensi Jateng ya! ⏰');
    else if (jam < 15) template = sudahHadir ? (cfg.messageSiangSudah || 'Terima kasih *{nama}*, Anda sudah tercatat hadir! ✅') : (cfg.messageSiang || 'Halo *{nama}*, Anda belum absen siang ini. Segera lakukan presensi! ⏰');
    else template = sudahHadir ? (cfg.messagePulangSudah || 'Terima kasih *{nama}*, Anda sudah tercatat hadir hari ini! 🎉') : (cfg.messagePulang || 'Halo *{nama}*, jangan lupa absen pulang di ePresensi Jateng ya! 🕕');
    finalMsg = template.replace(/\{nama\}/gi, nama || 'Bapak/Ibu');
  }
  const result = await sendWhatsAppWithRetry(nomor, finalMsg, cfg.fonnteToken || null);
  if (result.success) addLog({ type: 'sent', message: `💬 Kirim Langsung: Notifikasi terkirim ke ${nama || nomor} (${nomor})`, detailMessage: finalMsg, recipient: { nama: nama || nomor, nomor }, gateway: result.gateway });
  else addLog({ type: 'error', message: `❌ Gagal Kirim Langsung ke ${nama || nomor}: ${result.error}`, detailMessage: finalMsg, recipient: { nama: nama || nomor, nomor }, gateway: result.gateway });
  res.json({ success: result.success, error: result.error, data: result.data });
});

// POST /api/send-now
router.post('/send-now', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.fonnteToken) return res.json({ success: false, error: 'Token Fonnte belum diset.' });
  const template = req.body.message || cfg.message;
  const result   = await sendToAllRecipients(cfg.fonnteToken, template, cfg.waNumber || null, cfg);
  addLog({ type: result.success ? 'sent' : 'error', message: result.success ? `✅ WA terkirim ke ${result.successCount}/${result.totalCount} guru` : `❌ Gagal: ${result.error || ''}`, detailMessage: template, detail: result.results });
  res.json(result);
});

// POST /api/check-and-send
router.post('/check-and-send', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const checkResult = await checkAttendance(session.cookie);
  if (!checkResult.success) return res.json({ success: false, error: checkResult.error });
  const { data } = checkResult;
  const cfg = loadConfig();
  let sendResult = null;
  if (!data.hasAbsenPagi) {
    if (!cfg.fonnteToken) return res.json({ success: true, attendance: data, waSent: false, notAbsent: true, error: 'Token Fonnte belum diset.' });
    sendResult = await sendToAllRecipients(cfg.fonnteToken, cfg.message, cfg.waNumber || null, cfg);
    addLog({ type: sendResult.success ? 'sent' : 'error', message: sendResult.success ? `✅ WA terkirim ke ${sendResult.successCount}/${sendResult.totalCount} guru` : '❌ Gagal kirim WA', detailMessage: cfg.message, detail: sendResult.results });
  }
  res.json({ success: true, attendance: data, waSent: !!sendResult?.success, sendResult, notAbsent: !data.hasAbsenPagi });
});

// Recipients CRUD
router.get('/recipients', async (req, res) => {
  try {
    let query = supabase.from('recipients').select('*, schools(name)');
    if (req.userRole !== 'super_admin') query = query.eq('school_id', req.schoolId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/recipients', async (req, res) => {
  const { nama, nomor, school_id, is_external, sekolah_asal } = req.body;
  if (!nama || !nomor) return res.json({ success: false, error: 'Nama dan nomor WA diperlukan.' });
  const clean = String(nomor).replace(/[^0-9]/g, '');
  const targetSchoolId = req.userRole === 'super_admin' ? (school_id || null) : req.schoolId;
  if (!targetSchoolId) return res.json({ success: false, error: 'Asal sekolah tidak diketahui.' });
  const isExt = !!is_external;
  try {
    const { data: existing } = await supabase.from('recipients').select('id').eq('nomor', clean).eq('school_id', targetSchoolId).limit(1);
    if (existing && existing.length > 0) return res.json({ success: false, error: 'Nomor WhatsApp sudah terdaftar di sekolah ini.' });
    const { data, error } = await supabase.from('recipients').insert({ nama: nama.trim(), nomor: clean, aktif: true, school_id: targetSchoolId, is_external: isExt, sekolah_asal: isExt ? (sekolah_asal ? sekolah_asal.trim() : null) : null }).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

router.put('/recipients/:id', async (req, res) => {
  const targetId = req.params.id;
  try {
    if (req.userRole !== 'super_admin') { const { data: existing } = await supabase.from('recipients').select('school_id').eq('id', targetId).single(); if (!existing || existing.school_id !== req.schoolId) return res.json({ success: false, error: 'Penerima tidak ditemukan atau akses ditolak.' }); }
    const updates = {};
    if (req.body.nama) updates.nama = req.body.nama.trim();
    if (req.body.nomor) updates.nomor = String(req.body.nomor).replace(/[^0-9]/g, '');
    if (req.body.aktif !== undefined) updates.aktif = !!req.body.aktif;
    if (req.body.is_external !== undefined) { updates.is_external = !!req.body.is_external; updates.sekolah_asal = updates.is_external ? (req.body.sekolah_asal ? req.body.sekolah_asal.trim() : null) : null; }
    else if (req.body.sekolah_asal !== undefined) updates.sekolah_asal = req.body.sekolah_asal ? req.body.sekolah_asal.trim() : null;
    const { data, error } = await supabase.from('recipients').update(updates).eq('id', targetId).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

router.delete('/recipients/:id', async (req, res) => {
  try {
    if (req.userRole !== 'super_admin') { const { data: existing } = await supabase.from('recipients').select('school_id').eq('id', req.params.id).single(); if (!existing || existing.school_id !== req.schoolId) return res.json({ success: false, error: 'Penerima tidak ditemukan atau akses ditolak.' }); }
    const { error } = await supabase.from('recipients').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

router.delete('/recipients', async (req, res) => {
  try {
    let query = supabase.from('recipients').delete();
    if (req.userRole !== 'super_admin') query = query.eq('school_id', req.schoolId);
    else { if (!req.query.school_id) return res.json({ success: false, error: 'Tentukan school_id.' }); query = query.eq('school_id', req.query.school_id); }
    const { error } = await query;
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// POST /api/recipients/import
router.post('/recipients/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'File tidak ditemukan.' });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.json({ success: false, error: 'File Excel kosong.' });
    const keys    = Object.keys(rows[0]);
    const noIdxRe = /^(no|no\.|no_urut|nomor urut)$/i;
    let namaKey   = keys.find(k => /nama/i.test(k)) || keys.find(k => !noIdxRe.test(k.trim()) && !/nip/i.test(k)) || keys[0];
    let nomorKey  = keys.find(k => /whatsapp|wa|hp|handphone|ponsel|telepon|telp|phone/i.test(k)) || keys.find(k => /nomor|kontak/i.test(k) && !noIdxRe.test(k.trim())) || keys[keys.length - 1];
    let asalSekolahKey = keys.find(k => /asal sekolah|sekolah/i.test(k));
    let allSchools = [];
    if (req.userRole === 'super_admin' && asalSekolahKey) { const { data } = await supabase.from('schools').select('id, name'); if (data) allSchools = data; }
    const added = [], updated = [], skipped = [];
    const { data: existingRecords } = await (req.userRole !== 'super_admin' ? supabase.from('recipients').select('*').eq('school_id', req.schoolId) : supabase.from('recipients').select('*'));
    const existing = existingRecords || [];
    for (const row of rows) {
      const rawNama = String(row[namaKey] || '').trim();
      let rawNomor  = String(row[nomorKey] || '').replace(/[^0-9]/g, '');
      if (rawNomor.startsWith('8')) rawNomor = '0' + rawNomor;
      else if (rawNomor.startsWith('628')) rawNomor = '08' + rawNomor.slice(3);
      if (!rawNama || !rawNomor || rawNomor.length < 9) { skipped.push({ nama: rawNama, nomor: rawNomor, reason: 'Nomor WA kosong atau kurang dari 9 digit' }); continue; }
      let targetSchoolId = req.schoolId;
      if (req.userRole === 'super_admin' && asalSekolahKey && row[asalSekolahKey]) { const rawAsal = String(row[asalSekolahKey]).trim().toLowerCase(); const matched = allSchools.find(s => s.name.toLowerCase() === rawAsal); if (matched) targetSchoolId = matched.id; }
      if (!targetSchoolId) { skipped.push({ nama: rawNama, nomor: rawNomor, reason: 'Asal Sekolah tidak dikenali / Akses ditolak' }); continue; }
      const cleanRawName = rawNama.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existingRecord = existing.find(r => { const cleanExName = (r.nama || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return (r.nomor === rawNomor || cleanExName === cleanRawName) && r.school_id === targetSchoolId; });
      if (existingRecord) { await supabase.from('recipients').update({ nama: rawNama, nomor: rawNomor, aktif: true }).eq('id', existingRecord.id); updated.push(existingRecord); }
      else { await supabase.from('recipients').insert({ nama: rawNama, nomor: rawNomor, aktif: true, school_id: targetSchoolId }); added.push({ nama: rawNama, nomor: rawNomor }); }
    }
    addLog({ type: 'info', message: `📥 Import Excel: ${added.length} baru, ${updated.length} diperbarui (${skipped.length} dilewati)` });
    res.json({ success: true, added: added.length + updated.length, newAdded: added.length, updated: updated.length, skipped: skipped.length });
  } catch (err) { res.json({ success: false, error: `Gagal baca Excel: ${err.message}` }); }
});

module.exports = router;
