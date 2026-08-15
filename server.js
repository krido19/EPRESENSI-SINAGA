const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const cron    = require('node-cron');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const XLSX    = require('xlsx');
const QRCode  = require('qrcode');
const pino    = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app  = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

// ─── Storage Files & Folders ──────────────────────────────────────────────────
const CONFIG_FILE      = path.join(__dirname, 'config.json');
const LOG_FILE         = path.join(__dirname, 'logs.json');
const RECIPIENTS_FILE  = path.join(__dirname, 'recipients.json');
const BAILEYS_AUTH_DIR = path.join(__dirname, 'baileys_auth_info');

// ─── Baileys WhatsApp State ───────────────────────────────────────────────────
let waSock = null;
let waQrCodeDataUrl = null;
let waConnectionStatus = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connecting' | 'connected'
let waConnectedUser = null;

async function initBaileys() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(BAILEYS_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    waSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['ePresensi Sinaga', 'Chrome', '1.0.0']
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waConnectionStatus = 'qr_ready';
        try {
          waQrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 7, margin: 2 });
        } catch (e) {
          console.error('Error generate QR:', e);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        waConnectionStatus = 'disconnected';
        waConnectedUser = null;
        waQrCodeDataUrl = null;

        console.log(`[WhatsApp Web] Terputus (Status: ${statusCode || 'unknown'}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(initBaileys, 4000);
        } else {
          try { fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
          setTimeout(initBaileys, 2000);
        }
      } else if (connection === 'open') {
        waConnectionStatus = 'connected';
        waQrCodeDataUrl = null;
        const userJid = waSock.user?.id || '';
        const cleanNumber = userJid.split(':')[0] || userJid.split('@')[0];
        waConnectedUser = {
          jid: userJid,
          number: cleanNumber,
          name: waSock.user?.name || 'Admin Presensi'
        };
        console.log(`[WhatsApp Web] ✅ Terhubung: +${cleanNumber}`);
        addLog({ type: 'info', message: `📱 WhatsApp Web (Baileys) Terhubung: +${cleanNumber}` });
      }
    });
  } catch (err) {
    console.error('Error initBaileys:', err.message);
  }
}

// Inisialisasi Baileys saat server start
initBaileys();

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!data.appPassword) data.appPassword = process.env.APP_PASSWORD || 'SMK3magelang';
    return data;
  }
  return {
    authMode: 'auto', username: '', password: '',
    cookie: '', cookieExpiry: null,
    fonnteToken: '', waNumber: '',
    schedulerEnabled: false, checkHour: 6, checkMinute: 0,
    message: 'Halo *{nama}*! 👋\n\nPengingat presensi:\nAnda belum melakukan *absen pagi* hari ini di ePresensi Jateng.\n\nSegera absen sekarang! ⏰\n\n_Pesan otomatis dari sistem_',
    appPassword: process.env.APP_PASSWORD || 'SMK3magelang'
  };
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }

// ─── Logs ─────────────────────────────────────────────────────────────────────
function loadLogs() { return fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : []; }
function addLog(entry) {
  const logs = loadLogs();
  logs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (logs.length > 200) logs.splice(200);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// ─── Recipients ───────────────────────────────────────────────────────────────
function loadRecipients() { return fs.existsSync(RECIPIENTS_FILE) ? JSON.parse(fs.readFileSync(RECIPIENTS_FILE, 'utf8')) : []; }
function saveRecipients(list) { fs.writeFileSync(RECIPIENTS_FILE, JSON.stringify(list, null, 2)); }

// ─── ePresensi Auth ───────────────────────────────────────────────────────────
const BASE_URL    = 'https://presensi.bkd.jatengprov.go.id';
const HEADERS_BASE = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
};

async function fetchLoginPage() {
  const res  = await fetch(`${BASE_URL}/v3/`, { headers: HEADERS_BASE, redirect: 'follow' });
  const html = await res.text();
  const setCookieHeader = res.headers.raw()['set-cookie'] || [];
  const cookies = setCookieHeader.map(c => c.split(';')[0]).join('; ');
  const satuMatch = html.match(/name=["']satu["'][^>]*value=["'](\d+)["']/) || html.match(/value=["'](\d+)["'][^>]*name=["']satu["']/);
  const duaMatch  = html.match(/name=["']dua["'][^>]*value=["'](\d+)["']/)  || html.match(/value=["'](\d+)["'][^>]*name=["']dua["']/);
  return { html, cookies, satu: satuMatch ? parseInt(satuMatch[1]) : 2, dua: duaMatch ? parseInt(duaMatch[1]) : 3 };
}

async function saveSessionAndReturn(username, cookies) {
  const expiry = new Date(); expiry.setHours(expiry.getHours() + 8);
  const cfg = loadConfig(); cfg.cookie = cookies; cfg.cookieExpiry = expiry.toISOString(); saveConfig(cfg);
  addLog({ type: 'info', message: `✅ Auto-login berhasil sebagai ${username}` });
  console.log(`[Auth] ✅ Login berhasil! Cookie tersimpan.`);
  return { success: true, cookie: cookies, expiry: expiry.toISOString() };
}

async function doLogin(username, password) {
  try {
    console.log(`[Auth] Login sebagai: ${username}`);
    const { html: loginHtml, cookies: initCookies, satu, dua } = await fetchLoginPage();
    if (!loginHtml.includes('username') && !loginHtml.includes('password'))
      return { success: false, error: 'Halaman login tidak dapat diakses.' };

    const jawaban = satu + dua;
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('satu', String(satu));
    formData.append('dua',  String(dua));
    formData.append('jawaban', String(jawaban));

    const loginRes = await fetch(`${BASE_URL}/v3/portal/auth`, {
      method: 'POST',
      headers: { ...HEADERS_BASE, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': initCookies, 'Referer': `${BASE_URL}/v3/`, 'Origin': BASE_URL },
      body: formData.toString(), redirect: 'manual',
    });

    const status   = loginRes.status;
    const location = loginRes.headers.get('location') || '';
    const setCookies     = loginRes.headers.raw()['set-cookie'] || [];
    const sessionCookies = setCookies.map(c => c.split(';')[0]).join('; ');
    const allCookies     = [initCookies, sessionCookies].filter(Boolean).join('; ');

    if (status === 301 || status === 302 || status === 303) {
      const verifyRes = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: allCookies }, redirect: 'manual' });
      if (verifyRes.status === 200) return await saveSessionAndReturn(username, allCookies);
      const finalUrl  = location.startsWith('http') ? location : `${BASE_URL}${location}`;
      const followRes = await fetch(finalUrl, { headers: { ...HEADERS_BASE, Cookie: allCookies }, redirect: 'manual' });
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

async function ensureValidSession() {
  const config = loadConfig();
  if (config.authMode === 'manual') {
    if (!config.cookie) return { success: false, error: 'Cookie belum diset.' };
    return { success: true, cookie: config.cookie };
  }
  if (config.cookie) {
    const isExpired = config.cookieExpiry && new Date() > new Date(config.cookieExpiry);
    if (!isExpired) {
      try {
        const res = await fetch(`${BASE_URL}/v3/dashboard`, { headers: { ...HEADERS_BASE, Cookie: config.cookie }, redirect: 'manual' });
        if (res.status === 200) return { success: true, cookie: config.cookie };
      } catch(e) {}
    }
    addLog({ type: 'info', message: '🔄 Re-login otomatis...' });
  }
  if (!config.username || !config.password) return { success: false, error: 'Username/password belum diset.' };
  return await doLogin(config.username, config.password);
}

// ─── Attendance Check (Personal) ──────────────────────────────────────────────
async function checkAttendance(cookie) {
  try {
    const response = await fetch(`${BASE_URL}/v3/rekap/saya`, {
      headers: { ...HEADERS_BASE, Cookie: cookie, Referer: `${BASE_URL}/v3/dashboard` },
      redirect: 'manual',
    });
    if (response.status === 302 || response.status === 301 || response.status === 303)
      return { success: false, error: 'Session expired.', sessionExpired: true };
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const html = await response.text();
    if (html.includes('login') && html.includes('password') && !html.includes('rekap'))
      return { success: false, error: 'Session expired.', sessionExpired: true };
    return { success: true, data: parseAttendanceHTML(html) };
  } catch (err) {
    return { success: false, error: `Gagal: ${err.message}` };
  }
}

function parseAttendanceHTML(html) {
  const today  = new Date();
  const dayOfMonth = today.getDate();
  const dd     = String(dayOfMonth).padStart(2, '0');
  const mm     = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy   = today.getFullYear();
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  const result = {
    date: `${dayOfMonth} ${months[today.getMonth()]} ${yyyy}`,
    hasAbsenPagi: false, hasAbsenPulang: false, status: 'Belum Absen',
    jamMasuk: null, jamPulang: null, rawIndicators: {}
  };

  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i);
  if (!tbodyMatch) {
    result.status = 'Tidak Dapat Dibaca';
    return result;
  }

  const rows = tbodyMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  if (rows.length === 0) {
    result.status = 'Tidak Ada Baris';
    return result;
  }

  const targetRowIdx = dayOfMonth - 1;
  const targetRow = rows[targetRowIdx] || rows[0];
  const thMatches = [...targetRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  const cols = thMatches.map(m => m[1].replace(/<[^>]+>/g, '').trim());

  const rawTanggal = cols[0] || '';
  const rawMasuk   = cols[1] || '-';
  const rawPulang  = cols[2] || '-';
  const rawStatus  = (cols[3] || '').trim().toUpperCase();

  const jamMasukMatch = rawMasuk.match(/^(\d{2}:\d{2})$/);
  if (jamMasukMatch && rawMasuk !== '-') {
    result.jamMasuk     = jamMasukMatch[1];
    result.hasAbsenPagi = true;
    result.status       = 'Hadir';
  } else {
    result.hasAbsenPagi = false;
  }

  const jamPulangMatch = rawPulang.match(/^(\d{2}:\d{2})$/);
  if (jamPulangMatch && rawPulang !== '-') {
    result.jamPulang     = jamPulangMatch[1];
    result.hasAbsenPulang = true;
  }

  if (result.hasAbsenPagi) {
    result.status = 'Hadir';
  } else if (rawStatus === 'I') {
    result.status = 'Izin';
  } else if (rawStatus === 'S') {
    result.status = 'Sakit';
  } else if (rawStatus === 'A') {
    result.status = 'Belum Absen (Alpha)';
  } else if (!rawTanggal && rawMasuk === '-' && rawPulang === '-') {
    result.status = 'Libur / Akhir Pekan';
  } else {
    result.status = 'Belum Absen';
  }

  result.rawIndicators = { dayOfMonth, targetRowIdx, totalRows: rows.length, rawTanggal, rawMasuk, rawPulang, rawStatus, cols };
  return result;
}

// ─── Colleague Cache Layer (5 Menit TTL) ──────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
let colleagueCache = {};

// ─── Fetch All Colleagues in Unit (SMKN 3 Magelang) ───────────────────────────
async function fetchColleaguesAttendance(cookie, targetDay = null, targetMonth = null, targetYear = null, forceRefresh = false) {
  const now   = new Date();
  const day   = targetDay   ? parseInt(targetDay)   : now.getDate();
  const month = targetMonth ? String(targetMonth).padStart(2,'0') : String(now.getMonth() + 1).padStart(2,'0');
  const year  = targetYear  ? String(targetYear)  : String(now.getFullYear());
  const dayISO = `${year}-${month}-${String(day).padStart(2,'0')}`;
  const cacheKey = `${year}-${month}-${day}`;

  // Cek cache memory jika tidak force refresh
  if (!forceRefresh && colleagueCache[cacheKey]) {
    const isFresh = (Date.now() - colleagueCache[cacheKey].timestamp) < CACHE_TTL_MS;
    if (isFresh) {
      return {
        ...colleagueCache[cacheKey].data,
        fromCache: true,
        cachedAt: new Date(colleagueCache[cacheKey].timestamp).toISOString()
      };
    }
  }

  const formData = new URLSearchParams();
  formData.append('opd', 'F200000000');
  formData.append('unit', 'F208007700');
  formData.append('rl', '88');
  formData.append('bulan', month);
  formData.append('tahun', year);
  formData.append('nip', '');

  const res = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
    method: 'POST',
    headers: {
      ...HEADERS_BASE,
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/v3/data_v4`
    },
    body: formData.toString()
  });

  if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
  const html = await res.text();

  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  if (tables.length < 2) return { success: false, error: 'Tabel data unit kerja tidak ditemukan.' };

  const rows = [...tables[1].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  const colleagues = [];

  const dateObj  = new Date(parseInt(year), parseInt(month) - 1, day);
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const namaHari = dayNames[dateObj.getDay()];
  const isWeekend = (namaHari === 'Sabtu' || namaHari === 'Minggu');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length < 2) continue;

    const no = cells[0].replace(/<[^>]+>/g, '').trim();
    const rawNipNama = cells[1].replace(/<[^>]+>/g, '').replace(/'/g, '').trim();
    const nipMatch   = rawNipNama.match(/(\d{18})/);
    const nip        = nipMatch ? nipMatch[1] : '';
    const nama       = rawNipNama.replace(nip, '').trim() || (cells[2] ? cells[2].replace(/<[^>]+>/g, '').trim() : '');

    // Cari semua timestamp untuk tanggal dayISO di row ini
    const tsRegex = new RegExp(`${dayISO}\\s+(\\d{2}:\\d{2})(?::\\d{2})?`, 'g');
    const matches = [...row.matchAll(tsRegex)].map(m => m[1]);

    let jamMasuk = null;
    let jamPulang = null;
    let statusText = 'Belum Absen';
    let isHadir    = false;

    if (matches.length > 0) {
      matches.sort();
      jamMasuk  = matches[0];
      jamPulang = matches.length > 1 ? matches[matches.length - 1] : null;
      statusText = 'Hadir';
      isHadir    = true;
    } else if (isWeekend || row.includes('OFF')) {
      statusText = 'Libur (OFF)';
    }

    colleagues.push({
      no: parseInt(no) || i,
      nip,
      nama,
      jamMasuk,
      jamPulang,
      status: statusText,
      isHadir
    });
  }

  const hadirCount = colleagues.filter(c => c.isHadir).length;
  const belumCount = colleagues.length - hadirCount;

  const resultData = {
    success: true,
    day, month, year,
    namaHari,
    isWeekend,
    total: colleagues.length,
    hadirCount,
    belumCount,
    colleagues
  };

  // Simpan ke memory cache
  colleagueCache[cacheKey] = {
    timestamp: Date.now(),
    data: resultData
  };

  return {
    ...resultData,
    fromCache: false,
    fetchedAt: new Date().toISOString()
  };
}

// ─── API: Colleagues List with Caching ───────────────────────────────────────
app.get('/api/colleagues', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });

  const force = req.query.force === 'true';
  const result = await fetchColleaguesAttendance(session.cookie, req.query.day, req.query.month, req.query.year, force);
  res.json(result);
});

// ─── Colleague 1-Month Detail History ─────────────────────────────────────────
app.get('/api/colleagues/:nip/history', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });

  const targetNip = req.params.nip.replace(/'/g, '').trim();
  const now       = new Date();
  const month     = req.query.month ? String(req.query.month).padStart(2,'0') : String(now.getMonth() + 1).padStart(2,'0');
  const year      = req.query.year  ? String(req.query.year)  : String(now.getFullYear());
  const dayNames  = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  const formData = new URLSearchParams();
  formData.append('opd', 'F200000000');
  formData.append('unit', 'F208007700');
  formData.append('rl', '88');
  formData.append('bulan', month);
  formData.append('tahun', year);
  formData.append('nip', '');

  try {
    const fetchRes = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
      method: 'POST',
      headers: {
        ...HEADERS_BASE,
        'Cookie': session.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/v3/data_v4`
      },
      body: formData.toString()
    });

    if (!fetchRes.ok) return res.json({ success: false, error: `HTTP ${fetchRes.status}` });
    const html = await fetchRes.text();

    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
    if (tables.length < 2) return res.json({ success: false, error: 'Tabel data unit kerja tidak ditemukan.' });

    const rows = [...tables[1].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
    let targetRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i].includes(targetNip)) {
        targetRow = rows[i];
        break;
      }
    }

    if (!targetRow) return res.json({ success: false, error: 'Data guru tidak ditemukan.' });

    const cells = [...targetRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    const rawNipNama = (cells[1] || '').replace(/<[^>]+>/g, '').replace(/'/g, '').trim();
    const nama = rawNipNama.replace(targetNip, '').trim() || (cells[2] ? cells[2].replace(/<[^>]+>/g, '').trim() : '');

    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
    const history = [];
    let totalHadir = 0, totalIzin = 0, totalSakit = 0, totalBelum = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr    = String(d).padStart(2, '0');
      const dateISO = `${year}-${month}-${dStr}`;
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, d);
      const namaHari = dayNames[dateObj.getDay()];
      const isWeekend = (namaHari === 'Sabtu' || namaHari === 'Minggu');

      const tsRegex = new RegExp(`${dateISO}\\s+(\\d{2}:\\d{2})(?::\\d{2})?`, 'g');
      const matches = [...targetRow.matchAll(tsRegex)].map(m => m[1]);

      let jamMasuk  = '-';
      let jamPulang = '-';
      let status    = 'Belum Absen';
      let isHadir   = false;

      if (matches.length > 0) {
        matches.sort();
        jamMasuk  = matches[0];
        jamPulang = matches.length > 1 ? matches[matches.length - 1] : '-';
        status    = 'Hadir';
        isHadir   = true;
        totalHadir++;
      } else if (isWeekend) {
        status = 'Libur (OFF)';
      } else if (d <= now.getDate()) {
        totalBelum++;
      }

      history.push({
        tanggal: d,
        tanggalLengkap: `${d}/${month}/${year}`,
        hari: namaHari,
        isWeekend,
        isToday: (d === now.getDate() && parseInt(month) === (now.getMonth() + 1)),
        isPast: (d < now.getDate()),
        isFuture: (d > now.getDate()),
        jamMasuk,
        jamPulang,
        status,
        isHadir
      });
    }

    res.json({
      success: true,
      nip: targetNip,
      nama,
      month,
      year,
      totalHadir,
      totalIzin,
      totalSakit,
      totalBelum,
      history
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── WhatsApp Sending Gateway (Dual: Baileys Scan QR & Fonnte API) ───────────
async function sendWhatsApp(target, message, tokenOverride = null) {
  const cfg = loadConfig();
  // Default to Baileys if connected, or if waGateway is explicitly set to 'baileys' or not 'fonnte'
  const isBaileysActive = waSock && waConnectionStatus === 'connected';
  const gateway = cfg.waGateway || (isBaileysActive ? 'baileys' : (cfg.fonnteToken ? 'fonnte' : 'baileys'));

  if (gateway === 'fonnte' && !isBaileysActive && (tokenOverride || cfg.fonnteToken)) {
    try {
      const token = tokenOverride || cfg.fonnteToken;
      const formData = new URLSearchParams();
      formData.append('target', target);
      formData.append('message', message);
      formData.append('countryCode', '62');
      const res = await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: token }, body: formData });
      const result = await res.json();
      const isSuccess = result.status === true || result.status === 'true';
      return {
        success: isSuccess,
        data: result,
        error: isSuccess ? null : (result.reason || result.message || 'Fonnte gagal mengirim pesan'),
        gateway: 'fonnte'
      };
    } catch (err) {
      return { success: false, error: `Fonnte Error: ${err.message}`, gateway: 'fonnte' };
    }
  } else {
    // Mode Baileys (Scan QR Langsung - Gratis Unlimited)
    if (!waSock || waConnectionStatus !== 'connected') {
      return {
        success: false,
        error: 'WhatsApp Web belum terhubung. Silakan buka menu Pengaturan & scan QR Code WhatsApp.',
        gateway: 'baileys'
      };
    }

    let clean = String(target).replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    if (!clean.includes('@s.whatsapp.net')) clean = `${clean}@s.whatsapp.net`;

    try {
      const sent = await waSock.sendMessage(clean, { text: message });
      return { success: !!sent, data: sent, gateway: 'baileys' };
    } catch (err) {
      return { success: false, error: `WhatsApp Error: ${err.message}`, gateway: 'baileys' };
    }
  }
}

async function sendToAllRecipients(token, messageTemplate, targetOverride = null) {
  const recipients = loadRecipients().filter(r => r.aktif !== false);
  const results    = [];
  const targets = targetOverride ? [{ nama: 'Admin', nomor: targetOverride }, ...recipients] : recipients;

  if (targets.length === 0) return { success: false, error: 'Belum ada penerima.', results: [] };

  for (const r of targets) {
    const msg    = messageTemplate.replace(/\{nama\}/gi, r.nama || 'Bapak/Ibu');
    const result = await sendWhatsApp(r.nomor, msg, token);
    results.push({ nama: r.nama, nomor: r.nomor, success: result.success, data: result.data, error: result.error });
    await new Promise(res => setTimeout(res, 1200));
  }

  const successCount = results.filter(r => r.success).length;
  return { success: successCount > 0, results, successCount, totalCount: targets.length };
}

// ─── Scheduler (Dual: 07:30 WIB Pagi & 18:00 WIB Pulang) ──────────────────────
let cronPagi = null;
let cronPulang = null;

function setupScheduler() {
  if (cronPagi) { cronPagi.stop(); cronPagi = null; }
  if (cronPulang) { cronPulang.stop(); cronPulang = null; }

  const cfg = loadConfig();
  if (!cfg.schedulerEnabled) {
    console.log('[Scheduler] Nonaktif');
    return;
  }

  // 1. Jadwal Pagi (Absen Masuk) - 07:30 WIB
  if (cfg.schedulerPagiEnabled !== false) {
    const hour = cfg.pagiHour ?? 7;
    const minute = cfg.pagiMinute ?? 30;
    console.log(`[Scheduler] Pagi Aktif — ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} WIB`);

    cronPagi = cron.schedule(`${minute} ${hour} * * *`, async () => {
      console.log(`[Scheduler 🌅 Pagi] Memulai pengecekan presensi masuk...`);
      try {
        const config = loadConfig();
        if (!config.fonnteToken) return;
        const session = await ensureValidSession();
        if (!session.success) return;

        const day = new Date().getDate();
        const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day, null, null, true);
        if (!colleaguesRes.success) return;

        // Cari guru yang belum absen masuk dan bukan hari libur
        const unabsent = colleaguesRes.colleagues.filter(c => !c.isHadir && !c.status.includes('Libur'));
        if (unabsent.length === 0) {
          addLog({ type: 'info', message: '🌅 Pagi (07:30 WIB): Semua guru sudah hadir.' });
          return;
        }

        const registered = loadRecipients().filter(r => r.aktif !== false);
        const targets = [];
        for (const guru of unabsent) {
          const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
          const found = registered.find(r => {
            const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru);
          });
          if (found && found.nomor) targets.push({ nama: guru.nama, nomor: found.nomor });
        }

        if (targets.length === 0) {
          addLog({ type: 'info', message: `🌅 Pagi: Ada ${unabsent.length} guru belum absen, tapi nomor WA belum terdaftar di sistem.` });
          return;
        }

        const template = config.messagePagi || config.message;
        let sentCount = 0;
        for (const t of targets) {
          const msg = template.replace(/\{nama\}/gi, t.nama);
          const sRes = await sendWhatsApp(config.fonnteToken, t.nomor, msg);
          if (sRes.success) sentCount++;
          await new Promise(r => setTimeout(r, 1000));
        }

        addLog({
          type: sentCount > 0 ? 'sent' : 'error',
          message: `🌅 Auto Pagi (07:30 WIB): Notifikasi WA terkirim ke ${sentCount}/${targets.length} guru yang belum absen masuk.`
        });
      } catch (err) {
        addLog({ type: 'error', message: `🌅 Error scheduler pagi: ${err.message}` });
      }
    }, { timezone: 'Asia/Jakarta' });
  }

  // 2. Jadwal Sore (Absen Pulang) - 18:00 WIB
  if (cfg.schedulerPulangEnabled !== false) {
    const hour = cfg.pulangHour ?? 18;
    const minute = cfg.pulangMinute ?? 0;
    console.log(`[Scheduler] Pulang Aktif — ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} WIB`);

    cronPulang = cron.schedule(`${minute} ${hour} * * *`, async () => {
      console.log(`[Scheduler 🌆 Pulang] Memulai pengecekan presensi pulang...`);
      try {
        const config = loadConfig();
        if (!config.fonnteToken) return;
        const session = await ensureValidSession();
        if (!session.success) return;

        const day = new Date().getDate();
        const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day, null, null, true);
        if (!colleaguesRes.success) return;

        // Cari guru yang belum absen pulang dan bukan hari libur
        const noPulang = colleaguesRes.colleagues.filter(c => !c.jamPulang && !c.status.includes('Libur'));
        if (noPulang.length === 0) {
          addLog({ type: 'info', message: '🌆 Pulang (18:00 WIB): Semua guru sudah absen pulang.' });
          return;
        }

        const registered = loadRecipients().filter(r => r.aktif !== false);
        const targets = [];
        for (const guru of noPulang) {
          const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
          const found = registered.find(r => {
            const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru);
          });
          if (found && found.nomor) targets.push({ nama: guru.nama, nomor: found.nomor });
        }

        if (targets.length === 0) {
          addLog({ type: 'info', message: `🌆 Pulang: Ada ${noPulang.length} guru belum absen pulang, tapi nomor WA belum terdaftar di sistem.` });
          return;
        }

        const template = config.messagePulang || config.message;
        let sentCount = 0;
        for (const t of targets) {
          const msg = template.replace(/\{nama\}/gi, t.nama);
          const sRes = await sendWhatsApp(config.fonnteToken, t.nomor, msg);
          if (sRes.success) sentCount++;
          await new Promise(r => setTimeout(r, 1000));
        }

        addLog({
          type: sentCount > 0 ? 'sent' : 'error',
          message: `🌆 Auto Pulang (18:00 WIB): Notifikasi WA terkirim ke ${sentCount}/${targets.length} guru yang belum absen pulang.`
        });
      } catch (err) {
        addLog({ type: 'error', message: `🌆 Error scheduler pulang: ${err.message}` });
      }
    }, { timezone: 'Asia/Jakarta' });
  }
}
setupScheduler();

// ─── API Routes ───────────────────────────────────────────────────────────────

// Colleagues Endpoint (Monitoring Semua Rekan Guru Hari Ini)
app.get('/api/colleagues', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const result = await fetchColleaguesAttendance(session.cookie, req.query.day, req.query.month, req.query.year);
  res.json(result);
});

// Send Notification Specifically to Colleagues Who Have NOT Checked In Today
app.post('/api/send-unabsent', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.fonnteToken) return res.json({ success: false, error: 'Token Fonnte belum diset di menu Konfigurasi.' });

  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });

  const day = req.body.day || new Date().getDate();
  const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day);
  if (!colleaguesRes.success) return res.json({ success: false, error: colleaguesRes.error });

  // Filter yang belum absen dan bukan hari libur
  const unabsentList = colleaguesRes.colleagues.filter(c => !c.isHadir && !c.status.includes('Libur'));
  if (unabsentList.length === 0) {
    return res.json({ success: true, message: 'Semua guru sudah hadir atau hari libur.', sentCount: 0, totalUnabsent: 0 });
  }

  // Cocokkan dengan nomor WA di daftar penerima (recipients.json)
  const registeredRecipients = loadRecipients().filter(r => r.aktif !== false);
  const targets = [];
  const unmatched = [];

  for (const guru of unabsentList) {
    const cleanGuruName = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = registeredRecipients.find(r => {
      const cleanRName = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanGuruName.includes(cleanRName) || cleanRName.includes(cleanGuruName);
    });

    if (found && found.nomor) {
      targets.push({ nama: guru.nama, nomor: found.nomor, nip: guru.nip });
    } else {
      unmatched.push({ nama: guru.nama, nip: guru.nip });
    }
  }

  if (targets.length === 0) {
    return res.json({
      success: false,
      error: `Ditemukan ${unabsentList.length} guru belum absen, tetapi belum ada nomor WhatsApp mereka di Daftar Penerima WA.`,
      unabsentCount: unabsentList.length,
      unmatched
    });
  }

  // Kirim WA
  const template = req.body.message || cfg.message;
  const results = [];

  for (const t of targets) {
    const msg = template.replace(/\{nama\}/gi, t.nama);
    const sendRes = await sendWhatsApp(cfg.fonnteToken, t.nomor, msg);
    results.push({ nama: t.nama, nomor: t.nomor, success: sendRes.success });
    await new Promise(r => setTimeout(r, 1000));
  }

  const successCount = results.filter(r => r.success).length;
  addLog({
    type: successCount > 0 ? 'sent' : 'error',
    message: `⚡ Notif Cepat: Terkirim ke ${successCount}/${targets.length} rekan yang belum absen`,
    detail: results
  });

  res.json({
    success: true,
    sentCount: successCount,
    totalTargets: targets.length,
    totalUnabsent: unabsentList.length,
    unmatchedCount: unmatched.length,
    results,
    unmatched
  });
});

// Send Direct WhatsApp to Individual Teacher
app.post('/api/send-direct', async (req, res) => {
  const { nomor, nama, message } = req.body;
  if (!nomor) return res.json({ success: false, error: 'Nomor WhatsApp tidak valid.' });

  const cfg = loadConfig();
  const template = message || cfg.messagePagi || cfg.message || 'Halo *{nama}*! Jangan lupa lakukan presensi hari ini di ePresensi Jateng ya! ⏰';
  const finalMsg = template.replace(/\{nama\}/gi, nama || 'Bapak/Ibu');

  const result = await sendWhatsApp(nomor, finalMsg, cfg.fonnteToken);
  if (result.success) {
    addLog({ type: 'sent', message: `💬 Kirim Langsung: Notifikasi terkirim ke ${nama || nomor} (${nomor})` });
  } else {
    addLog({ type: 'error', message: `❌ Gagal Kirim Langsung ke ${nama || nomor}: ${result.error}` });
  }

  res.json({ success: result.success, error: result.error, data: result.data });
});

// ─── App Gatekeeper Security (Password: SMK3magelang by default) ───────────────
app.post('/api/auth/app-login', (req, res) => {
  const { password } = req.body;
  const cfg = loadConfig();
  const validPass = cfg.appPassword || process.env.APP_PASSWORD || 'SMK3magelang';

  if (password === validPass) {
    const token = Buffer.from(`auth_${validPass}_${Date.now()}`).toString('base64');
    addLog({ type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    return res.json({ success: true, token });
  }

  res.json({ success: false, error: 'Password akses salah. Silakan coba lagi.' });
});

app.post('/api/auth/change-app-password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const cfg = loadConfig();
  const validPass = cfg.appPassword || process.env.APP_PASSWORD || 'SMK3magelang';

  if (oldPassword !== validPass) {
    return res.json({ success: false, error: 'Password lama salah.' });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.json({ success: false, error: 'Password baru minimal 4 karakter.' });
  }

  cfg.appPassword = newPassword;
  saveConfig(cfg);
  addLog({ type: 'info', message: '🔑 Password akses aplikasi berhasil diperbarui.' });
  res.json({ success: true, message: 'Password akses aplikasi berhasil diperbarui!' });
});

// ─── WhatsApp Web (Baileys) Management Endpoints ─────────────────────────────
app.get('/api/wa/status', (req, res) => {
  const cfg = loadConfig();
  res.json({
    gateway: cfg.waGateway || 'baileys',
    status: waConnectionStatus,
    user: waConnectedUser,
    qr: waQrCodeDataUrl
  });
});

app.post('/api/wa/restart', async (req, res) => {
  console.log('[WhatsApp Web] Permintaan regenerasi QR / restart koneksi...');
  waConnectionStatus = 'connecting';
  waQrCodeDataUrl = null;
  waConnectedUser = null;
  initBaileys();
  res.json({ success: true, message: 'Memulai ulang koneksi WhatsApp Web...' });
});

app.post('/api/wa/logout', async (req, res) => {
  console.log('[WhatsApp Web] Logout session...');
  try {
    if (waSock) {
      await waSock.logout().catch(() => {});
    }
  } catch (e) {}

  try {
    fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true });
  } catch (e) {}

  waConnectionStatus = 'disconnected';
  waConnectedUser = null;
  waQrCodeDataUrl = null;
  addLog({ type: 'info', message: '📱 Sesi WhatsApp Web telah diputus/logout.' });
  setTimeout(initBaileys, 1000);
  res.json({ success: true, message: 'WhatsApp Web berhasil diputuskan.' });
});

// Config
app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({
    authMode: cfg.authMode || 'auto', username: cfg.username || '',
    usernameSet: !!cfg.username, passwordSet: !!cfg.password,
    cookieSet: !!cfg.cookie, cookieExpiry: cfg.cookieExpiry,
    waGateway: cfg.waGateway || 'baileys',
    fonnteSet: !!cfg.fonnteToken, waNumberSet: !!cfg.waNumber,
    schedulerEnabled: cfg.schedulerEnabled !== false,
    schedulerPagiEnabled: cfg.schedulerPagiEnabled !== false,
    pagiHour: cfg.pagiHour ?? 7, pagiMinute: cfg.pagiMinute ?? 30,
    schedulerPulangEnabled: cfg.schedulerPulangEnabled !== false,
    pulangHour: cfg.pulangHour ?? 18, pulangMinute: cfg.pulangMinute ?? 0,
    message: cfg.message || '',
    messagePagi: cfg.messagePagi || '',
    messagePulang: cfg.messagePulang || '',
  });
});

app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const allowed = [
    'authMode','username','password','cookie','waGateway','fonnteToken','waNumber',
    'schedulerEnabled','schedulerPagiEnabled','pagiHour','pagiMinute',
    'schedulerPulangEnabled','pulangHour','pulangMinute',
    'message','messagePagi','messagePulang'
  ];
  const updated = { ...current };
  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== '') updated[key] = req.body[key];
  }
  saveConfig(updated);
  setupScheduler();
  res.json({ success: true });
});

// Login
app.post('/api/login', async (req, res) => {
  const cfg = loadConfig();
  const username = req.body.username || cfg.username;
  const password = req.body.password || cfg.password;
  if (!username || !password) return res.json({ success: false, error: 'Username dan password diperlukan.' });
  if (req.body.username && req.body.password) {
    const c = loadConfig(); c.username = req.body.username; c.password = req.body.password; c.authMode = 'auto'; saveConfig(c);
  }
  res.json(await doLogin(username, password));
});

// Check Attendance (Personal)
app.post('/api/check', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const result = await checkAttendance(session.cookie);
  if (result.success) addLog({ type: 'manual_check', message: `Cek presensi: ${result.data.status} (Masuk: ${result.data.jamMasuk || '-'})`, data: result.data });
  res.json(result);
});

// Send Now
app.post('/api/send-now', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.fonnteToken) return res.json({ success: false, error: 'Token Fonnte belum diset.' });
  const template = req.body.message || cfg.message;
  const result = await sendToAllRecipients(cfg.fonnteToken, template, cfg.waNumber || null);
  addLog({
    type: result.success ? 'sent' : 'error',
    message: result.success ? `✅ WA terkirim ke ${result.successCount}/${result.totalCount} guru` : `❌ Gagal: ${result.error || ''}`,
    detail: result.results,
  });
  res.json(result);
});

// Check and Send
app.post('/api/check-and-send', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });
  const checkResult = await checkAttendance(session.cookie);
  if (!checkResult.success) return res.json({ success: false, error: checkResult.error });
  const { data } = checkResult;
  const cfg = loadConfig();
  let sendResult = null;
  if (!data.hasAbsenPagi) {
    if (!cfg.fonnteToken) return res.json({ success: true, attendance: data, waSent: false, notAbsent: true, error: 'Token Fonnte belum diset.' });
    sendResult = await sendToAllRecipients(cfg.fonnteToken, cfg.message, cfg.waNumber || null);
    addLog({
      type: sendResult.success ? 'sent' : 'error',
      message: sendResult.success ? `✅ WA terkirim ke ${sendResult.successCount}/${sendResult.totalCount} guru` : `❌ Gagal kirim WA`,
      detail: sendResult.results,
    });
  }
  res.json({ success: true, attendance: data, waSent: !!sendResult?.success, sendResult, notAbsent: !data.hasAbsenPagi });
});

// Dynamic Excel Template with all 98 Teachers from SMKN 3 Magelang
app.get('/api/recipients/template', async (req, res) => {
  try {
    const session = await ensureValidSession();
    let teachers = [];
    if (session.success) {
      const colleaguesRes = await fetchColleaguesAttendance(session.cookie);
      if (colleaguesRes.success && colleaguesRes.colleagues) {
        teachers = colleaguesRes.colleagues;
      }
    }

    const existingRecipients = loadRecipients();
    const phoneMap = new Map();
    existingRecipients.forEach(r => {
      if (r.nama && r.nomor) {
        const clean = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
        phoneMap.set(clean, r.nomor);
      }
    });

    const data = teachers.map((t, idx) => {
      const clean = (t.nama || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const phone = phoneMap.get(clean) || '';
      return {
        'No': t.no || (idx + 1),
        'NIP': String(t.nip || ''),
        'Nama Guru': t.nama || '',
        'Nomor WhatsApp': phone
      };
    });

    if (data.length === 0) {
      data.push(
        { 'No': 1, 'NIP': '199601042025211042', 'Nama Guru': 'KRIDO BAHTIAR, S.Kom', 'Nomor WhatsApp': '' },
        { 'No': 2, 'NIP': '199301072025212071', 'Nama Guru': 'ANGRAKIT JANUARTI MURTININGRUM', 'Nomor WhatsApp': '' }
      );
    }

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 42 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daftar Guru SMKN 3');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="template_98_guru_smkn3_magelang.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(`Gagal generate template: ${err.message}`);
  }
});

// Recipients CRUD
app.get('/api/recipients', (req, res) => res.json(loadRecipients()));

app.post('/api/recipients', (req, res) => {
  const { nama, nomor } = req.body;
  if (!nama || !nomor) return res.json({ success: false, error: 'Nama dan nomor WA diperlukan.' });
  const list = loadRecipients();
  const clean = String(nomor).replace(/[^0-9]/g, '');
  if (list.find(r => r.nomor === clean)) return res.json({ success: false, error: 'Nomor WhatsApp sudah terdaftar.' });
  const newEntry = { id: String(Date.now()), nama: nama.trim(), nomor: clean, aktif: true };
  list.push(newEntry);
  saveRecipients(list);
  res.json({ success: true, data: newEntry });
});

app.put('/api/recipients/:id', (req, res) => {
  const list = loadRecipients();
  const targetId = String(req.params.id);
  const idx = list.findIndex(r => String(r.id) === targetId);
  if (idx === -1) return res.json({ success: false, error: 'Penerima tidak ditemukan.' });
  
  if (req.body.nama) list[idx].nama = req.body.nama.trim();
  if (req.body.nomor) list[idx].nomor = String(req.body.nomor).replace(/[^0-9]/g, '');
  if (req.body.aktif !== undefined) list[idx].aktif = !!req.body.aktif;
  
  saveRecipients(list);
  res.json({ success: true, data: list[idx] });
});

app.delete('/api/recipients/:id', (req, res) => {
  const targetId = String(req.params.id);
  const list = loadRecipients();
  const newList = list.filter(r => String(r.id) !== targetId);
  saveRecipients(newList);
  res.json({ success: true, count: newList.length });
});

app.delete('/api/recipients', (req, res) => {
  saveRecipients([]);
  res.json({ success: true });
});

// Import Excel
app.post('/api/recipients/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'File tidak ditemukan.' });
  try {
    const workbook  = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet     = workbook.Sheets[workbook.SheetNames[0]];
    const rows      = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.json({ success: false, error: 'File Excel kosong.' });

    const firstRow = rows[0];
    const keys     = Object.keys(firstRow);

    // 1. Precise Column Matching
    const noIndexRegex = /^(no|no\.|no_urut|nomor urut)$/i;

    // Detect Nama Column
    let namaKey = keys.find(k => /nama/i.test(k));
    if (!namaKey) namaKey = keys.find(k => !noIndexRegex.test(k.trim()) && !/nip/i.test(k)) || keys[0];

    // Detect WA / Phone Number Column (Must NOT be the 'No' index column!)
    let nomorKey = keys.find(k => /whatsapp|wa|hp|handphone|ponsel|telepon|telp|phone/i.test(k));
    if (!nomorKey) {
      nomorKey = keys.find(k => /nomor|kontak/i.test(k) && !noIndexRegex.test(k.trim()));
    }
    if (!nomorKey) {
      nomorKey = keys[keys.length - 1]; // Fallback to last column
    }

    const existing = loadRecipients();
    const added = [];
    const updated = [];
    const skipped = [];

    for (const row of rows) {
      const rawNama  = String(row[namaKey]  || '').trim();
      let rawNomor   = String(row[nomorKey] || '').replace(/[^0-9]/g, '');

      // Normalize phone number (e.g. 85868733378 -> 085868733378)
      if (rawNomor.startsWith('8')) {
        rawNomor = '0' + rawNomor;
      } else if (rawNomor.startsWith('628')) {
        rawNomor = '08' + rawNomor.slice(3);
      }

      if (!rawNama || !rawNomor || rawNomor.length < 9) {
        skipped.push({ nama: rawNama, nomor: rawNomor, reason: 'Nomor WA kosong atau kurang dari 9 digit' });
        continue;
      }

      // Check if existing by name or phone
      const cleanRawName = rawNama.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existingIdx = existing.findIndex(r => {
        const cleanExName = (r.nama || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return r.nomor === rawNomor || cleanExName === cleanRawName;
      });

      if (existingIdx !== -1) {
        // Update existing contact
        existing[existingIdx].nama = rawNama;
        existing[existingIdx].nomor = rawNomor;
        existing[existingIdx].aktif = true;
        updated.push(existing[existingIdx]);
      } else {
        // Add new contact
        const entry = { id: String(Date.now() + Math.floor(Math.random() * 10000)), nama: rawNama, nomor: rawNomor, aktif: true };
        existing.push(entry);
        added.push(entry);
      }
    }

    saveRecipients(existing);
    const totalProcessed = added.length + updated.length;
    addLog({ type: 'info', message: `📥 Import Excel: ${added.length} baru, ${updated.length} diperbarui (${skipped.length} dilewati)` });
    res.json({
      success: true,
      added: totalProcessed,
      newAdded: added.length,
      updated: updated.length,
      skipped: skipped.length,
      totalNow: existing.length
    });
  } catch (err) {
    res.json({ success: false, error: `Gagal baca Excel: ${err.message}` });
  }
});

// Logs
app.get('/api/logs', (req, res) => res.json(loadLogs()));
app.delete('/api/logs', (req, res) => { fs.writeFileSync(LOG_FILE, JSON.stringify([])); res.json({ success: true }); });

// Status
app.get('/api/status', (req, res) => {
  const cfg = loadConfig();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  
  // Calculate next candidate time between 07:30 Pagi and 18:00 Pulang
  const todayPagi = new Date(now);
  todayPagi.setHours(cfg.pagiHour ?? 7, cfg.pagiMinute ?? 30, 0, 0);

  const todayPulang = new Date(now);
  todayPulang.setHours(cfg.pulangHour ?? 18, cfg.pulangMinute ?? 0, 0, 0);

  const candidates = [];
  if (cfg.schedulerPagiEnabled !== false) {
    if (todayPagi > now) candidates.push(todayPagi);
    else {
      const tomPagi = new Date(todayPagi);
      tomPagi.setDate(tomPagi.getDate() + 1);
      candidates.push(tomPagi);
    }
  }
  if (cfg.schedulerPulangEnabled !== false) {
    if (todayPulang > now) candidates.push(todayPulang);
    else {
      const tomPulang = new Date(todayPulang);
      tomPulang.setDate(tomPulang.getDate() + 1);
      candidates.push(tomPulang);
    }
  }

  candidates.sort((a, b) => a - b);
  const nextCheck = candidates[0] || null;
  const cookieExpiry = cfg.cookieExpiry ? new Date(cfg.cookieExpiry) : null;

  res.json({
    authMode: cfg.authMode || 'auto',
    schedulerActive: (cronPagi !== null || cronPulang !== null) && cfg.schedulerEnabled,
    schedulerEnabled: cfg.schedulerEnabled || false,
    pagiTime: `${String(cfg.pagiHour ?? 7).padStart(2,'0')}:${String(cfg.pagiMinute ?? 30).padStart(2,'0')}`,
    pulangTime: `${String(cfg.pulangHour ?? 18).padStart(2,'0')}:${String(cfg.pulangMinute ?? 0).padStart(2,'0')}`,
    checkTime: `07:30 & 18:00`,
    nextCheck: nextCheck ? nextCheck.toISOString() : null,
    currentTime: now.toISOString(),
    usernameSet: !!cfg.username, passwordSet: !!cfg.password,
    cookieSet: !!cfg.cookie, cookieValid: cfg.cookie && (!cookieExpiry || cookieExpiry > now),
    cookieExpiry: cfg.cookieExpiry, fonnteSet: !!cfg.fonnteToken, waNumberSet: !!cfg.waNumber,
    recipientCount: loadRecipients().filter(r => r.aktif !== false).length,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`
╔════════════════════════════════════════╗
║   ePresensi Notif — Fonnte WA          ║
║   http://localhost:${PORT}                 ║
╚════════════════════════════════════════╝`));
