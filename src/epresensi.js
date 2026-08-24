'use strict';
const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const { loadConfig, saveConfig } = require('./config');
const { addLog }                 = require('./logger');
const { sendWhatsApp }           = require('./whatsapp');

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_URL    = 'https://presensi.bkd.jatengprov.go.id';
const HEADERS_BASE = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding':           'gzip, deflate, br',
  'Connection':                'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'same-origin',
  'Sec-Fetch-User':            '?1',
  'Sec-CH-UA':                 '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
  'Sec-CH-UA-Mobile':          '?0',
  'Sec-CH-UA-Platform':        '"Windows"',
  'Cache-Control':             'max-age=0',
};

// ─── State ────────────────────────────────────────────────────────────────────
const tenantSessions   = {};
const failedAuthNotified = new Map();
const CACHE_TTL_MS     = 30 * 60 * 1000;
let   colleagueCache   = {};

// ─── fetchLoginPage ───────────────────────────────────────────────────────────
async function fetchLoginPage() {
  const res  = await fetch(`${BASE_URL}/v3/`, { headers: HEADERS_BASE, redirect: 'follow' });
  const html = await res.text();
  const setCookieHeader = res.headers.raw()['set-cookie'] || [];
  const cookies = setCookieHeader.map(c => c.split(';')[0]).join('; ');

  const $ = cheerio.load(html);
  const satuVal = $('input[name="satu"]').val();
  const duaVal  = $('input[name="dua"]').val();

  const satuMatch = html.match(/name=['"]satu['"][^>]*value=['"](\d+)['"]/) || html.match(/value=['"](\d+)['"][^>]*name=['"]satu['"]/);
  const duaMatch  = html.match(/name=['"]dua['"][^>]*value=['"](\d+)['"]/)  || html.match(/value=['"](\d+)['"][^>]*name=['"]dua['"]/);

  const satu = satuVal ? parseInt(satuVal) : (satuMatch ? parseInt(satuMatch[1]) : 2);
  const dua  = duaVal  ? parseInt(duaVal)  : (duaMatch  ? parseInt(duaMatch[1])  : 3);

  return { html, cookies, satu, dua };
}

// ─── detectSchoolProfile ──────────────────────────────────────────────────────
async function detectSchoolProfile(cookie) {
  try {
    const res = await fetch(`${BASE_URL}/v3/data_v4`, { headers: { ...HEADERS_BASE, Cookie: cookie } });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    let nama = '', nip = '', namaSekolah = 'SMKN 3 MAGELANG';
    $('tr').each((_, el) => {
      const text = $(el).text();
      if (/Nama Lengkap/i.test(text)) nama = $(el).find('td').last().text().replace(/^:\s*/, '').trim();
      else if (/NIP/i.test(text)) { const m = $(el).find('td').last().text().match(/(\d{18})/); if (m) nip = m[1]; }
      else if (/Unit Kerja/i.test(text)) namaSekolah = $(el).find('td').last().text().replace(/^:\s*/, '').trim() || 'SMKN 3 MAGELANG';
    });
    return {
      nama, nip, namaSekolah: namaSekolah || 'SMKN 3 MAGELANG',
      opdCode:  String($('input[name="opd"]').val()  || 'F200000000').trim(),
      unitCode: String($('input[name="unit"]').val() || 'F208007700').trim()
    };
  } catch (e) {
    console.error('Error detectSchoolProfile:', e);
    return null;
  }
}

// ─── saveSessionAndReturn ─────────────────────────────────────────────────────
async function saveSessionAndReturn(username, cookies) {
  const expiry = new Date(); expiry.setHours(expiry.getHours() + 8);
  const cfg = loadConfig();
  cfg.cookie = cookies; cfg.cookieExpiry = expiry.toISOString();
  const profile = await detectSchoolProfile(cookies);
  if (profile) {
    cfg.namaSekolah = profile.namaSekolah || cfg.namaSekolah || 'SMKN 3 MAGELANG';
    cfg.unitCode    = profile.unitCode    || cfg.unitCode    || 'F208007700';
    cfg.opdCode     = profile.opdCode     || cfg.opdCode     || 'F200000000';
    cfg.namaUser    = profile.nama        || cfg.namaUser    || '';
    if (!cfg.accounts) cfg.accounts = [];
    const accIdx = cfg.accounts.findIndex(a => a.username === username);
    const accData = { id: username, username, password: cfg.password || '', namaUser: profile.nama || username, namaSekolah: profile.namaSekolah || 'Unit Sekolah', unitCode: profile.unitCode || 'F208007700', opdCode: profile.opdCode || 'F200000000', lastLogin: new Date().toISOString() };
    if (accIdx >= 0) cfg.accounts[accIdx] = { ...cfg.accounts[accIdx], ...accData };
    else cfg.accounts.push(accData);
  }
  saveConfig(cfg);
  colleagueCache = {};
  addLog({ type: 'info', message: `✅ Login berhasil sebagai ${username} (${cfg.namaSekolah || 'Sekolah'})` });
  console.log(`[Auth] ✅ Login berhasil! Sekolah: ${cfg.namaSekolah || '-'}`);
  return { success: true, cookie: cookies, expiry: expiry.toISOString(), profile };
}

// ─── doLogin ──────────────────────────────────────────────────────────────────
async function doLogin(username, password) {
  try {
    console.log(`[Auth] Login sebagai: ${username}`);
    const { html: loginHtml, cookies: initCookies, satu, dua } = await fetchLoginPage();
    if (!loginHtml.includes('username') && !loginHtml.includes('password'))
      return { success: false, error: 'Halaman login tidak dapat diakses.' };
    const jawaban  = satu + dua;
    const formData = new URLSearchParams();
    formData.append('username', username); formData.append('password', password);
    formData.append('satu', String(satu)); formData.append('dua', String(dua)); formData.append('jawaban', String(jawaban));
    const loginRes = await fetch(`${BASE_URL}/v3/portal/auth`, { method: 'POST', headers: { ...HEADERS_BASE, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': initCookies, 'Referer': `${BASE_URL}/v3/`, 'Origin': BASE_URL }, body: formData.toString(), redirect: 'manual' });
    const status   = loginRes.status;
    const location = loginRes.headers.get('location') || '';
    const setCookies     = loginRes.headers.raw()['set-cookie'] || [];
    const sessionCookies = setCookies.map(c => c.split(';')[0]).join('; ');
    const allCookies     = [initCookies, sessionCookies].filter(Boolean).join('; ');
    if (status === 301 || status === 302 || status === 303 || status === 307) {
      const verifyRes = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: allCookies }, redirect: 'manual' });
      if (verifyRes.status === 200) return await saveSessionAndReturn(username, allCookies);
      const finalUrl    = location.startsWith('http') ? location : `${BASE_URL}${location}`;
      const followRes   = await fetch(finalUrl, { headers: { ...HEADERS_BASE, Cookie: allCookies }, redirect: 'manual' });
      const followCookies = (followRes.headers.raw()['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const finalCookies  = [allCookies, followCookies].filter(Boolean).join('; ');
      if (followRes.status === 200 || followRes.status === 302) return await saveSessionAndReturn(username, finalCookies);
      return { success: false, error: `Login gagal (status ${followRes.status})` };
    }
    if (status === 200) {
      const respHtml = await loginRes.text();
      if (respHtml.includes('portal/auth') || respHtml.includes('name="password"')) {
        const errMatch = respHtml.match(/class="alert[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        return { success: false, error: errMatch ? errMatch[1].replace(/<[^>]+>/g,'').trim() : 'Username atau password salah.' };
      }
      return await saveSessionAndReturn(username, allCookies);
    }
    return { success: false, error: `Login gagal HTTP ${status}` };
  } catch (err) {
    return { success: false, error: `Koneksi gagal: ${err.message}` };
  }
}

// ─── ensureTenantSession ──────────────────────────────────────────────────────
async function ensureTenantSession(cfg, forceFresh = false) {
  const schoolId = cfg.schoolId;
  if (!schoolId) return await ensureValidSession(forceFresh);
  let session = tenantSessions[schoolId];
  if (session && !forceFresh) {
    const isExpired = new Date() > new Date(session.expiry);
    if (!isExpired) {
      try {
        const res = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: session.cookie }, redirect: 'manual' });
        if (res.status === 200) { const bodyHtml = await res.text(); if (!bodyHtml.includes('portal/auth')) return { success: true, cookie: session.cookie }; }
      } catch(e) {}
    }
  }
  if (!cfg.username || !cfg.password) return { success: false, error: 'Username/password belum diset untuk tenant ini.' };
  try {
    const { cookies: initCookies, satu, dua } = await fetchLoginPage();
    const jawaban  = satu + dua;
    const formData = new URLSearchParams({ username: cfg.username, password: cfg.password, satu, dua, jawaban });
    const loginRes = await fetch(`${BASE_URL}/v3/portal/auth`, { method: 'POST', headers: { ...HEADERS_BASE, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': initCookies }, body: formData.toString(), redirect: 'manual' });
    const status = loginRes.status;
    const setCookies = loginRes.headers.raw()['set-cookie'] || [];
    const sessionCookies = setCookies.map(c => c.split(';')[0]).join('; ');
    const allCookies = [initCookies, sessionCookies].filter(Boolean).join('; ');
    if (status === 301 || status === 302 || status === 303 || status === 307) {
      const verifyRes = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: allCookies }, redirect: 'manual' });
      if (verifyRes.status === 200) {
        const expiry = new Date(); expiry.setHours(expiry.getHours() + 8);
        tenantSessions[schoolId] = { cookie: allCookies, expiry: expiry.toISOString() };
        return { success: true, cookie: allCookies };
      }
    }
    // Gagal login — kirim notif 1x/24 jam
    const now = Date.now();
    const lastNotified = failedAuthNotified.get(schoolId) || 0;
    if (now - lastNotified > 24 * 60 * 60 * 1000) {
      failedAuthNotified.set(schoolId, now);
      const globalCfg = loadConfig();
      const waTarget  = globalCfg.waAdminNumber || '085868733378';
      const msg = `🚨 *Peringatan Sistem ePresensi*\n\nGagal menarik data presensi untuk sekolah *${cfg.namaSekolah || 'SaaS Tenant'}*.\nKemungkinan password ePresensi telah diubah atau kredensial salah.\n\nMohon segera koordinasi dengan admin sekolah terkait untuk memperbarui password di Dashboard Epresensi Sinaga.`;
      if (globalCfg.fonnteToken) sendWhatsApp(globalCfg.fonnteToken, waTarget, msg).catch(e => console.error('[Alert] Gagal kirim WA ke SuperAdmin:', e));
    }
    return { success: false, error: `Login ePresensi gagal (HTTP ${status})` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── ensureValidSession ───────────────────────────────────────────────────────
async function ensureValidSession(forceFresh = false) {
  const config = loadConfig();
  if (config.authMode === 'manual') {
    if (!config.cookie) return { success: false, error: 'Cookie belum diset.' };
    return { success: true, cookie: config.cookie };
  }
  if (config.cookie && !forceFresh) {
    const isExpired = config.cookieExpiry && new Date() > new Date(config.cookieExpiry);
    if (!isExpired) {
      try {
        const res = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: config.cookie }, redirect: 'manual' });
        if (res.status === 200) { const bodyHtml = await res.text(); if (!bodyHtml.includes('portal/auth') && !bodyHtml.includes('name="password"') && !bodyHtml.includes('name="jawaban"')) return { success: true, cookie: config.cookie }; }
      } catch(e) {}
    }
    addLog({ type: 'info', message: '🔄 Sesi ePresensi kedaluwarsa, melakukan re-login otomatis...' });
  }
  if (!config.username || !config.password) return { success: false, error: 'Username/password belum diset.' };
  return await doLogin(config.username, config.password);
}

// ─── checkAttendance ──────────────────────────────────────────────────────────
async function checkAttendance(cookie) {
  try {
    const response = await fetch(`${BASE_URL}/v3/rekap/saya`, { headers: { ...HEADERS_BASE, Cookie: cookie, Referer: `${BASE_URL}/v3/dashboard` }, redirect: 'manual' });
    if (response.status === 302 || response.status === 301 || response.status === 303) return { success: false, error: 'Session expired.', sessionExpired: true };
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const html = await response.text();
    if (html.includes('login') && html.includes('password') && !html.includes('rekap')) return { success: false, error: 'Session expired.', sessionExpired: true };
    return { success: true, data: parseAttendanceHTML(html) };
  } catch (err) {
    return { success: false, error: `Gagal cek presensi: ${err.message}` };
  }
}

// ─── parseAttendanceHTML ──────────────────────────────────────────────────────
function parseAttendanceHTML(html) {
  const today  = new Date();
  const dayOfMonth = today.getDate();
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const result = { date: `${dayOfMonth} ${months[today.getMonth()]} ${today.getFullYear()}`, hasAbsenPagi: false, hasAbsenPulang: false, status: 'Belum Absen', jamMasuk: null, jamPulang: null, rawIndicators: {} };
  const $ = cheerio.load(html);
  const rows = $('tbody tr');
  if (rows.length === 0) { result.status = 'Tidak Ada Baris'; return result; }
  const targetRow = rows.eq(dayOfMonth - 1).length ? rows.eq(dayOfMonth - 1) : rows.first();
  const cols = [];
  targetRow.find('th, td').each((_, el) => cols.push($(el).text().trim()));
  const rawTanggal = cols[0] || '', rawMasuk = cols[1] || '-', rawPulang = cols[2] || '-', rawStatus = (cols[3] || '').trim().toUpperCase();
  const jamMasukMatch = rawMasuk.match(/^(\d{2}:\d{2})/);
  if (jamMasukMatch && rawMasuk !== '-') { result.jamMasuk = jamMasukMatch[1]; result.hasAbsenPagi = true; result.status = 'Hadir'; } else { result.hasAbsenPagi = false; }
  const jamPulangMatch = rawPulang.match(/^(\d{2}:\d{2})/);
  if (jamPulangMatch && rawPulang !== '-') { result.jamPulang = jamPulangMatch[1]; result.hasAbsenPulang = true; }
  if (result.hasAbsenPagi) result.status = 'Hadir';
  else if (rawStatus === 'I') result.status = 'Izin';
  else if (rawStatus === 'S') result.status = 'Sakit';
  else if (rawStatus === 'A') result.status = 'Belum Absen (Alpha)';
  else if (!rawTanggal && rawMasuk === '-' && rawPulang === '-') result.status = 'Libur / Akhir Pekan';
  else result.status = 'Belum Absen';
  result.rawIndicators = { dayOfMonth, targetRowIdx: dayOfMonth - 1, totalRows: rows.length, rawTanggal, rawMasuk, rawPulang, rawStatus, cols };
  return result;
}

// ─── fetchColleaguesAttendance ────────────────────────────────────────────────
async function fetchColleaguesAttendance(cookie, targetDay = null, targetMonth = null, targetYear = null, forceRefresh = false, retryCount = 0, cfg = null) {
  const currentCfg = cfg || loadConfig();
  const now   = new Date();
  const day   = targetDay   ? parseInt(targetDay)   : now.getDate();
  const month = targetMonth ? String(targetMonth).padStart(2,'0') : String(now.getMonth() + 1).padStart(2,'0');
  const year  = targetYear  ? String(targetYear)  : String(now.getFullYear());
  const opdCode  = currentCfg.opdCode  || 'F200000000';
  const unitCode = currentCfg.unitCode || 'F208007700';
  const cacheKey = `${unitCode}_${year}-${month}-${day}`;

  if (!forceRefresh && colleagueCache[cacheKey]) {
    const isFresh = (Date.now() - colleagueCache[cacheKey].timestamp) < CACHE_TTL_MS;
    if (isFresh) return { ...colleagueCache[cacheKey].data, fromCache: true, cachedAt: new Date(colleagueCache[cacheKey].timestamp).toISOString() };
  }

  const formData = new URLSearchParams();
  formData.append('opd', opdCode); formData.append('unit', unitCode);
  formData.append('rl', '100'); formData.append('bulan', month); formData.append('tahun', year); formData.append('nip', '');

  let res;
  try {
    res = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
      method: 'POST',
      headers: { ...HEADERS_BASE, 'Cookie': cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${BASE_URL}/v3/data_v4`, 'Origin': BASE_URL, 'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' },
      body: formData.toString()
    });
  } catch (err) {
    return { success: false, error: `Koneksi gagal: ${err.message}` };
  }

  if (!res.ok) {
    if ((res.status === 301 || res.status === 302 || res.status === 401 || res.status === 403) && retryCount === 0) {
      console.log('[Colleagues] Sesi ePresensi expired (HTTP ' + res.status + '), mencoba re-login...');
      const fresh = await ensureValidSession(true);
      if (fresh.success && fresh.cookie) return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
    }
    return { success: false, error: `HTTP ${res.status} dari portal ePresensi` };
  }

  const html = await res.text();
  const isLoginPage = html.includes('name="password"') || html.includes('portal/auth') || html.includes('name="jawaban"');
  if (isLoginPage && retryCount === 0) {
    console.log('[Colleagues] Sesi ePresensi expired (halaman login terdeteksi), mencoba re-login otomatis...');
    const fresh = await ensureValidSession(true);
    if (fresh.success && fresh.cookie) return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
  }

  const $ = cheerio.load(html);
  const tables = $('table');
  let targetTable = null, maxRows = 0;
  tables.each((_, tbl) => { const rowCount = $(tbl).find('tr').length; if (rowCount > maxRows) { maxRows = rowCount; targetTable = $(tbl); } });

  if (!targetTable || maxRows < 2) {
    if (retryCount === 0) {
      console.log('[Colleagues] Tabel data belum ditemukan, mencoba re-login...');
      const fresh = await ensureValidSession(true);
      if (fresh.success && fresh.cookie) return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
    }
    return { success: false, error: 'Tabel data unit kerja tidak ditemukan. Pastikan akun ePresensi aktif dan memiliki hak akses OPD/Unit sekolah.' };
  }

  const rows      = targetTable.find('tr');
  const colleagues = [];
  const dateObj   = new Date(parseInt(year), parseInt(month) - 1, day);
  const dayNames  = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const namaHari  = dayNames[dateObj.getDay()];
  const isWeekend = (namaHari === 'Sabtu' || namaHari === 'Minggu');
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

  rows.each((i, rowEl) => {
    if (i === 0) return;
    const cells = $(rowEl).find('td');
    if (cells.length < 2) return;
    const rowHtml = $(rowEl).html() || '';
    const rowText = $(rowEl).text();

    let nip = '', nama = '', nipCellIdx = -1;
    for (let ci = 0; ci <= Math.min(4, cells.length - 1); ci++) {
      const cellText = cells.eq(ci).text().replace(/'/g, '').trim();
      const nipM = cellText.match(/(\d{18})/);
      if (nipM) {
        nip = nipM[1]; nipCellIdx = ci;
        const sameCell = cellText.replace(nip, '').replace(/[:\s]+/g, ' ').trim();
        if (sameCell && sameCell.length > 2) nama = sameCell;
        else if (ci + 1 < cells.length) nama = cells.eq(ci + 1).text().replace(/[:\s]+/g, ' ').trim();
        break;
      }
    }
    if (!nip) { const globalNip = rowText.match(/(\d{18})/); if (!globalNip) return; nip = globalNip[1]; }
    if (!nama) {
      for (let ci = 0; ci < cells.length; ci++) {
        if (ci === nipCellIdx) continue;
        const t = cells.eq(ci).text().replace(/[:\s]+/g, ' ').trim();
        if (t && t.length > 3 && /[A-Za-z]/.test(t) && !/^\d+$/.test(t)) { nama = t; break; }
      }
    }

    const no = cells.eq(0).text().trim();
    const history = [];
    let totalHadir = 0, totalIzin = 0, totalSakit = 0, totalBelum = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = String(d).padStart(2, '0');
      const curDateISO  = `${year}-${month}-${dStr}`;
      const curDateObj  = new Date(parseInt(year), parseInt(month) - 1, d);
      const curDayName  = dayNames[curDateObj.getDay()];
      const isCurWeekend = (curDayName === 'Sabtu' || curDayName === 'Minggu');
      const tsRegex   = new RegExp(`${curDateISO}[^"]*?\\s+(\\d{2}:\\d{2})(?::\\d{2})?`, 'g');
      const matches   = [...rowHtml.matchAll(tsRegex)].map(m => m[1]);
      const attrRegex = new RegExp(`(?:title|data-[^=]*)=["'][^"']*${curDateISO}[^"']*?(\\d{2}:\\d{2})`, 'gi');
      const attrMatches = [...rowHtml.matchAll(attrRegex)].map(m => m[1]);
      const allMatches  = [...new Set([...matches, ...attrMatches])].filter(Boolean);
      let curJamMasuk = '-', curJamPulang = '-', curIsHadir = false;
      let curStatus = isCurWeekend ? 'Libur (OFF)' : (d > now.getDate() && parseInt(month) === (now.getMonth() + 1) ? 'Belum Jadwal' : 'Belum Absen');
      if (allMatches.length > 0) { allMatches.sort(); curJamMasuk = allMatches[0]; curJamPulang = allMatches.length > 1 ? allMatches[allMatches.length - 1] : '-'; }
      const id1 = `${year}${month}_${nip}-s_${dStr}`, id2 = `${year}${month}_${nip}-s_${d}`;
      const id3 = `${year}${month}_${nip}_s_${dStr}`, id4 = `${year}${month}_${nip}_s_${d}`;
      let code = null;
      for (const sid of [id1, id2, id3, id4]) {
        const esc = sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = rowHtml.match(new RegExp(`id=["']${esc}["'][^>]*value=["']([^"']+)["']`, 'i')) || rowHtml.match(new RegExp(`value=["']([^"']+)["'][^>]*id=["']${esc}["']`, 'i'));
        if (m) { code = m[1].toUpperCase(); break; }
      }
      if (code) {
        if (['H','T','TAM','TAP','TAPT','HB'].includes(code)) { curStatus = (code === 'T' || code === 'TAM' || code === 'TAPT') ? 'Terlambat' : 'Hadir'; curIsHadir = true; totalHadir++; }
        else if (code === 'HBN') curStatus = 'Libur (Hari Besar Nasional)';
        else if (code === 'CS' || code === 'S') { curStatus = 'Sakit'; totalSakit++; }
        else if (code.startsWith('C') || code === 'I' || code === 'DL' || code === 'TL') { if (code === 'DL') curStatus = 'Dinas Luar'; else if (code === 'TL') curStatus = 'Tugas Luar'; else if (code === 'I') curStatus = 'Izin'; else curStatus = 'Cuti'; totalIzin++; }
        else if (code === 'OFF') curStatus = 'Libur (OFF)';
        else if (code === 'A' || code === 'HAPUS' || code === 'TK') { curStatus = 'Belum Absen'; if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) totalBelum++; }
        else curStatus = `Unknown: ${code}`;
      } else {
        if (allMatches.length > 0) { curStatus = 'Hadir'; curIsHadir = true; totalHadir++; }
        else if (!isCurWeekend) { if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) totalBelum++; }
      }
      history.push({ tanggal: d, tanggalLengkap: `${d}/${month}/${year}`, hari: curDayName, isWeekend: isCurWeekend, isToday: (d === now.getDate() && parseInt(month) === (now.getMonth() + 1)), isPast: (d < now.getDate() && parseInt(month) === (now.getMonth() + 1)), isFuture: (d > now.getDate() && parseInt(month) === (now.getMonth() + 1)), jamMasuk: curJamMasuk, jamPulang: curJamPulang, status: curStatus, isHadir: curIsHadir });
    }

    const targetEntry = history.find(h => h.tanggal === day) || {};
    colleagues.push({ no: parseInt(no) || i, nip, nama, jamMasuk: targetEntry.jamMasuk !== '-' ? targetEntry.jamMasuk : null, jamPulang: targetEntry.jamPulang !== '-' ? targetEntry.jamPulang : null, status: targetEntry.status || 'Belum Absen', isHadir: !!targetEntry.isHadir, monthHistory: { month, year, totalHadir, totalIzin, totalSakit, totalBelum, history } });
  });

  const hadirCount = colleagues.filter(c => c.isHadir).length;
  const belumCount = colleagues.filter(c => !c.isHadir && c.status === 'Belum Absen').length;
  const resultData = { success: true, day, month, year, namaHari, isWeekend, total: colleagues.length, hadirCount, belumCount, colleagues };
  colleagueCache[cacheKey] = { timestamp: Date.now(), data: resultData };
  return { ...resultData, fromCache: false, fetchedAt: new Date().toISOString() };
}

module.exports = {
  BASE_URL, HEADERS_BASE,
  fetchLoginPage, detectSchoolProfile, saveSessionAndReturn, doLogin,
  ensureTenantSession, ensureValidSession,
  checkAttendance, parseAttendanceHTML,
  fetchColleaguesAttendance,
  tenantSessions,
  get colleagueCache() { return colleagueCache; },
  resetColleagueCache() { colleagueCache = {}; }
};
