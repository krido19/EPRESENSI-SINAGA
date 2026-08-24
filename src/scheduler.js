'use strict';
const fs   = require('fs');
const cron = require('node-cron');

const {
  loadConfig, CONFIG_FILE,
  DEF_MSG_PAGI, DEF_MSG_PAGI_SUDAH, DEF_MSG_SIANG, DEF_MSG_SIANG_SUDAH,
  DEF_MSG_PULANG, DEF_MSG_PULANG_SUDAH, DEF_MSG,
  DEF_MSG_EXTERNAL_PAGI, DEF_MSG_EXTERNAL_SIANG, DEF_MSG_EXTERNAL_PULANG,
  DEF_MSG_REKAP_MINGGUAN
} = require('./config');
const { supabase }                             = require('./supabase');
const { addLog, logNotificationToSupabase }    = require('./logger');
const { sendWhatsAppWithRetry, getWaState }    = require('./whatsapp');
const { ensureTenantSession, fetchColleaguesAttendance } = require('./epresensi');

// ─── Scheduler State ──────────────────────────────────────────────────────────
let masterCron          = null;
let schedulerRunning    = false;
let schoolsCache        = null;
let schoolsCacheExpiry  = 0;
let schoolsCacheLastLog = 0;

// ─── getActiveSchools ─────────────────────────────────────────────────────────
async function getActiveSchools() {
  if (schoolsCache && Date.now() < schoolsCacheExpiry) return schoolsCache;
  try {
    const { data, error } = await supabase
      .from('school_configs')
      .select(`
        scheduler_enabled, scheduler_siang_enabled, pagi_hour, pagi_minute, siang_hour, siang_minute, pulang_hour, pulang_minute,
        message_pagi, message_pagi_sudah, message_siang, message_siang_sudah, message_pulang, message_pulang_sudah,
        message_external_pagi, message_external_siang, message_external_pulang,
        school_id,
        schools!inner(id, name, epresensi_username, epresensi_password, fonnte_token, wa_gateway, unit_code, opd_code, plan)
      `)
      .eq('scheduler_enabled', true);

    if (!error && data && data.length > 0) {
      schoolsCache       = data;
      schoolsCacheExpiry = Date.now() + 5 * 60_000;
      if (Date.now() - schoolsCacheLastLog > 4 * 60_000) {
        console.log(`[Scheduler] Loaded ${data.length} sekolah dari Supabase: ${data.map(r => r.schools?.name).join(', ')}`);
        schoolsCacheLastLog = Date.now();
      }
      return data;
    }
    if (error) console.error('[Scheduler] Error query school_configs:', error.message);
    else console.warn('[Scheduler] school_configs kosong, fallback ke config lokal');
  } catch(e) {
    console.error('[Scheduler] Gagal ambil data sekolah dari Supabase:', e.message);
  }

  // Fallback: config.json lokal
  const localCfg = loadConfig();
  if (localCfg.username && localCfg.schedulerEnabled) {
    return [{
      scheduler_enabled: localCfg.schedulerEnabled,
      pagi_hour: localCfg.pagiHour, pagi_minute: localCfg.pagiMinute,
      pulang_hour: localCfg.pulangHour, pulang_minute: localCfg.pulangMinute,
      message_pagi: localCfg.messagePagi, message_pagi_sudah: localCfg.messagePagiSudah,
      message_pulang: localCfg.messagePulang, message_pulang_sudah: localCfg.messagePulangSudah,
      schools: { ...localCfg, id: 'local' }
    }];
  }
  return [];
}

// ─── buildTenantCfg ───────────────────────────────────────────────────────────
function buildTenantCfg(row) {
  const s   = row.schools;
  const loc = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { return {}; } })();
  return {
    username:              s.epresensi_username || loc.username    || '',
    password:              s.epresensi_password || loc.password    || '',
    cookie:                loc.cookie           || '',
    cookieExpiry:          loc.cookieExpiry     || null,
    fonnteToken:           s.fonnte_token       || loc.fonnteToken || '',
    waGateway:             s.wa_gateway         || loc.waGateway   || 'baileys',
    waNumber:              s.wa_number          || loc.waNumber    || '',
    unitCode:              s.unit_code          || loc.unitCode    || 'F208007700',
    opdCode:               s.opd_code           || loc.opdCode     || 'F200000000',
    namaSekolah:           s.name               || loc.namaSekolah || '',
    schoolId:              s.id,
    plan:                  s.plan || 'free',
    authMode:              loc.authMode || 'auto',
    schedulerEnabled:          true,
    schedulerPagiEnabled:      true,
    schedulerSiangEnabled:     row.scheduler_siang_enabled ?? loc.schedulerSiangEnabled ?? true,
    schedulerPulangEnabled:    true,
    pagiHour:    row.pagi_hour    ?? 7,
    pagiMinute:  row.pagi_minute  ?? 30,
    siangHour:   row.siang_hour   ?? loc.siangHour  ?? 15,
    siangMinute: row.siang_minute ?? loc.siangMinute ?? 30,
    pulangHour:  row.pulang_hour  ?? 18,
    pulangMinute: row.pulang_minute ?? 0,
    messagePagi:           row.message_pagi         || loc.messagePagi         || DEF_MSG_PAGI,
    messagePagiSudah:      row.message_pagi_sudah   || loc.messagePagiSudah    || DEF_MSG_PAGI_SUDAH,
    messageSiang:          row.message_siang        || loc.messageSiang        || DEF_MSG_SIANG,
    messageSiangSudah:     row.message_siang_sudah  || loc.messageSiangSudah   || DEF_MSG_SIANG_SUDAH,
    messagePulang:         row.message_pulang       || loc.messagePulang       || DEF_MSG_PULANG,
    messagePulangSudah:    row.message_pulang_sudah || loc.messagePulangSudah  || DEF_MSG_PULANG_SUDAH,
    message:               loc.message || DEF_MSG,
    messageExternalPagi:   row.message_external_pagi   || loc.messageExternalPagi   || DEF_MSG_EXTERNAL_PAGI,
    messageExternalSiang:  row.message_external_siang  || loc.messageExternalSiang  || DEF_MSG_EXTERNAL_SIANG,
    messageExternalPulang: row.message_external_pulang || loc.messageExternalPulang || DEF_MSG_EXTERNAL_PULANG,
    messageRekapMingguan:  loc.messageRekapMingguan || DEF_MSG_REKAP_MINGGUAN,
    waAdminNumber:         loc.waAdminNumber || '',
  };
}

// ─── runSchedulerLogic ────────────────────────────────────────────────────────
async function runSchedulerLogic(type = 'pagi', cfg = null) {
  const config  = cfg || loadConfig();
  const { waSock, waConnectionStatus } = getWaState();
  const gateway = config.waGateway || 'baileys';
  if (gateway !== 'fonnte' && !waSock) throw new Error('WhatsApp Web belum terhubung. Scan QR Code terlebih dahulu.');
  if (gateway === 'fonnte' && !config.fonnteToken) throw new Error('Token Fonnte belum dikonfigurasi.');

  const labelWaktu = type === 'pagi' ? '🌅 Pagi' : type === 'siang' ? '☀️ Siang' : '🌇 Pulang';
  let targets = [];

  const session = await ensureTenantSession(config);
  if (session.success) {
    const day = new Date().getDate();
    const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day, null, null, true, 0, config);
    if (colleaguesRes.success) {
      const targets_raw = colleaguesRes.colleagues.filter(c => !c.status.includes('Libur'));
      let q = supabase.from('recipients').select('*').eq('aktif', true);
      const validSchoolId = config && config.schoolId && config.schoolId !== 'local' ? config.schoolId : null;
      if (validSchoolId) q = q.eq('school_id', validSchoolId);
      const { data } = await q;
      const registered = data || [];
      for (const guru of targets_raw) {
        const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
        const found = registered.find(r => { const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, ''); return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru); });
        if (found && found.nomor) targets.push({ nama: guru.nama, nomor: found.nomor, isHadir: type === 'pagi' ? guru.isHadir : (type === 'siang' ? !!guru.jamSiang : !!guru.jamPulang) });
      }
      addLog({ type: 'info', message: `${labelWaktu}: Mode normal (ePresensi) — ${targets.length} target ditemukan.`, school: config.namaSekolah });
    } else { session.success = false; }
  }

  if (!session.success || targets.length === 0) {
    addLog({ type: 'warning', message: `${labelWaktu}: Tidak bisa cek ePresensi — fallback ke mode kirim semua penerima.`, school: config.namaSekolah });
    let q = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', false);
    const validSchoolId = config.schoolId && config.schoolId !== 'local' ? config.schoolId : null;
    console.log(`[Scheduler DEBUG] schoolId saat query: ${validSchoolId || 'semua sekolah'} (sekolah: ${config.namaSekolah})`);
    if (validSchoolId) q = q.eq('school_id', validSchoolId);
    const { data, error } = await q;
    if (error) console.error('[Scheduler] Error query recipients:', error.message);
    const allRecipients = data || [];
    if (allRecipients.length === 0) {
      console.warn(`[Scheduler] ⚠️ Tabel 'recipients' kosong untuk school_id=${config.schoolId || 'semua'}.`);
      addLog({ type: 'warning', message: `${labelWaktu}: Tidak ada penerima WA terdaftar.`, school: config.namaSekolah });
    } else {
      targets = allRecipients.map(r => ({ nama: r.nama, nomor: r.nomor, isHadir: false, isExternal: false }));
    }
  }

  // Penerima eksternal
  try {
    const validSchoolIdExt = config.schoolId && config.schoolId !== 'local' ? config.schoolId : null;
    let qExt = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', true);
    if (validSchoolIdExt) qExt = qExt.eq('school_id', validSchoolIdExt);
    const { data: extData, error: extErr } = await qExt;
    if (extErr) console.error('[Scheduler] Error query penerima eksternal:', extErr.message);
    else if (extData && extData.length > 0) {
      for (const ext of extData) {
        if (!targets.some(t => t.nomor === ext.nomor)) targets.push({ nama: ext.nama, nomor: ext.nomor, isHadir: false, isExternal: true, sekolahAsal: ext.sekolah_asal || 'Sekolah Anda' });
      }
      addLog({ type: 'info', message: `${labelWaktu}: +${extData.length} penerima eksternal ditambahkan.`, school: config.namaSekolah });
    }
  } catch (extErr) { console.error('[Scheduler] Gagal query penerima eksternal:', extErr.message); }

  if (targets.length === 0) {
    const msg = `${labelWaktu}: Tidak ada guru target.`;
    addLog({ type: 'info', message: msg, school: config.namaSekolah });
    return { success: true, sent: 0, total: 0, message: msg };
  }

  let sentCount = 0;
  const logsArr = [];
  for (const t of targets) {
    let template = '';
    if (t.isExternal) {
      if (type === 'pagi') template = config.messageExternalPagi || DEF_MSG_EXTERNAL_PAGI;
      else if (type === 'siang') template = config.messageExternalSiang || DEF_MSG_EXTERNAL_SIANG;
      else template = config.messageExternalPulang || DEF_MSG_EXTERNAL_PULANG;
    } else {
      if (type === 'pagi')       template = t.isHadir ? (config.messagePagiSudah || DEF_MSG_PAGI_SUDAH)     : (config.messagePagi   || DEF_MSG_PAGI);
      else if (type === 'siang') template = t.isHadir ? (config.messageSiangSudah || DEF_MSG_SIANG_SUDAH)   : (config.messageSiang  || DEF_MSG_SIANG);
      else                       template = t.isHadir ? (config.messagePulangSudah || DEF_MSG_PULANG_SUDAH) : (config.messagePulang || DEF_MSG_PULANG);
    }
    const msg  = template.replace(/\{nama\}/gi, t.nama).replace(/\{sekolah_asal\}/gi, t.sekolahAsal || '');
    const sRes = await sendWhatsAppWithRetry(t.nomor, msg, config.fonnteToken || null);
    if (sRes.success) { sentCount++; logsArr.push({ nama: t.nama, nomor: t.nomor, text: msg }); }
    logNotificationToSupabase({ school_id: config.schoolId || null, type, nama: t.nama, nomor: t.nomor, status: sRes.success ? 'sent' : 'failed', error_msg: sRes.success ? null : (sRes.error || 'unknown'), gateway: sRes.gateway || 'baileys', message: msg });
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
  }

  const summaryMsg = `${labelWaktu}: Notifikasi WA terkirim ke ${sentCount}/${targets.length} guru.`;
  addLog({ type: sentCount > 0 ? 'sent' : 'error', message: summaryMsg, targets: logsArr });
  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
}

// ─── buildWeeklyRekapMessage ──────────────────────────────────────────────────
function buildWeeklyRekapMessage(target, template) {
  const STATUS_EMOJI = { 'Hadir': '✅', 'Belum Absen': '❌', 'Sakit': '🤒', 'Izin': '📋', 'Cuti': '🏖️', 'Dinas Luar': '🚗', 'Tugas Luar': '🚗', 'Libur (OFF)': '🏖️', 'Libur (Hari Besar Nasional)': '🎉', 'Belum Jadwal': '⏳' };
  if (target.isExternal) return `Halo ${target.nama}! 👋\n\n📊 *REKAP MINGGU INI*\nPengingat rekap absensi minggu ini untuk ${target.sekolahAsal || 'Sekolah Anda'}.\nSilakan cek sistem absensi sekolah Anda.\n\nE-PRESENSI SINAGA`;
  const history = target.history || [], weekDays = target.weekDays || [];
  let totalHadir = 0, totalHariKerja = 0;
  const lines = [];
  for (const wd of weekDays) {
    const entry = history.find(h => h.tanggal === wd.tanggal);
    if (!entry || entry.isWeekend) continue;
    const emoji = STATUS_EMOJI[entry.status] || '❓';
    const isLibur = entry.status.startsWith('Libur');
    const statusShort = entry.status === 'Libur (Hari Besar Nasional)' ? 'Libur Nasional' : entry.status;
    const tglStr = String(wd.tanggal).padStart(2,'0') + '/' + String(wd.bulan).padStart(2,'0');
    let jamInfo = '';
    if (entry.isHadir && entry.jamMasuk && entry.jamMasuk !== '-') { jamInfo = ' (' + entry.jamMasuk; if (entry.jamPulang && entry.jamPulang !== '-') jamInfo += '–' + entry.jamPulang; jamInfo += ')'; }
    lines.push('• ' + wd.hari.padEnd(7,' ') + ' ' + tglStr + ' ' + emoji + ' ' + statusShort + jamInfo);
    if (entry.isHadir) totalHadir++;
    if (!isLibur) totalHariKerja++;
  }
  if (lines.length === 0) lines.push('(Tidak ada data hari kerja minggu ini)');
  const firstDay = weekDays[0], lastDay = weekDays[weekDays.length - 1];
  const tanggalMulai   = firstDay.hari + ' ' + String(firstDay.tanggal).padStart(2,'0') + '/' + String(firstDay.bulan).padStart(2,'0');
  const tanggalSelesai = lastDay.hari  + ' ' + String(lastDay.tanggal).padStart(2,'0')  + '/' + String(lastDay.bulan).padStart(2,'0');
  return template.replace(/\{nama\}/gi, target.nama).replace(/\{tanggal_mulai\}/gi, tanggalMulai).replace(/\{tanggal_selesai\}/gi, tanggalSelesai).replace(/\{detail_hari\}/gi, lines.join('\n')).replace(/\{total_hadir\}/gi, String(totalHadir)).replace(/\{total_hari_kerja\}/gi, String(totalHariKerja));
}

// ─── runWeeklyRekapLogic ──────────────────────────────────────────────────────
async function runWeeklyRekapLogic(cfg) {
  const labelWaktu = '📊 Rekap Mingguan';
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const dayOfWeek = wib.getDay();
  const daysToLastFriday = (dayOfWeek + 1) % 7 + 1;
  const weekDays = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(wib);
    d.setDate(wib.getDate() - (daysToLastFriday + i));
    weekDays.push({ tanggal: d.getDate(), bulan: d.getMonth() + 1, tahun: d.getFullYear(), hari: ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()] });
  }
  addLog({ type: 'info', message: `${labelWaktu}: Memulai pengiriman rekap ${cfg.namaSekolah}…`, school: cfg.namaSekolah });
  const validSchoolId = cfg.schoolId && cfg.schoolId !== 'local' ? cfg.schoolId : null;
  const startDate = `${weekDays[0].tahun}-${String(weekDays[0].bulan).padStart(2,'0')}-${String(weekDays[0].tanggal).padStart(2,'0')}`;
  const endDate   = `${weekDays[4].tahun}-${String(weekDays[4].bulan).padStart(2,'0')}-${String(weekDays[4].tanggal).padStart(2,'0')}`;
  console.log(`[WeeklyRekap] ${cfg.namaSekolah}: rentang ${startDate} s/d ${endDate}`);
  let qRecords = supabase.from('attendance_records').select('*').gte('tanggal', startDate).lte('tanggal', endDate);
  if (validSchoolId) qRecords = qRecords.eq('school_id', validSchoolId); else qRecords = qRecords.is('school_id', null);
  const { data: recordsData, error } = await qRecords;
  if (error || !recordsData) { addLog({ type: 'warning', message: `${labelWaktu}: Gagal mengambil data dari database (${error?.message || 'unknown error'}).`, school: cfg.namaSekolah }); return { success: false, error: 'Database error' }; }
  let q = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', false);
  if (validSchoolId) q = q.eq('school_id', validSchoolId);
  const { data: recipientsData } = await q;
  const registered = recipientsData || [];
  const targets = [];
  for (const r of registered) {
    const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
    const teacherRecords = recordsData.filter(rec => { const cleanGuru = rec.nama.toLowerCase().replace(/[^a-z0-9]/g, ''); return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru); });
    if (teacherRecords.length > 0) {
      const history = teacherRecords.map(rec => ({ tanggal: parseInt(rec.tanggal.split('-')[2], 10), status: rec.status, isWeekend: false, isHadir: rec.status.toLowerCase().includes('hadir'), jamMasuk: rec.jam_masuk, jamPulang: rec.jam_pulang }));
      targets.push({ nama: r.nama, nomor: r.nomor, history, weekDays });
    }
  }
  let qExt = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', true);
  if (validSchoolId) qExt = qExt.eq('school_id', validSchoolId);
  const { data: extData } = await qExt;
  for (const ext of (extData || [])) { if (!targets.some(t => t.nomor === ext.nomor)) targets.push({ nama: ext.nama, nomor: ext.nomor, weekDays, isExternal: true, sekolahAsal: ext.sekolah_asal || 'Sekolah Anda' }); }
  if (targets.length === 0) { addLog({ type: 'info', message: `${labelWaktu}: Tidak ada penerima terdaftar.`, school: cfg.namaSekolah }); return { success: true, sent: 0, total: 0, message: 'Tidak ada penerima.' }; }
  const msgTemplate = cfg.messageRekapMingguan || DEF_MSG_REKAP_MINGGUAN;
  let sentCount = 0;
  const logsArr = [];
  for (const t of targets) {
    const msg  = buildWeeklyRekapMessage(t, msgTemplate);
    const sRes = await sendWhatsAppWithRetry(t.nomor, msg, cfg.fonnteToken || null);
    if (sRes.success) { sentCount++; logsArr.push({ nama: t.nama, nomor: t.nomor, text: msg }); }
    logNotificationToSupabase({ school_id: cfg.schoolId || null, type: 'rekap_mingguan', nama: t.nama, nomor: t.nomor, status: sRes.success ? 'sent' : 'failed', error_msg: sRes.success ? null : (sRes.error || 'unknown'), gateway: sRes.gateway || 'baileys', message: msg });
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
  }
  const summaryMsg = `${labelWaktu}: Rekap terkirim ke ${sentCount}/${targets.length} penerima (${cfg.namaSekolah}).`;
  addLog({ type: sentCount > 0 ? 'sent' : 'error', message: summaryMsg, targets: logsArr, school: cfg.namaSekolah });
  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
}

// ─── runBackfillLogic ─────────────────────────────────────────────────────────
async function runBackfillLogic(cfg, targetDate) {
  if (!targetDate) return { success: false, error: 'Tanggal backfill tidak disertakan.' };
  const d = new Date(targetDate);
  if (isNaN(d.getTime())) return { success: false, error: 'Format tanggal tidak valid.' };
  const tDay = d.getDate(), tMonth = d.getMonth() + 1, tYear = d.getFullYear();
  const tglSql = `${tYear}-${String(tMonth).padStart(2,'0')}-${String(tDay).padStart(2,'0')}`;
  const session = await ensureTenantSession(cfg);
  if (!session.success) return { success: false, error: session.error };
  const validSchoolId = cfg && cfg.schoolId && cfg.schoolId !== 'local' ? cfg.schoolId : null;
  let inserted = 0;
  console.log(`[Backfill] Menarik data tanggal ${tglSql}...`);
  const res = await fetchColleaguesAttendance(session.cookie, tDay, tMonth, tYear, true, 0, cfg);
  if (!res.success) return { success: false, error: `Gagal tarik data ${tglSql}: ${res.error}` };
  const colleagues = res.colleagues || [];
  for (const c of colleagues) {
    if (c.status.toLowerCase().includes('libur')) continue;
    const payload = { nip: c.nip, nama: c.nama, tanggal: tglSql, status: c.status, jam_masuk: c.jamMasuk, jam_pulang: c.jamPulang };
    if (validSchoolId) payload.school_id = validSchoolId;
    let qCheck = supabase.from('attendance_records').select('id').eq('nip', c.nip).eq('tanggal', tglSql);
    if (validSchoolId) qCheck = qCheck.eq('school_id', validSchoolId); else qCheck = qCheck.is('school_id', null);
    const { data: existing, error: errCheck } = await qCheck.single();
    if (errCheck && errCheck.code !== 'PGRST116') console.error(`[Backfill] Supabase check error untuk ${c.nip}:`, errCheck.message);
    if (existing) { const { error: errUpdate } = await supabase.from('attendance_records').update(payload).eq('id', existing.id); if (errUpdate) console.error(`[Backfill] update error:`, errUpdate.message); else inserted++; }
    else { const { error: errInsert } = await supabase.from('attendance_records').insert([payload]); if (errInsert) console.error(`[Backfill] insert error:`, errInsert.message); else inserted++; }
  }
  return { success: true, message: `Backfill ${tglSql} selesai. ${inserted} data berhasil disimpan.` };
}

// ─── runDailyArchiverLogic ────────────────────────────────────────────────────
async function runDailyArchiverLogic(cfg) {
  const labelWaktu = '💾 Arsip Harian';
  const wib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const targetDay = wib.getDate(), targetMonth = wib.getMonth() + 1, targetYear = wib.getFullYear();
  const tanggalSql = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
  addLog({ type: 'info', message: `${labelWaktu}: Mengambil data presensi hari ini untuk ${cfg.namaSekolah}.`, school: cfg.namaSekolah });
  const session = await ensureTenantSession(cfg);
  if (!session.success) { addLog({ type: 'warning', message: `${labelWaktu}: Gagal koneksi ePresensi.`, school: cfg.namaSekolah }); return { success: false, error: session.error }; }
  const colleaguesRes = await fetchColleaguesAttendance(session.cookie, targetDay, targetMonth, targetYear, true, 0, cfg);
  if (!colleaguesRes.success) { addLog({ type: 'warning', message: `${labelWaktu}: Gagal ambil data ePresensi.`, school: cfg.namaSekolah }); return { success: false, error: colleaguesRes.error }; }
  const colleagues = colleaguesRes.colleagues || [];
  if (colleagues.length === 0) return { success: true, message: 'Tidak ada data presensi (kosong)' };
  const validSchoolId = cfg && cfg.schoolId && cfg.schoolId !== 'local' ? cfg.schoolId : null;
  let inserted = 0;
  for (const c of colleagues) {
    if (c.status.toLowerCase().includes('libur')) continue;
    const payload = { nip: c.nip, nama: c.nama, tanggal: tanggalSql, status: c.status, jam_masuk: c.jamMasuk, jam_pulang: c.jamPulang };
    if (validSchoolId) payload.school_id = validSchoolId;
    let qCheck = supabase.from('attendance_records').select('id').eq('nip', c.nip).eq('tanggal', tanggalSql);
    if (validSchoolId) qCheck = qCheck.eq('school_id', validSchoolId); else qCheck = qCheck.is('school_id', null);
    const { data: existing } = await qCheck.single();
    if (existing) { await supabase.from('attendance_records').update(payload).eq('id', existing.id); inserted++; }
    else { const { error } = await supabase.from('attendance_records').insert([payload]); if (!error) inserted++; }
  }
  addLog({ type: 'success', message: `${labelWaktu}: Berhasil mengarsipkan ${inserted} data guru.`, school: cfg.namaSekolah });
  return { success: true, message: `Berhasil mengarsipkan ${inserted} data guru.` };
}

// ─── setupScheduler ───────────────────────────────────────────────────────────
function setupScheduler() {
  if (masterCron) { masterCron.stop(); masterCron = null; console.log('[Scheduler] Cron lama dihentikan, memulai ulang...'); }
  masterCron = cron.schedule('* * * * *', async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const now = new Date();
      const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const H = wib.getHours(), M = wib.getMinutes(), dayOfWeek = wib.getDay();
      if (dayOfWeek === 0) return;
      if (dayOfWeek === 6) {
        const satSchools = await getActiveSchools();
        for (const satRow of satSchools) {
          const satCfg = buildTenantCfg(satRow);
          if (H === satCfg.pagiHour && M === satCfg.pagiMinute) {
            console.log(`[Scheduler 📊 Rekap Mingguan] ${satCfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
            runWeeklyRekapLogic(satCfg).catch(e => console.error(`[Scheduler] Rekap Mingguan error (${satCfg.namaSekolah}):`, e.message));
          }
        }
        return;
      }
      const schools = await getActiveSchools();
      if (!schools.length) return;
      for (const row of schools) {
        const cfg = buildTenantCfg(row);
        if (H === 22 && M === 0) { console.log(`[Scheduler 💾 Harian] ${cfg.namaSekolah} - 22:00 WIB`); runDailyArchiverLogic(cfg).catch(e => console.error(`[Scheduler] Archiver error (${cfg.namaSekolah}):`, e.message)); }
        if (H === cfg.pagiHour && M === cfg.pagiMinute) { console.log(`[Scheduler 🌅 Pagi] ${cfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`); runSchedulerLogic('pagi', cfg).catch(e => console.error(`[Scheduler] Pagi error (${cfg.namaSekolah}):`, e.message)); }
        if (cfg.schedulerSiangEnabled !== false && H === cfg.siangHour && M === cfg.siangMinute) { console.log(`[Scheduler ☀️ Siang] ${cfg.namaSekolah}`); runSchedulerLogic('siang', cfg).catch(e => console.error(`[Scheduler] Siang error:`, e.message)); }
        if (H === cfg.pulangHour && M === cfg.pulangMinute) { console.log(`[Scheduler 🌆 Pulang] ${cfg.namaSekolah}`); runSchedulerLogic('pulang', cfg).catch(e => console.error(`[Scheduler] Pulang error:`, e.message)); }
      }
    } finally { schedulerRunning = false; }
  });
  console.log('[Scheduler] Master Multi-Tenant Cron aktif (setiap 1 menit, cache Supabase 5 menit)');
}

module.exports = {
  getActiveSchools, buildTenantCfg, setupScheduler,
  runSchedulerLogic, runWeeklyRekapLogic,
  runBackfillLogic, runDailyArchiverLogic,
  buildWeeklyRekapMessage
};
