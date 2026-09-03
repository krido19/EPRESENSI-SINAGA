'use strict';
const fs   = require('fs');
const cron = require('node-cron');

const {
  loadConfig, CONFIG_FILE,
  DEF_MSG_PAGI, DEF_MSG_PAGI_SUDAH, DEF_MSG_SIANG, DEF_MSG_SIANG_SUDAH,
  DEF_MSG_PULANG, DEF_MSG_PULANG_SUDAH, DEF_MSG,
  DEF_MSG_EXTERNAL_PAGI, DEF_MSG_EXTERNAL_SIANG, DEF_MSG_EXTERNAL_PULANG,
  DEF_MSG_REKAP_MINGGUAN, DEF_MSG_REKAP_BULANAN
} = require('./config');
const { supabase }                             = require('./supabase');
const { addLog, logNotificationToSupabase }    = require('./logger');
const { sendWhatsAppWithRetry, getWaState }    = require('./whatsapp');
const { ensureTenantSession, fetchColleaguesAttendance } = require('./epresensi');

// ─── Telegram Notifier (baca dari notification_logs Supabase) ─────────────────
async function notifyTelegramFromLog(type, schoolName, schoolId) {
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const adminId = process.env.TELEGRAM_ADMIN_ID;
  if (!token || !adminId) return;
  try {
    // Ambil log 5 menit terakhir untuk sekolah ini
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let q = supabase
      .from('notification_logs')
      .select('nama, nomor, status, type, created_at')
      .eq('type', type)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (schoolId && schoolId !== 'local') q = q.eq('school_id', schoolId);
    const { data: logs, error } = await q;
    if (error || !logs || logs.length === 0) return; // tidak ada log → skip

    const sent   = logs.filter(l => l.status === 'sent');
    const failed = logs.filter(l => l.status !== 'sent');

    const TYPE_LABEL = {
      pagi:           '🌅 Pagi',
      siang:          '☀️ Siang',
      pulang:         '🌆 Pulang',
      rekap_mingguan: '📊 Rekap Mingguan',
      rekap_bulanan:  '📅 Rekap Bulanan',
    };
    const wib    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const jamWIB = `${String(wib.getHours()).padStart(2,'0')}:${String(wib.getMinutes()).padStart(2,'0')}`;

    let msg = `<b>📋 ePresensi — ${TYPE_LABEL[type] || type} ${jamWIB} WIB</b>\n`;
    msg    += `<b>🏫 ${schoolName}</b>\n\n`;

    if (sent.length > 0) {
      msg += `✅ <b>Terkirim (${sent.length}):</b>\n`;
      msg += sent.map(l => `  • ${l.nama}`).join('\n') + '\n';
    }
    if (failed.length > 0) {
      msg += `\n❌ <b>Gagal (${failed.length}):</b>\n`;
      msg += failed.map(l => `  • ${l.nama}`).join('\n') + '\n';
    }

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: adminId, text: msg, parse_mode: 'HTML' })
    });
    console.log(`[TG Notify] Laporan ${type} terkirim ke Telegram (${sent.length} sent, ${failed.length} failed).`);
  } catch (e) {
    console.error('[TG Notify] Gagal kirim ke Telegram:', e.message);
  }
}

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
      data.sort((a, b) => (a.schools?.name || '').localeCompare(b.schools?.name || '')); // SMK 1 sebelum SMK 3
      schoolsCache       = data;
      schoolsCacheExpiry = Date.now() + 60_000; // cache 1 menit (bukan 5) agar perubahan Supabase cepat aktif
      if (Date.now() - schoolsCacheLastLog > 60_000) {
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
    // ── Jadwal khusus Jumat (pulang lebih awal) ──
    jumatPulangEnabled: row.jumat_pulang_enabled ?? loc.jumatPulangEnabled ?? true,
    jumatPulangHour:    row.jumat_pulang_hour    ?? loc.jumatPulangHour    ?? 14,
    jumatPulangMinute:  row.jumat_pulang_minute  ?? loc.jumatPulangMinute  ?? 0,
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
      const allColleagues = colleaguesRes.colleagues; // seluruh data termasuk Libur/Izin
      const targets_raw = allColleagues.filter(c => !c.status.includes('Libur'));
      let q = supabase.from('recipients').select('*').eq('aktif', true);
      const validSchoolId = config && config.schoolId && config.schoolId !== 'local' ? config.schoolId : null;
      if (validSchoolId) q = q.eq('school_id', validSchoolId);
      const { data } = await q;
      const registered = data || [];

      // ── STEP 1: Loop dari ePresensi → cocokkan ke registered (logika asal) ──
      for (const guru of targets_raw) {
        const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
        const found = registered.find(r => { const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, ''); return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru); });
        if (found && found.nomor) targets.push({ nama: guru.nama, nomor: found.nomor, isHadir: type === 'pagi' ? guru.isHadir : (type === 'siang' ? !!guru.jamSiang : !!guru.jamPulang) });
      }

      // ── STEP 2: Tambah guru yang TIDAK ADA di ePresensi sama sekali ──
      // (bukan sedang Libur/Izin, tapi memang tidak punya akun ePresensi)
      for (const r of registered) {
        if (r.is_external) continue; // Eksternal ditangani terpisah
        if (targets.some(t => t.nomor === r.nomor)) continue; // Sudah diproses Step 1
        const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isInEpresensi = allColleagues.some(c => {
          const cleanC = c.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanC.includes(cleanR) || cleanR.includes(cleanC);
        });
        if (isInEpresensi) continue; // Ada di ePresensi (Libur/Izin/dll) — tidak dikirim
        // Tidak ada di ePresensi → kirim pengingat absen
        targets.push({ nama: r.nama, nomor: r.nomor, isHadir: false });
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
    if (error) {
      // Supabase API/JWT error — bukan data kosong
      console.error(`[Scheduler] ❌ Supabase ERROR (bukan data kosong): ${error.message} | code: ${error.code} | school: ${config.namaSekolah}`);
      addLog({ type: 'error', message: `${labelWaktu}: Gagal query penerima dari Supabase (${error.code || error.message}). Kemungkinan issue JWT/API Supabase.`, school: config.namaSekolah });
    }
    const allRecipients = data || [];
    if (allRecipients.length === 0) {
      const reason = error ? 'Query Supabase gagal (JWT/API error)' : `Tidak ada data di tabel recipients untuk school_id=${validSchoolId || 'semua'}`;
      console.warn(`[Scheduler] ⚠️ Recipients nol untuk ${config.namaSekolah}. Alasan: ${reason}`);
      addLog({ type: 'warning', message: `${labelWaktu}: Tidak ada penerima WA. ${reason}.`, school: config.namaSekolah });
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

  // Kirim laporan ke Telegram (baca dari notification_logs)
  // Pakai await langsung — setTimeout bisa mati saat Baileys crash (SMK 3 issue)
  const _schoolId = config?.schoolId || null;
  const _school   = config?.namaSekolah || 'Semua Sekolah';
  await notifyTelegramFromLog(type, _school, _schoolId).catch(() => {});

  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
}

// ─── buildWeeklyRekapMessage ──────────────────────────────────────────────────
function buildWeeklyRekapMessage(target, template) {
  const STATUS_EMOJI = { 'Hadir': '✅', 'Terlambat': '⏰', 'Belum Absen': '❌', 'Sakit': '🤒', 'Izin': '📋', 'Cuti': '🏖️', 'Dinas Luar': '🚗', 'Tugas Luar': '🚗', 'Libur (OFF)': '🏖️', 'Libur (Hari Besar Nasional)': '🎉', 'Belum Jadwal': '⏳' };
  if (target.isExternal) return `Halo ${target.nama}! 👋\n\n📊 *REKAP MINGGU INI*\nPengingat rekap absensi minggu ini untuk ${target.sekolahAsal || 'Sekolah Anda'}.\nSilakan cek sistem absensi sekolah Anda.\n\nE-PRESENSI SINAGA`;
  const history = target.history || [], weekDays = target.weekDays || [];
  let totalHadir = 0, totalHariKerja = 0;
  const lines = [];
  for (const wd of weekDays) {
    const tglStr = String(wd.tanggal).padStart(2,'0') + '/' + String(wd.bulan).padStart(2,'0');
    const entry = history.find(h => h.tanggal === wd.tanggal);
    
    if (!entry) {
      lines.push('• ' + wd.hari.padEnd(7,' ') + ' ' + tglStr + ' ⏳ Belum Ada Data');
      totalHariKerja++; // Asumsikan hari kerja kecuali kalau besok ternyata libur, tapi defaultnya hari kerja
      continue;
    }
    
    if (entry.isWeekend) continue;
    
    const emoji = STATUS_EMOJI[entry.status] || '❓';
    const isLibur = entry.status.startsWith('Libur');
    const statusShort = entry.status === 'Libur (Hari Besar Nasional)' ? 'Libur Nasional' : entry.status;
    let jamInfo = '';
    // Tampilkan jam untuk Hadir DAN Terlambat (keduanya isHadir=true)
    if ((entry.isHadir || entry.status === 'Terlambat') && entry.jamMasuk && entry.jamMasuk !== '-') {
      jamInfo = ' (' + entry.jamMasuk;
      if (entry.jamPulang && entry.jamPulang !== '-') jamInfo += '–' + entry.jamPulang;
      jamInfo += ')';
    }
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
async function runWeeklyRekapLogic(cfg, isTest = false) {
  const labelWaktu = '📊 Rekap Mingguan' + (isTest ? ' (Test)' : '');
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const dayOfWeek = wib.getDay();
  
  let daysToTargetFriday;
  if (isTest) {
    const adjustedDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    daysToTargetFriday = adjustedDay - 5;
  } else {
    daysToTargetFriday = (dayOfWeek + 1) % 7 + 1;
  }

  const weekDays = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(wib);
    d.setDate(wib.getDate() - (daysToTargetFriday + i));
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

  // Kirim laporan ke Telegram (baca dari notification_logs)
  // Pakai await langsung — setTimeout bisa mati saat Baileys crash
  await notifyTelegramFromLog('rekap_mingguan', cfg.namaSekolah, cfg.schoolId || null).catch(() => {});

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

// ─── buildMonthlyRekapMessage ─────────────────────────────────────────────────
function buildMonthlyRekapMessage(target, template, monthName, year) {
  const STATUS_EMOJI = { 'Hadir': '✅', 'Terlambat': '⏰', 'Belum Absen': '❌', 'Sakit': '🤒', 'Izin': '📋', 'Cuti': '🏖️', 'Dinas Luar': '🚗', 'Tugas Luar': '🚗', 'Libur (OFF)': '🏖️', 'Libur (Hari Besar Nasional)': '🎉', 'Belum Jadwal': '⏳' };
  if (target.isExternal) {
    return `Halo ${target.nama}! 👋\n\n📊 *REKAP BULAN ${monthName} ${year}*\nPengingat rekap absensi bulan ini untuk ${target.sekolahAsal || 'Sekolah Anda'}.\nSilakan cek sistem absensi sekolah Anda.\n\nE-PRESENSI SINAGA`;
  }
  const history = target.history || [];
  let totalHadir = 0, totalHariKerja = 0;
  const lines = [];
  for (const entry of history) {
    if (entry.isWeekend) continue;
    const tglStr   = String(entry.tanggal).padStart(2,'0') + '/' + String(entry.bulan).padStart(2,'0');
    const isLibur  = entry.status && entry.status.startsWith('Libur');
    if (isLibur) {
      lines.push(`• ${entry.hari.padEnd(7,' ')} ${tglStr} 🎉 ${entry.status === 'Libur (Hari Besar Nasional)' ? 'Libur Nasional' : entry.status}`);
      continue;
    }
    totalHariKerja++;
    const emoji = STATUS_EMOJI[entry.status] || '❓';
    let jamInfo = '';
    if ((entry.isHadir || entry.status === 'Terlambat') && entry.jamMasuk && entry.jamMasuk !== '-') {
      jamInfo = ' (' + entry.jamMasuk;
      if (entry.jamPulang && entry.jamPulang !== '-') jamInfo += '–' + entry.jamPulang;
      jamInfo += ')';
    }
    lines.push(`• ${entry.hari.padEnd(7,' ')} ${tglStr} ${emoji} ${entry.status || 'Belum Ada Data'}${jamInfo}`);
    if (entry.isHadir) totalHadir++;
  }
  if (lines.length === 0) lines.push('(Tidak ada data hari kerja bulan ini)');
  return template
    .replace(/\{nama\}/gi, target.nama)
    .replace(/\{nama_bulan\}/gi, monthName)
    .replace(/\{tahun\}/gi, String(year))
    .replace(/\{detail_hari\}/gi, lines.join('\n'))
    .replace(/\{total_hadir\}/gi, String(totalHadir))
    .replace(/\{total_hari_kerja\}/gi, String(totalHariKerja));
}

// ─── runMonthlyRekapLogic ─────────────────────────────────────────────────────
async function runMonthlyRekapLogic(cfg, isTest = false) {
  const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const labelWaktu = '📅 Rekap Bulanan' + (isTest ? ' (Test)' : '');
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

  // Selalu rekap bulan SEBELUMNYA — bulan berjalan belum memiliki data lengkap
  const prevDate    = new Date(wib.getFullYear(), wib.getMonth() - 1, 1);
  const targetMonth = prevDate.getMonth() + 1;
  const targetYear  = prevDate.getFullYear();
  const monthName   = MONTH_NAMES[targetMonth - 1];
  const startDate   = `${targetYear}-${String(targetMonth).padStart(2,'0')}-01`;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const endDate     = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

  addLog({ type: 'info', message: `${labelWaktu}: Memulai rekap ${monthName} ${targetYear} untuk ${cfg.namaSekolah}…`, school: cfg.namaSekolah });
  console.log(`[MonthlyRekap] ${cfg.namaSekolah}: ${startDate} s/d ${endDate}`);

  const validSchoolId = cfg.schoolId && cfg.schoolId !== 'local' ? cfg.schoolId : null;

  let qRecords = supabase.from('attendance_records').select('*').gte('tanggal', startDate).lte('tanggal', endDate);
  if (validSchoolId) qRecords = qRecords.eq('school_id', validSchoolId);
  else               qRecords = qRecords.is('school_id', null);
  const { data: recordsData, error } = await qRecords;
  if (error || !recordsData) {
    addLog({ type: 'warning', message: `${labelWaktu}: Gagal ambil data Supabase (${error?.message || 'unknown'}).`, school: cfg.namaSekolah });
    return { success: false, error: 'Database error' };
  }

  let q = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', false);
  if (validSchoolId) q = q.eq('school_id', validSchoolId);
  const { data: recipientsData } = await q;
  const registered = recipientsData || [];

  const targets = [];
  for (const r of registered) {
    const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
    const teacherRecords = recordsData.filter(rec => {
      const cleanGuru = rec.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru);
    });
    // Bangun history harian lengkap
    const history = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj   = new Date(targetYear, targetMonth - 1, d);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const tglStr    = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const rec       = teacherRecords.find(r2 => r2.tanggal === tglStr);
      history.push({
        tanggal:   d,
        bulan:     targetMonth,
        hari:      DAYS[dateObj.getDay()],
        isWeekend,
        status:    rec?.status    || (isWeekend ? 'Libur (OFF)' : 'Belum Ada Data'),
        isHadir:   rec ? (rec.status.toLowerCase().includes('hadir') || rec.status === 'Terlambat') : false,
        jamMasuk:  rec?.jam_masuk  || null,
        jamPulang: rec?.jam_pulang || null,
      });
    }
    targets.push({ nama: r.nama, nomor: r.nomor, history });
  }

  // Penerima eksternal
  let qExt = supabase.from('recipients').select('*').eq('aktif', true).eq('is_external', true);
  if (validSchoolId) qExt = qExt.eq('school_id', validSchoolId);
  const { data: extData } = await qExt;
  for (const ext of (extData || [])) {
    if (!targets.some(t => t.nomor === ext.nomor)) {
      targets.push({ nama: ext.nama, nomor: ext.nomor, history: [], isExternal: true, sekolahAsal: ext.sekolah_asal || 'Sekolah Anda' });
    }
  }

  if (targets.length === 0) {
    addLog({ type: 'info', message: `${labelWaktu}: Tidak ada penerima terdaftar.`, school: cfg.namaSekolah });
    return { success: true, sent: 0, total: 0, message: 'Tidak ada penerima.' };
  }

  const msgTemplate = cfg.messageRekapBulanan || DEF_MSG_REKAP_BULANAN;
  let sentCount = 0;
  const logsArr = [];
  for (const t of targets) {
    const msg  = buildMonthlyRekapMessage(t, msgTemplate, monthName, targetYear);
    const sRes = await sendWhatsAppWithRetry(t.nomor, msg, cfg.fonnteToken || null);
    if (sRes.success) { sentCount++; logsArr.push({ nama: t.nama, nomor: t.nomor, text: msg }); }
    logNotificationToSupabase({ school_id: cfg.schoolId || null, type: 'rekap_bulanan', nama: t.nama, nomor: t.nomor, status: sRes.success ? 'sent' : 'failed', error_msg: sRes.success ? null : (sRes.error || 'unknown'), gateway: sRes.gateway || 'baileys', message: msg });
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
  }
  const summaryMsg = `${labelWaktu}: Rekap ${monthName} ${targetYear} terkirim ke ${sentCount}/${targets.length} penerima (${cfg.namaSekolah}).`;
  addLog({ type: sentCount > 0 ? 'sent' : 'error', message: summaryMsg, targets: logsArr, school: cfg.namaSekolah });

  // Kirim laporan ke Telegram (baca dari notification_logs)
  // Pakai await langsung — setTimeout bisa mati saat Baileys crash
  await notifyTelegramFromLog('rekap_bulanan', cfg.namaSekolah, cfg.schoolId || null).catch(() => {});

  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
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

      // ── Rekap Bulanan Otomatis — tanggal 1 setiap bulan jam 07:00 WIB ──
      if (wib.getDate() === 1 && H === 7 && M === 10) {
        console.log(`[Scheduler 📅 Rekap Bulanan] Tanggal 1 — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
        for (const schoolRow of schools) {
          const bulananCfg = buildTenantCfg(schoolRow);
          runMonthlyRekapLogic(bulananCfg, false).catch(e => console.error(`[Scheduler] Rekap Bulanan error (${bulananCfg.namaSekolah}):`, e.message));
        }
      }

      // Sequential per sekolah — hindari race condition WA/cookie
      for (let i = 0; i < schools.length; i++) {
        const row = schools[i];
        const cfg = buildTenantCfg(row);
        let didRun = false;
        try {
          if (H === 22 && M === 0) {
            console.log(`[Scheduler 💾 Harian] ${cfg.namaSekolah} - 22:00 WIB`);
            await runDailyArchiverLogic(cfg);
            didRun = true;
          }
          if (H === cfg.pagiHour && M === cfg.pagiMinute) {
            console.log(`[Scheduler 🌅 Pagi] ${cfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
            await runSchedulerLogic('pagi', cfg);
            didRun = true;
          }
          if (cfg.schedulerSiangEnabled !== false && H === cfg.siangHour && M === cfg.siangMinute) {
            console.log(`[Scheduler ☀️ Siang] ${cfg.namaSekolah}`);
            await runSchedulerLogic('siang', cfg);
            didRun = true;
          }
          if (H === cfg.pulangHour && M === cfg.pulangMinute) {
            console.log(`[Scheduler 🌆 Pulang] ${cfg.namaSekolah}`);
            await runSchedulerLogic('pulang', cfg);
            didRun = true;
          }
          // ── Pengingat pulang khusus Jumat (jam 14:00 default) ──
          if (cfg.jumatPulangEnabled !== false && dayOfWeek === 5 && H === cfg.jumatPulangHour && M === cfg.jumatPulangMinute) {
            console.log(`[Scheduler 🕌 Jumat Pulang] ${cfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
            await runSchedulerLogic('pulang', cfg);
            didRun = true;
          }
          // Jeda antar sekolah — beri waktu Baileys flush signal sessions
          if (didRun && i < schools.length - 1) {
            console.log(`[Scheduler] ⏳ Jeda 2 detik sebelum sekolah berikutnya...`);
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (schoolErr) {
          console.error(`[Scheduler] Error pada ${cfg.namaSekolah}: ${schoolErr.message}`);
          // lanjut ke sekolah berikutnya
        }
      }

    } finally { schedulerRunning = false; }
  });
  console.log('[Scheduler] Master Multi-Tenant Cron aktif (setiap 1 menit, cache Supabase 5 menit)');
}

// ─── invalidateSchoolsCache ───────────────────────────────────────────────────
// Dipanggil saat config/jadwal diupdate agar scheduler langsung ambil data baru
function invalidateSchoolsCache() {
  schoolsCache       = null;
  schoolsCacheExpiry = 0;
  console.log('[Scheduler] Cache sekolah di-reset — akan ambil data baru dari Supabase.');
}

module.exports = {
  getActiveSchools, buildTenantCfg, setupScheduler,
  runSchedulerLogic, runWeeklyRekapLogic, runMonthlyRekapLogic,
  runBackfillLogic, runDailyArchiverLogic,
  buildWeeklyRekapMessage, buildMonthlyRekapMessage, invalidateSchoolsCache
};
