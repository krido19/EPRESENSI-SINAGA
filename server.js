require('dotenv').config();

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
const crypto  = require('crypto');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

// ─── Initialize Supabase ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[CRITICAL] SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env!');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Global Process Error Handlers (Anti-Crash Guard) ─────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security Configuration & Secret Key Management ──────────────────────────
function getAppSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.trim().length > 0) {
    return process.env.APP_SECRET.trim();
  }
  const secretFile = path.join(__dirname, '.app_secret');
  if (fs.existsSync(secretFile)) {
    try {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved) return saved;
    } catch (e) {}
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  } catch (e) {}
  return generated;
}

const AUTH_SECRET = getAppSecret();

// 1. CORS Boundary Hardening (Allows Localhost, Render, Railway, Koyeb)
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost',
  'http://127.0.0.1'
];

app.use(cors({
  origin: function (origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.includes('.onrender.com') ||
      origin.includes('.up.railway.app') ||
      origin.includes('.koyeb.app')
    ) {
      return callback(null, true);
    }
    return callback(new Error('CORS Policy: Akses dari domain luar tidak diizinkan.'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/graphify-out', express.static(path.join(__dirname, 'graphify-out')));

// 2. In-Memory Rate Limiter
const rateLimitRecords = new Map();
function createRateLimiter({ windowMs = 60000, max = 20, message = 'Terlalu banyak permintaan. Silakan tunggu sebentar.' }) {
  return function (req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const record = rateLimitRecords.get(ip) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    rateLimitRecords.set(ip, record);

    if (record.count > max) {
      return res.status(429).json({ success: false, error: message });
    }
    next();
  };
}

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Terlalu banyak percobaan login. Silakan tunggu 15 menit.' });
const actionLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Permintaan terlalu cepat. Harap tunggu.' });

// 3. Cryptographic Token Generator & Verifier
function generateAuthToken(password) {
  const timestamp = Date.now();
  const payload = `${password}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

function verifyAuthToken(token, currentPassword) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return false;
    const [tokenPass, tokenTime, tokenHmac] = parts;

    if (tokenPass !== currentPassword) return false;

    const timestamp = parseInt(tokenTime);
    if (Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000) return false; // 7 days validity

    const expectedHmac = crypto.createHmac('sha256', AUTH_SECRET).update(`${tokenPass}:${tokenTime}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(tokenHmac), Buffer.from(expectedHmac));
  } catch (e) {
    return false;
  }
}

// 4. API Authentication Guard Middleware
// ─── Auth cache (60s) untuk kurangi query Supabase di free tier ───────────────
const authCache = new Map(); // token → { user, tenantCfg, role, expiresAt }

async function requireAppAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Token tidak ditemukan.' });
  }

  // Cek cache dulu (kurangi round-trip ke Supabase)
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.userId    = cached.userId;
    req.userRole  = cached.role;
    req.schoolId  = cached.schoolId;
    req.tenantCfg = cached.tenantCfg;
    return next();
  }

  // Verifikasi JWT via Supabase
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.' });
  }

  req.userId = data.user.id;

  // Ambil role dan school dari user_roles
  try {
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role, school_id')
      .eq('user_id', data.user.id)
      .single();

    req.userRole = roleRow?.role || 'school_admin';
    req.schoolId = roleRow?.school_id || null;

    let tenantCfg = null;

    if (roleRow?.school_id) {
      // Ambil data sekolah + konfigurasi jadwal sekaligus
      const { data: school } = await supabase
        .from('schools')
        .select('*')
        .eq('id', roleRow.school_id)
        .single();

      const { data: schoolCfg } = await supabase
        .from('school_configs')
        .select('*')
        .eq('school_id', roleRow.school_id)
        .single();

      if (school) {
        // Bangun tenantCfg dengan format yang kompatibel dengan loadConfig()
        const localCfg = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); } catch(e) { return {}; } })();
        tenantCfg = {
          username:       school.epresensi_username || localCfg.username || '',
          password:       school.epresensi_password || localCfg.password || '',
          cookie:         localCfg.cookie || '',
          cookieExpiry:   localCfg.cookieExpiry || null,
          fonnteToken:    school.fonnte_token || localCfg.fonnteToken || '',
          waGateway:      school.wa_gateway || localCfg.waGateway || 'baileys',
          waNumber:       school.wa_number  || localCfg.waNumber || '',
          unitCode:       school.unit_code  || localCfg.unitCode || 'F208007700',
          opdCode:        school.opd_code   || localCfg.opdCode  || 'F200000000',
          namaSekolah:    school.name       || localCfg.namaSekolah || '',
          schoolId:       school.id,
          plan:           school.plan || 'free',
          authMode:       localCfg.authMode || 'auto',
          // Scheduler config dari school_configs
          schedulerEnabled:       schoolCfg?.scheduler_enabled ?? localCfg.schedulerEnabled ?? true,
          schedulerPagiEnabled:   localCfg.schedulerPagiEnabled !== false,
          schedulerPulangEnabled: localCfg.schedulerPulangEnabled !== false,
          pagiHour:       schoolCfg?.pagi_hour   ?? localCfg.pagiHour   ?? 7,
          pagiMinute:     schoolCfg?.pagi_minute  ?? localCfg.pagiMinute  ?? 30,
          pulangHour:     schoolCfg?.pulang_hour  ?? localCfg.pulangHour  ?? 18,
          pulangMinute:   schoolCfg?.pulang_minute ?? localCfg.pulangMinute ?? 0,
          // Pesan dari school_configs atau local fallback
          messagePagi:        schoolCfg?.message_pagi        || localCfg.messagePagi || '',
          messagePagiSudah:   schoolCfg?.message_pagi_sudah  || localCfg.messagePagiSudah || '',
          messagePulang:      schoolCfg?.message_pulang       || localCfg.messagePulang || '',
          messagePulangSudah: schoolCfg?.message_pulang_sudah || localCfg.messagePulangSudah || '',
          message:            localCfg.message || '',
        };
      }
    }

    req.tenantCfg = tenantCfg;

    // Simpan ke cache selama 60 detik
    authCache.set(token, {
      userId: data.user.id,
      role: req.userRole,
      schoolId: req.schoolId,
      tenantCfg,
      expiresAt: Date.now() + 60_000
    });

  } catch(e) {
    console.error('[Auth] Error fetching tenant config:', e.message);
  }

  next();
}

// 5. Global API Gateway Protection
app.use('/api', (req, res, next) => {
  // Whitelist public endpoints (login, status health check, graph stats)
  if (
    req.path === '/auth/app-login' ||
    req.path === '/status' ||
    req.path === '/graph/stats'
  ) {
    return next();
  }
  return requireAppAuth(req, res, next);
});

const upload = multer({ storage: multer.memoryStorage() });

// ─── Storage Files & Folders ──────────────────────────────────────────────────
const CONFIG_FILE      = path.join(__dirname, 'config.json');
const LOG_FILE         = path.join(__dirname, 'logs.json');
const RECIPIENTS_FILE  = path.join(__dirname, 'recipients.json');
const GRAPH_FILE       = path.join(__dirname, 'graphify-out', 'graph.json');
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

// ─── Config (with Safe Atomic Storage & Environment Fallbacks) ─────────────────
function loadConfig() {
  let data = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading config.json:', e.message);
    }
  }

  // Priority: process.env > saved config.json > defaults
  const username    = process.env.EPRESENSI_USERNAME || data.username || '';
  const password    = process.env.EPRESENSI_PASSWORD || data.password || '';
  const fonnteToken = process.env.FONNTE_TOKEN       || data.fonnteToken || '';
  const appPassword = process.env.APP_PASSWORD       || data.appPassword || 'SMK3magelang';
  const waNumber    = process.env.WA_NUMBER          || data.waNumber || '';

  return {
    authMode: data.authMode || 'auto',
    username,
    password,
    cookie: data.cookie || '',
    cookieExpiry: data.cookieExpiry || null,
    fonnteToken,
    waGateway: data.waGateway || 'baileys',
    waNumber,
    schedulerEnabled: data.schedulerEnabled !== false,
    schedulerPagiEnabled: data.schedulerPagiEnabled !== false,
    pagiHour: data.pagiHour ?? 7,
    pagiMinute: data.pagiMinute ?? 30,
    schedulerPulangEnabled: data.schedulerPulangEnabled !== false,
    pulangHour: data.pulangHour ?? 18,
    pulangMinute: data.pulangMinute ?? 0,
    messagePagi: data.messagePagi || 'Halo *{nama}*! 👋\n\nPengingat presensi pagi:\nAnda tercatat belum melakukan *absen pagi / masuk* hari ini di ePresensi Jateng.\n\nSegera lakukan presensi masuk sekarang ya! ⏰\n\n_Pesan otomatis ePresensi_',
    messagePagiSudah: data.messagePagiSudah || 'Halo *{nama}*! 👋\n\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pagi / masuk hari ini di ePresensi Jateng. Selamat bertugas! 🏢✨\n\n_Pesan otomatis ePresensi_',
    messagePulang: data.messagePulang || 'Halo *{nama}*! 👋\n\nPengingat presensi pulang:\nAnda tercatat belum melakukan *absen pulang* hari ini di ePresensi Jateng.\n\nJangan lupa lakukan presensi pulang sebelum batas waktu berakhir! 🏢⏰\n\n_Pesan otomatis ePresensi_',
    messagePulangSudah: data.messagePulangSudah || 'Halo *{nama}*! 👋\n\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pulang hari ini di ePresensi Jateng. Selamat beristirahat! 🏡✨\n\n_Pesan otomatis ePresensi_',
    message: data.message || 'Halo *{nama}*! 👋\n\nPengingat presensi:\nAnda belum melakukan *absen* hari ini di ePresensi Jateng. Segera absen sekarang! ⏰',
    appPassword,
    namaSekolah: data.namaSekolah || 'SMKN 3 MAGELANG',
    unitCode: data.unitCode || 'F208007700',
    opdCode: data.opdCode || 'F200000000',
    namaUser: data.namaUser || '',
    accounts: Array.isArray(data.accounts) ? data.accounts : []
  };
}

function saveConfig(cfg) {
  try {
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tempFile, CONFIG_FILE);
  } catch (e) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  }
}

// ─── Logs (Safe Atomic Storage) ───────────────────────────────────────────────
function loadLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function addLog(entry) {
  try {
    const logs = loadLogs();
    logs.unshift({ ...entry, timestamp: new Date().toISOString() });
    if (logs.length > 200) logs.splice(200);
    const tempFile = `${LOG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(logs, null, 2), 'utf8');
    fs.renameSync(tempFile, LOG_FILE);
  } catch (e) {
    console.error('Error saving log:', e.message);
  }
}

// ─── Recipients (Safe Atomic Storage) ─────────────────────────────────────────
function loadRecipients() {
  if (!fs.existsSync(RECIPIENTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RECIPIENTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveRecipients(list) {
  try {
    const tempFile = `${RECIPIENTS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tempFile, RECIPIENTS_FILE);
  } catch (e) {
    fs.writeFileSync(RECIPIENTS_FILE, JSON.stringify(list, null, 2), 'utf8');
  }
}

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
  
  const $ = cheerio.load(html);
  const satuVal = $('input[name="satu"]').val();
  const duaVal  = $('input[name="dua"]').val();
  
  const satuMatch = html.match(/name=["']satu["'][^>]*value=["'](\d+)["']/) || html.match(/value=["'](\d+)["'][^>]*name=["']satu["']/);
  const duaMatch  = html.match(/name=["']dua["'][^>]*value=["'](\d+)["']/)  || html.match(/value=["'](\d+)["'][^>]*name=["']dua["']/);

  const satu = satuVal ? parseInt(satuVal) : (satuMatch ? parseInt(satuMatch[1]) : 2);
  const dua  = duaVal  ? parseInt(duaVal)  : (duaMatch  ? parseInt(duaMatch[1])  : 3);

  return { html, cookies, satu, dua };
}

async function detectSchoolProfile(cookie) {
  try {
    const res = await fetch(`${BASE_URL}/v3/data_v4`, {
      headers: { ...HEADERS_BASE, Cookie: cookie }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    let nama = '';
    let nip = '';
    let namaSekolah = 'SMKN 3 MAGELANG';

    $('tr').each((_, el) => {
      const text = $(el).text();
      if (/Nama Lengkap/i.test(text)) {
        nama = $(el).find('td').last().text().replace(/^:\s*/, '').trim();
      } else if (/NIP/i.test(text)) {
        const td = $(el).find('td').last().text().replace(/^:\s*/, '').trim();
        const m = td.match(/(\d{18})/);
        if (m) nip = m[1];
      } else if (/Unit Kerja/i.test(text)) {
        namaSekolah = $(el).find('td').last().text().replace(/^:\s*/, '').trim() || 'SMKN 3 MAGELANG';
      }
    });

    const opdInputVal  = $('input[name="opd"]').val();
    const unitInputVal = $('input[name="unit"]').val();

    return {
      nama: nama || '',
      nip: nip || '',
      namaSekolah: namaSekolah || 'SMKN 3 MAGELANG',
      opdCode: String(opdInputVal || 'F200000000').trim(),
      unitCode: String(unitInputVal || 'F208007700').trim()
    };
  } catch (e) {
    console.error('Error detectSchoolProfile:', e);
    return null;
  }
}

async function saveSessionAndReturn(username, cookies) {
  const expiry = new Date(); expiry.setHours(expiry.getHours() + 8);
  const cfg = loadConfig(); 
  cfg.cookie = cookies; 
  cfg.cookieExpiry = expiry.toISOString();

  const profile = await detectSchoolProfile(cookies);
  if (profile) {
    cfg.namaSekolah = profile.namaSekolah || cfg.namaSekolah || 'SMKN 3 MAGELANG';
    cfg.unitCode = profile.unitCode || cfg.unitCode || 'F208007700';
    cfg.opdCode = profile.opdCode || cfg.opdCode || 'F200000000';
    cfg.namaUser = profile.nama || cfg.namaUser || '';

    // Manage accounts array
    if (!cfg.accounts) cfg.accounts = [];
    const accIdx = cfg.accounts.findIndex(a => a.username === username);
    const accData = {
      id: username,
      username,
      password: cfg.password || '',
      namaUser: profile.nama || username,
      namaSekolah: profile.namaSekolah || 'Unit Sekolah',
      unitCode: profile.unitCode || 'F208007700',
      opdCode: profile.opdCode || 'F200000000',
      lastLogin: new Date().toISOString()
    };
    if (accIdx >= 0) {
      cfg.accounts[accIdx] = { ...cfg.accounts[accIdx], ...accData };
    } else {
      cfg.accounts.push(accData);
    }
  }

  saveConfig(cfg);
  colleagueCache = {}; // Reset colleague cache on switch
  addLog({ type: 'info', message: `✅ Login berhasil sebagai ${username} (${cfg.namaSekolah || 'Sekolah'})` });
  console.log(`[Auth] ✅ Login berhasil! Sekolah: ${cfg.namaSekolah || '-'}`);
  return { success: true, cookie: cookies, expiry: expiry.toISOString(), profile };
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
        if (res.status === 200) {
          const bodyHtml = await res.text();
          // Pastikan bukan redirect ke halaman login
          if (!bodyHtml.includes('portal/auth') && !bodyHtml.includes('name="password"') && !bodyHtml.includes('name="jawaban"')) {
            return { success: true, cookie: config.cookie };
          }
        }
      } catch(e) {}
    }
    addLog({ type: 'info', message: '🔄 Sesi ePresensi kedaluwarsa, melakukan re-login otomatis...' });
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
    return { success: false, error: `Gagal cek presensi: ${err.message}` };
  }
}

function parseAttendanceHTML(html) {
  const today  = new Date();
  const dayOfMonth = today.getDate();
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  const result = {
    date: `${dayOfMonth} ${months[today.getMonth()]} ${today.getFullYear()}`,
    hasAbsenPagi: false, hasAbsenPulang: false, status: 'Belum Absen',
    jamMasuk: null, jamPulang: null, rawIndicators: {}
  };

  const $ = cheerio.load(html);
  const rows = $('tbody tr');
  if (rows.length === 0) {
    result.status = 'Tidak Ada Baris';
    return result;
  }

  const targetRow = rows.eq(dayOfMonth - 1).length ? rows.eq(dayOfMonth - 1) : rows.first();
  const cols = [];
  targetRow.find('th, td').each((_, el) => {
    cols.push($(el).text().trim());
  });

  const rawTanggal = cols[0] || '';
  const rawMasuk   = cols[1] || '-';
  const rawPulang  = cols[2] || '-';
  const rawStatus  = (cols[3] || '').trim().toUpperCase();

  const jamMasukMatch = rawMasuk.match(/^(\d{2}:\d{2})/);
  if (jamMasukMatch && rawMasuk !== '-') {
    result.jamMasuk     = jamMasukMatch[1];
    result.hasAbsenPagi = true;
    result.status       = 'Hadir';
  } else {
    result.hasAbsenPagi = false;
  }

  const jamPulangMatch = rawPulang.match(/^(\d{2}:\d{2})/);
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

  result.rawIndicators = { dayOfMonth, targetRowIdx: dayOfMonth - 1, totalRows: rows.length, rawTanggal, rawMasuk, rawPulang, rawStatus, cols };
  return result;
}

// ─── Colleague Cache Layer (5 Menit TTL) ──────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
let colleagueCache = {};

async function fetchColleaguesAttendance(cookie, targetDay = null, targetMonth = null, targetYear = null, forceRefresh = false, retryCount = 0) {
  const cfg   = loadConfig();
  const now   = new Date();
  const day   = targetDay   ? parseInt(targetDay)   : now.getDate();
  const month = targetMonth ? String(targetMonth).padStart(2,'0') : String(now.getMonth() + 1).padStart(2,'0');
  const year  = targetYear  ? String(targetYear)  : String(now.getFullYear());
  const dayISO = `${year}-${month}-${String(day).padStart(2,'0')}`;
  
  const opdCode = cfg.opdCode || 'F200000000';
  const unitCode = cfg.unitCode || 'F208007700';
  const cacheKey = `${unitCode}_${year}-${month}-${day}`;

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
  formData.append('opd', opdCode);
  formData.append('unit', unitCode);
  formData.append('rl', '100'); // 100 baris (jika pakai 9999 server epresensi error/hanya memunculkan 1 nama)
  formData.append('bulan', month);
  formData.append('tahun', year);
  formData.append('nip', '');

  let res;
  try {
    res = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
      method: 'POST',
      headers: {
        ...HEADERS_BASE,
        'Cookie': cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/v3/data_v4`
      },
      body: formData.toString()
    });
  } catch (err) {
    return { success: false, error: `Koneksi gagal: ${err.message}` };
  }

  if (!res.ok) {
    if ((res.status === 301 || res.status === 302 || res.status === 401 || res.status === 403) && retryCount === 0) {
      console.log('[Colleagues] Sesi ePresensi expired (HTTP ' + res.status + '), mencoba re-login...');
      const fresh = await ensureValidSession(true);
      if (fresh.success && fresh.cookie) {
        return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
      }
    }
    return { success: false, error: `HTTP ${res.status} dari portal ePresensi` };
  }

  const html = await res.text();

  // Deteksi jika respon berupa form login ePresensi
  const isLoginPage = html.includes('name="password"') || html.includes('portal/auth') || html.includes('name="jawaban"');
  if (isLoginPage && retryCount === 0) {
    console.log('[Colleagues] Sesi ePresensi expired (halaman login terdeteksi), mencoba re-login otomatis...');
    const fresh = await ensureValidSession(true);
    if (fresh.success && fresh.cookie) {
      return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
    }
  }

  const $ = cheerio.load(html);
  const tables = $('table');

  // Cari tabel dengan baris terbanyak (tabel data unit biasanya memiliki puluhan baris)
  let targetTable = null;
  let maxRows = 0;

  tables.each((_, tbl) => {
    const rowCount = $(tbl).find('tr').length;
    if (rowCount > maxRows) {
      maxRows = rowCount;
      targetTable = $(tbl);
    }
  });

  if (!targetTable || maxRows < 2) {
    if (retryCount === 0) {
      console.log('[Colleagues] Tabel data belum ditemukan, mencoba re-login...');
      const fresh = await ensureValidSession(true);
      if (fresh.success && fresh.cookie) {
        return await fetchColleaguesAttendance(fresh.cookie, targetDay, targetMonth, targetYear, true, 1);
      }
    }
    return {
      success: false,
      error: 'Tabel data unit kerja tidak ditemukan. Pastikan akun ePresensi aktif dan memiliki hak akses OPD/Unit sekolah.'
    };
  }

  const rows = targetTable.find('tr');
  const colleagues = [];

  const dateObj  = new Date(parseInt(year), parseInt(month) - 1, day);
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const namaHari = dayNames[dateObj.getDay()];
  const isWeekend = (namaHari === 'Sabtu' || namaHari === 'Minggu');
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

  rows.each((i, rowEl) => {
    if (i === 0) return; // skip header row
    const cells = $(rowEl).find('td');
    if (cells.length < 2) return;

    const rowHtml = $(rowEl).html() || '';
    const rowText = $(rowEl).text();

    // ── Robust NIP + Nama Extraction ──────────────────────────────────────────
    // Strategy: scan all early cells (0-4) for an 18-digit NIP, then derive name
    let nip  = '';
    let nama = '';
    let nipCellIdx = -1;

    for (let ci = 0; ci <= Math.min(4, cells.length - 1); ci++) {
      const cellText = cells.eq(ci).text().replace(/'/g, '').trim();
      const nipM = cellText.match(/(\d{18})/);
      if (nipM) {
        nip = nipM[1];
        nipCellIdx = ci;
        // Name might be in same cell (after removing NIP) OR in next cell
        const sameCell = cellText.replace(nip, '').replace(/[:\s]+/g, ' ').trim();
        if (sameCell && sameCell.length > 2) {
          nama = sameCell;
        } else if (ci + 1 < cells.length) {
          nama = cells.eq(ci + 1).text().replace(/[:\s]+/g, ' ').trim();
        }
        break;
      }
    }

    // If NIP not found at all → likely not a data row (could be sub-header), skip
    if (!nip) {
      // One last try: check if entire row has an 18-digit number
      const globalNip = rowText.match(/(\d{18})/);
      if (!globalNip) return;
      nip = globalNip[1];
    }

    // Fallback: derive name from cells if still empty
    if (!nama) {
      for (let ci = 0; ci < cells.length; ci++) {
        if (ci === nipCellIdx) continue;
        const t = cells.eq(ci).text().replace(/[:\s]+/g, ' ').trim();
        // Accept as name if it contains letters and is not a number sequence
        if (t && t.length > 3 && /[A-Za-z]/.test(t) && !/^\d+$/.test(t)) {
          nama = t;
          break;
        }
      }
    }

    const no = cells.eq(0).text().trim();

    // ── Build complete 1-Month attendance history for this teacher ────────────
    const history = [];
    let totalHadir = 0, totalIzin = 0, totalSakit = 0, totalBelum = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr        = String(d).padStart(2, '0');
      const curDateISO  = `${year}-${month}-${dStr}`;
      const curDateObj  = new Date(parseInt(year), parseInt(month) - 1, d);
      const curDayName  = dayNames[curDateObj.getDay()];
      const isCurWeekend = (curDayName === 'Sabtu' || curDayName === 'Minggu');

      // Look for timestamps tied to this specific date in row HTML
      const tsRegex = new RegExp(`${curDateISO}[^"]*?\\s+(\\d{2}:\\d{2})(?::\\d{2})?`, 'g');
      const matches = [...rowHtml.matchAll(tsRegex)].map(m => m[1]);

      // Also try plain HH:MM pattern via title/data attributes for this date
      const attrRegex = new RegExp(`(?:title|data-[^=]*)=["'][^"']*${curDateISO}[^"']*?(\\d{2}:\\d{2})`, 'gi');
      const attrMatches = [...rowHtml.matchAll(attrRegex)].map(m => m[1]);
      const allMatches = [...new Set([...matches, ...attrMatches])].filter(Boolean);

      let curJamMasuk  = '-';
      let curJamPulang = '-';
      let curStatus    = isCurWeekend ? 'Libur (OFF)' : (d > now.getDate() && parseInt(month) === (now.getMonth() + 1) ? 'Belum Jadwal' : 'Belum Absen');
      let curIsHadir   = false;

      // Assign timestamps if found
      if (allMatches.length > 0) {
        allMatches.sort();
        curJamMasuk  = allMatches[0];
        curJamPulang = allMatches.length > 1 ? allMatches[allMatches.length - 1] : '-';
      }

      // Find the explicit status code from the hidden input for this date:
      // id="202608_199012222014022002-s_10"
      const statusInputId = `${year}${month}_${nip}-s_${dStr}`;
      const statusRegex = new RegExp(`id=["']${statusInputId}["'][^>]*value=["']([^"']+)["']`, 'i');
      const statusMatch = rowHtml.match(statusRegex);

      if (statusMatch) {
        const code = statusMatch[1].toUpperCase();
        
        if (['H', 'T', 'TAM', 'TAP', 'HB'].includes(code)) {
          curStatus = (code === 'T' || code === 'TAM' || code === 'TAP') ? 'Terlambat' : 'Hadir';
          curIsHadir = true;
          totalHadir++;
        } else if (code === 'HBN') {
          // HBN = Hari Besar Nasional
          curStatus = 'Libur (Hari Besar Nasional)';
        } else if (code === 'CS' || code === 'S') {
          curStatus = 'Sakit';
          totalSakit++;
        } else if (code.startsWith('C') || code === 'I' || code === 'DL' || code === 'TL') {
          if (code === 'DL') curStatus = 'Dinas Luar';
          else if (code === 'TL') curStatus = 'Tugas Luar';
          else if (code === 'I') curStatus = 'Izin';
          else curStatus = 'Cuti';
          totalIzin++;
        } else if (code === 'OFF') {
          curStatus = 'Libur (OFF)';
        } else if (code === 'A' || code === 'HAPUS') {
          // Alpha / Belum Absen
          curStatus = 'Belum Absen';
          // Only count as Belum Absen if it's past or today
          if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) {
            totalBelum++;
          }
        }
      } else {
        // Fallback if hidden input not found
        if (allMatches.length > 0) {
          curStatus = 'Hadir';
          curIsHadir = true;
          totalHadir++;
        } else if (!isCurWeekend) {
          if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) {
            totalBelum++;
          }
        }
      }

      history.push({
        tanggal: d,
        tanggalLengkap: `${d}/${month}/${year}`,
        hari: curDayName,
        isWeekend: isCurWeekend,
        isToday: (d === now.getDate() && parseInt(month) === (now.getMonth() + 1)),
        isPast:   (d < now.getDate()  && parseInt(month) === (now.getMonth() + 1)),
        isFuture: (d > now.getDate()  && parseInt(month) === (now.getMonth() + 1)),
        jamMasuk:  curJamMasuk,
        jamPulang: curJamPulang,
        status:    curStatus,
        isHadir:   curIsHadir
      });
    }

    // Get specific stats for target day (e.g. today or selected day)
    const targetEntry = history.find(h => h.tanggal === day) || {};
    const jamMasuk  = targetEntry.jamMasuk  !== '-' ? targetEntry.jamMasuk  : null;
    const jamPulang = targetEntry.jamPulang !== '-' ? targetEntry.jamPulang : null;
    const statusText = targetEntry.status || 'Belum Absen';
    const isHadir    = !!targetEntry.isHadir;

    colleagues.push({
      no: parseInt(no) || i,
      nip,
      nama,
      jamMasuk,
      jamPulang,
      status: statusText,
      isHadir,
      monthHistory: {
        month,
        year,
        totalHadir,
        totalIzin,
        totalSakit,
        totalBelum,
        history
      }
    });
  });

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

// ─── API: Debug – Raw HTML from ePresensi (inspect table structure) ───────────
app.get('/api/colleagues/debug-html', async (req, res) => {
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error });

  const cfg   = loadConfig();
  const now   = new Date();
  const month = String(req.query.month || (now.getMonth() + 1)).padStart(2, '0');
  const year  = String(req.query.year  || now.getFullYear());
  const formData = new URLSearchParams({
    opd: cfg.opdCode || 'F200000000',
    unit: cfg.unitCode || 'F208007700',
    rl: '88',
    bulan: month,
    tahun: year,
    nip: ''
  });

  try {
    const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
      method: 'POST',
      headers: { ...HEADERS_BASE, Cookie: session.cookie, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE_URL}/v3/data_v4` },
      body: formData.toString()
    });
    const html = await r.text();
    const $ = cheerio.load(html);
    const tables = $('table');
    const tableCount = tables.length;

    // Extract first 3 rows of each table for inspection
    const tablesSummary = [];
    tables.each((tIdx, tbl) => {
      const rows = $(tbl).find('tr');
      const rowsSample = [];
      rows.each((rIdx, row) => {
        if (rIdx > 2) return false;
        const cells = $(row).find('td, th');
        const cellTexts = [];
        cells.each((cIdx, cell) => {
          if (cIdx > 8) return false;
          cellTexts.push($(cell).text().trim().slice(0, 80));
        });
        rowsSample.push({ rowIdx: rIdx, cells: cellTexts });
      });
      tablesSummary.push({ tableIdx: tIdx, rowCount: rows.length, rowsSample });
    });

    // Also return first 2000 chars of raw HTML for inspection
    res.json({
      success: true,
      status: r.status,
      tableCount,
      tables: tablesSummary,
      rawHtmlSnippet: html.slice(0, 3000)
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Colleague 1-Month Detail History (Instant from Preloaded Cache) ─────────
app.get('/api/colleagues/:nip/history', async (req, res) => {
  const targetNip = req.params.nip.replace(/'/g, '').trim();
  const now       = new Date();
  const month     = req.query.month ? String(req.query.month).padStart(2,'0') : String(now.getMonth() + 1).padStart(2,'0');
  const year      = req.query.year  ? String(req.query.year)  : String(now.getFullYear());
  const cfg       = loadConfig();
  const unitCode  = cfg.unitCode || 'F208007700';

  // 1. Fast path: check in-memory colleague cache
  for (const key in colleagueCache) {
    if (key.startsWith(unitCode) && colleagueCache[key].data && colleagueCache[key].data.colleagues) {
      const found = colleagueCache[key].data.colleagues.find(c => c.nip === targetNip);
      if (found && found.monthHistory) {
        return res.json({
          success: true,
          nip: targetNip,
          nama: found.nama,
          fromCache: true,
          ...found.monthHistory
        });
      }
    }
  }

  // 2. If not found in cache, ensure valid session and fetch full colleagues list
  const session = await ensureValidSession();
  if (!session.success) return res.json({ success: false, error: session.error, needLogin: true });

  try {
    const result = await fetchColleaguesAttendance(session.cookie, now.getDate(), month, year, true);
    if (result.success && result.colleagues) {
      const found = result.colleagues.find(c => c.nip === targetNip);
      if (found && found.monthHistory) {
        return res.json({
          success: true,
          nip: targetNip,
          nama: found.nama,
          fromCache: false,
          ...found.monthHistory
        });
      }
    }
    res.json({ success: false, error: 'Data guru tidak ditemukan.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── WhatsApp Sending Gateway (Dual: Baileys Scan QR & Fonnte API) ───────────
async function sendWhatsApp(targetOrToken, messageOrTarget, tokenOrMessage = null) {
  // Support both (target, message, tokenOverride) and (token, target, message)
  let target, message, tokenOverride;
  if (tokenOrMessage && typeof tokenOrMessage === 'string' && (messageOrTarget.match(/^[0-9+]+$/) || messageOrTarget.includes('@'))) {
    // Called as (token, target, message)
    tokenOverride = targetOrToken;
    target = messageOrTarget;
    message = tokenOrMessage;
  } else {
    target = targetOrToken;
    message = messageOrTarget;
    tokenOverride = tokenOrMessage;
  }

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

// ─── Shared Scheduler Logic (Reusable for cron & manual trigger) ─────────────
async function runSchedulerLogic(type = 'pagi') {
  const config = loadConfig();
  const gateway = config.waGateway || 'baileys';
  if (gateway !== 'fonnte' && !waSock) {
    throw new Error('WhatsApp Web belum terhubung. Scan QR Code terlebih dahulu.');
  }
  if (gateway === 'fonnte' && !config.fonnteToken) {
    throw new Error('Token Fonnte belum dikonfigurasi.');
  }

  const session = await ensureValidSession();
  if (!session.success) throw new Error('Gagal login ke ePresensi. Cek konfigurasi akun.');

  const day = new Date().getDate();
  const colleaguesRes = await fetchColleaguesAttendance(session.cookie, day, null, null, true);
  if (!colleaguesRes.success) throw new Error('Gagal mengambil data presensi rekan guru.');

  // Ambil semua guru yang tidak sedang libur/cuti
  let targets_raw = colleaguesRes.colleagues.filter(c => !c.status.includes('Libur'));
  let labelWaktu = type === 'pagi' ? '🌅 Pagi' : '🌆 Pulang';

  if (targets_raw.length === 0) {
    const msg = `${labelWaktu}: Tidak ada guru target (semua libur).`;
    addLog({ type: 'info', message: msg });
    return { success: true, sent: 0, total: 0, message: msg };
  }

  const registered = loadRecipients().filter(r => r.aktif !== false);
  const targets = [];
  for (const guru of targets_raw) {
    const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = registered.find(r => {
      const cleanR = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru);
    });
    if (found && found.nomor) {
      targets.push({ 
        nama: guru.nama, 
        nomor: found.nomor,
        isHadir: type === 'pagi' ? guru.isHadir : !!guru.jamPulang
      });
    }
  }

  if (targets.length === 0) {
    const msg = `${labelWaktu}: Ada ${targets_raw.length} guru target, tapi nomor WA belum terdaftar di sistem.`;
    addLog({ type: 'info', message: msg });
    return { success: true, sent: 0, total: 0, message: msg };
  }

  let sentCount = 0;
  const defaultMsgPagiSudah = "Halo *{nama}*! 👋\n\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pagi / masuk hari ini di ePresensi Jateng. Selamat bertugas! 🏢✨\n\n_Pesan otomatis ePresensi_";
  const defaultMsgPulangSudah = "Halo *{nama}*! 👋\n\nTerima kasih, Anda tercatat *SUDAH* melakukan presensi pulang hari ini di ePresensi Jateng. Selamat beristirahat! 🏡✨\n\n_Pesan otomatis ePresensi_";

  const msgPagiSudah   = config.messagePagiSudah   || defaultMsgPagiSudah;
  const msgPulangSudah = config.messagePulangSudah  || defaultMsgPulangSudah;
  const msgBelumPagi   = config.messagePagi   || config.message;
  const msgBelumPulang = config.messagePulang || config.message;

  const logsArr = [];
  for (const t of targets) {
    let template = '';
    if (type === 'pagi')   template = t.isHadir ? msgPagiSudah   : msgBelumPagi;
    else                   template = t.isHadir ? msgPulangSudah  : msgBelumPulang;
    const msg = template.replace(/\{nama\}/gi, t.nama);
    const sRes = await sendWhatsApp(config.fonnteToken, t.nomor, msg);
    if (sRes.success) { sentCount++; logsArr.push({ nama: t.nama, nomor: t.nomor, text: msg }); }
    await new Promise(r => setTimeout(r, 1000));
  }

  const summaryMsg = `${labelWaktu}: Notifikasi WA terkirim ke ${sentCount}/${targets.length} guru (Laporan Status).`;
  addLog({ type: sentCount > 0 ? 'sent' : 'error', message: summaryMsg, detailMessage: 'Menjalankan pengiriman laporan ke semua guru.', targets: logsArr });
  return { success: true, sent: sentCount, total: targets.length, message: summaryMsg };
}

// ─── Scheduler (Master 1-Menit, Multi-Tenant, Cache 5 Menit) ──────────────────
let masterCron = null;
let schoolsCache = null;        // cache hasil query Supabase
let schoolsCacheExpiry = 0;     // timestamp expiry cache

async function getActiveSchools() {
  // Gunakan cache 5 menit agar tidak query Supabase setiap menit
  if (schoolsCache && Date.now() < schoolsCacheExpiry) {
    return schoolsCache;
  }

  try {
    const { data, error } = await supabase
      .from('school_configs')
      .select(`
        scheduler_enabled, pagi_hour, pagi_minute, pulang_hour, pulang_minute,
        message_pagi, message_pagi_sudah, message_pulang, message_pulang_sudah,
        school_id,
        schools!inner(id, name, epresensi_username, epresensi_password, fonnte_token, wa_gateway, wa_number, unit_code, opd_code, plan)
      `)
      .eq('scheduler_enabled', true);

    if (!error && data && data.length > 0) {
      schoolsCache = data;
      schoolsCacheExpiry = Date.now() + 5 * 60_000; // cache 5 menit
      return data;
    }
  } catch(e) {
    console.error('[Scheduler] Gagal ambil data sekolah dari Supabase:', e.message);
  }

  // Fallback: pakai config.json lokal (single-tenant)
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

function buildTenantCfg(row) {
  const s   = row.schools;
  const loc = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); } catch(e) { return {}; } })();
  return {
    username:           s.epresensi_username || loc.username || '',
    password:           s.epresensi_password || loc.password || '',
    cookie:             loc.cookie || '',
    cookieExpiry:       loc.cookieExpiry || null,
    fonnteToken:        s.fonnte_token   || loc.fonnteToken || '',
    waGateway:          s.wa_gateway     || loc.waGateway   || 'baileys',
    waNumber:           s.wa_number      || loc.waNumber    || '',
    unitCode:           s.unit_code      || loc.unitCode    || 'F208007700',
    opdCode:            s.opd_code       || loc.opdCode     || 'F200000000',
    namaSekolah:        s.name           || loc.namaSekolah || '',
    schoolId:           s.id,
    plan:               s.plan || 'free',
    authMode:           loc.authMode || 'auto',
    schedulerEnabled:        true,
    schedulerPagiEnabled:    true,
    schedulerPulangEnabled:  true,
    pagiHour:    row.pagi_hour   ?? 7,
    pagiMinute:  row.pagi_minute ?? 30,
    pulangHour:  row.pulang_hour  ?? 18,
    pulangMinute: row.pulang_minute ?? 0,
    messagePagi:        row.message_pagi        || loc.messagePagi        || '',
    messagePagiSudah:   row.message_pagi_sudah  || loc.messagePagiSudah  || '',
    messagePulang:      row.message_pulang       || loc.messagePulang      || '',
    messagePulangSudah: row.message_pulang_sudah || loc.messagePulangSudah || '',
    message:            loc.message || '',
  };
}

function setupScheduler() {
  if (masterCron) { masterCron.stop(); masterCron = null; }

  masterCron = cron.schedule('* * * * *', async () => {
    const now = new Date();
    const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const H = wib.getHours();
    const M = wib.getMinutes();

    const schools = await getActiveSchools();
    if (!schools.length) return;

    for (const row of schools) {
      const cfg = buildTenantCfg(row);

      // Cek jadwal Pagi
      if (H === cfg.pagiHour && M === cfg.pagiMinute) {
        console.log(`[Scheduler 🌅 Pagi] ${cfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
        runSchedulerLogic('pagi', cfg).catch(e =>
          console.error(`[Scheduler] Pagi error (${cfg.namaSekolah}):`, e.message)
        );
      }

      // Cek jadwal Pulang
      if (H === cfg.pulangHour && M === cfg.pulangMinute) {
        console.log(`[Scheduler 🌆 Pulang] ${cfg.namaSekolah} — ${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')} WIB`);
        runSchedulerLogic('pulang', cfg).catch(e =>
          console.error(`[Scheduler] Pulang error (${cfg.namaSekolah}):`, e.message)
        );
      }
    }
  });

  console.log('[Scheduler] Master Multi-Tenant Cron aktif (setiap 1 menit, cache Supabase 5 menit)');
}
setupScheduler();

// ─── Super Admin API ───────────────────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Akses ditolak: hanya Super Admin.' });
  }
  next();
}

// GET semua sekolah
app.get('/api/admin/schools', requireSuperAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('schools')
    .select('*, school_configs(*), subscriptions(*)')
    .order('created_at', { ascending: false });
  if (error) return res.json({ success: false, error: error.message });
  res.json({ success: true, schools: data });
});

// POST tambah sekolah baru + buat user Supabase Auth + assign role
app.post('/api/admin/schools', requireSuperAdmin, async (req, res) => {
  const { name, npsn, email, password, plan,
          epresensi_username, epresensi_password,
          wa_gateway, fonnte_token, wa_number,
          unit_code, opd_code,
          pagi_hour, pagi_minute, pulang_hour, pulang_minute } = req.body;

  if (!name || !email || !password) {
    return res.json({ success: false, error: 'name, email, password wajib diisi.' });
  }

  // 1. Buat user Supabase Auth
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  });
  if (authErr) return res.json({ success: false, error: authErr.message });

  // 2. Insert ke tabel schools
  const { data: school, error: schoolErr } = await supabase.from('schools').insert({
    name, npsn, email, plan: plan || 'free',
    epresensi_username, epresensi_password,
    wa_gateway: wa_gateway || 'fonnte', fonnte_token, wa_number,
    unit_code, opd_code
  }).select().single();
  if (schoolErr) return res.json({ success: false, error: schoolErr.message });

  // 3. Insert ke school_configs
  await supabase.from('school_configs').insert({
    school_id: school.id,
    scheduler_enabled: true,
    pagi_hour: pagi_hour ?? 7, pagi_minute: pagi_minute ?? 30,
    pulang_hour: pulang_hour ?? 18, pulang_minute: pulang_minute ?? 0
  });

  // 4. Assign role school_admin
  await supabase.from('user_roles').insert({
    user_id: authData.user.id,
    role: 'school_admin',
    school_id: school.id
  });

  // Invalidate schools cache agar scheduler langsung pakai data baru
  schoolsCache = null;

  res.json({ success: true, school, userId: authData.user.id });
});

// PUT update data sekolah
app.put('/api/admin/schools/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const allowed = ['name','npsn','plan','epresensi_username','epresensi_password',
                   'wa_gateway','fonnte_token','wa_number','unit_code','opd_code'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];

  const { data, error } = await supabase.from('schools').update(updates).eq('id', id).select().single();
  if (error) return res.json({ success: false, error: error.message });

  // Update school_configs jika ada jadwal
  const cfgUpdates = {};
  ['scheduler_enabled','pagi_hour','pagi_minute','pulang_hour','pulang_minute',
   'message_pagi','message_pagi_sudah','message_pulang','message_pulang_sudah']
    .forEach(k => { if (req.body[k] !== undefined) cfgUpdates[k] = req.body[k]; });

  if (Object.keys(cfgUpdates).length > 0) {
    await supabase.from('school_configs').update(cfgUpdates).eq('school_id', id);
  }

  // Invalidate caches
  schoolsCache = null;
  for (const [key, val] of authCache.entries()) {
    if (val.schoolId === id) authCache.delete(key);
  }

  res.json({ success: true, school: data });
});

// DELETE hapus sekolah
app.delete('/api/admin/schools/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('schools').delete().eq('id', id);
  if (error) return res.json({ success: false, error: error.message });
  schoolsCache = null;
  res.json({ success: true });
});

// GET stats ringkas untuk Super Admin dashboard
app.get('/api/admin/stats', requireSuperAdmin, async (req, res) => {
  const [{ count: totalSchools }, { count: freeSchools }, { count: proSchools }] = await Promise.all([
    supabase.from('schools').select('*', { count: 'exact', head: true }),
    supabase.from('schools').select('*', { count: 'exact', head: true }).eq('plan', 'free'),
    supabase.from('schools').select('*', { count: 'exact', head: true }).eq('plan', 'pro'),
  ]);
  res.json({ success: true, totalSchools, freeSchools, proSchools });
});

// ─── Manual Trigger Scheduler ─────────────────────────────────────────────────
app.post('/api/scheduler/run-now', requireAppAuth, async (req, res) => {
  const type = req.body.type === 'pulang' ? 'pulang' : 'pagi';
  try {
    const result = await runSchedulerLogic(type);
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

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
    detailMessage: template,
    detail: results,
    targets: targets.map(t => ({ nama: t.nama, nomor: t.nomor, text: template.replace(/\{nama\}/gi, t.nama) }))
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
    addLog({
      type: 'sent',
      message: `💬 Kirim Langsung: Notifikasi terkirim ke ${nama || nomor} (${nomor})`,
      detailMessage: finalMsg,
      recipient: { nama: nama || nomor, nomor },
      gateway: result.gateway
    });
  } else {
    addLog({
      type: 'error',
      message: `❌ Gagal Kirim Langsung ke ${nama || nomor}: ${result.error}`,
      detailMessage: finalMsg,
      recipient: { nama: nama || nomor, nomor },
      gateway: result.gateway
    });
  }

  res.json({ success: result.success, error: result.error, data: result.data });
});

// ─── App Gatekeeper Security (Supabase Auth) ───────────────────────────────────
app.post('/api/auth/app-login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email dan password wajib diisi.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      console.error('[Login] Supabase error:', error?.message);
      return res.status(401).json({ success: false, error: 'Email atau password salah. Silakan periksa kembali.' });
    }

    const { data: roleData } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).single();
    
    addLog(null, { type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    
    res.json({ 
      success: true, 
      token: data.session.access_token,
      role: roleData?.role || 'school_admin',
      schoolId: roleData?.school_id || process.env.DEFAULT_SCHOOL_ID
    });
  } catch (err) {
    console.error('[Login] Server error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat login.' });
  }
});


app.post('/api/auth/change-app-password', requireAppAuth, (req, res) => {
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
  const newToken = generateAuthToken(newPassword);
  res.json({ success: true, message: 'Password akses aplikasi berhasil diperbarui!', token: newToken });
});

// ─── Multi-School Account Management ──────────────────────────────────────────
app.get('/api/accounts', (req, res) => {
  const cfg = loadConfig();
  const accounts = (cfg.accounts || []).map(a => ({
    id: a.id || a.username,
    username: a.username,
    namaUser: a.namaUser || a.username,
    namaSekolah: a.namaSekolah || 'Unit Sekolah',
    unitCode: a.unitCode || 'F208007700',
    opdCode: a.opdCode || 'F200000000',
    lastLogin: a.lastLogin,
    isActive: a.username === cfg.username
  }));

  res.json({
    activeAccount: {
      username: cfg.username || '',
      namaUser: cfg.namaUser || '',
      namaSekolah: cfg.namaSekolah || 'SMKN 3 MAGELANG',
      unitCode: cfg.unitCode || 'F208007700'
    },
    accounts
  });
});

app.post('/api/accounts/login', async (req, res) => {
  const { username, password, customSchoolName } = req.body;
  if (!username || !password) {
    return res.json({ success: false, error: 'Username (NIP) dan Password diperlukan.' });
  }

  const loginRes = await doLogin(username.trim(), password.trim());
  if (!loginRes.success) {
    return res.json({ success: false, error: loginRes.error || 'Gagal login ke ePresensi Jateng.' });
  }

  const cfg = loadConfig();
  cfg.username = username.trim();
  cfg.password = password.trim();
  if (customSchoolName && customSchoolName.trim()) {
    cfg.namaSekolah = customSchoolName.trim();
  }

  if (!cfg.accounts) cfg.accounts = [];
  const accIdx = cfg.accounts.findIndex(a => a.username === cfg.username);
  const accData = {
    id: cfg.username,
    username: cfg.username,
    password: cfg.password,
    namaUser: cfg.namaUser || cfg.username,
    namaSekolah: cfg.namaSekolah || customSchoolName || 'Unit Sekolah',
    unitCode: cfg.unitCode || 'F208007700',
    opdCode: cfg.opdCode || 'F200000000',
    lastLogin: new Date().toISOString()
  };

  if (accIdx >= 0) {
    cfg.accounts[accIdx] = { ...cfg.accounts[accIdx], ...accData };
  } else {
    cfg.accounts.push(accData);
  }

  saveConfig(cfg);
  colleagueCache = {};

  addLog({
    type: 'info',
    message: `🏫 Berhasil menambahkan & beralih ke profil: ${cfg.namaSekolah} (${cfg.username})`
  });

  res.json({
    success: true,
    message: `Berhasil login ke ${cfg.namaSekolah}!`,
    account: accData
  });
});

app.post('/api/accounts/switch', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ success: false, error: 'Username akun diperlukan.' });

  const cfg = loadConfig();
  const acc = (cfg.accounts || []).find(a => a.username === username || a.id === username);
  if (!acc) return res.json({ success: false, error: 'Akun sekolah tidak ditemukan di daftar tersimpan.' });

  // Update current active credentials
  cfg.username = acc.username;
  cfg.password = acc.password;
  cfg.namaSekolah = acc.namaSekolah;
  cfg.unitCode = acc.unitCode;
  cfg.opdCode = acc.opdCode;
  cfg.namaUser = acc.namaUser;
  saveConfig(cfg);
  colleagueCache = {}; // Flush cache

  // Re-login to get fresh session cookie
  const loginRes = await doLogin(acc.username, acc.password);
  if (!loginRes.success) {
    return res.json({ success: false, error: `Gagal re-login: ${loginRes.error}` });
  }

  addLog({
    type: 'info',
    message: `🔄 Beralih ke profil sekolah: ${acc.namaSekolah} (${acc.username})`
  });

  res.json({
    success: true,
    message: `Berhasil beralih ke ${acc.namaSekolah}!`,
    account: acc
  });
});

app.delete('/api/accounts/:username', (req, res) => {
  const targetUsername = req.params.username;
  const cfg = loadConfig();
  if (!cfg.accounts) cfg.accounts = [];

  const initialCount = cfg.accounts.length;
  cfg.accounts = cfg.accounts.filter(a => a.username !== targetUsername && a.id !== targetUsername);

  // If the deleted account was the currently active one
  if (cfg.username === targetUsername) {
    if (cfg.accounts.length > 0) {
      // Auto-switch to the first available account
      const fallback = cfg.accounts[0];
      cfg.username = fallback.username;
      cfg.password = fallback.password;
      cfg.namaSekolah = fallback.namaSekolah;
      cfg.unitCode = fallback.unitCode;
      cfg.opdCode = fallback.opdCode;
      cfg.namaUser = fallback.namaUser;
      // Note: session will need to be re-established on next request, 
      // but for now config is safely swapped.
    } else {
      // Log out completely
      cfg.username = '';
      cfg.password = '';
      cfg.namaSekolah = '';
      cfg.unitCode = '';
      cfg.opdCode = '';
      cfg.namaUser = '';
    }
    colleagueCache = {}; // Flush cache
  }

  saveConfig(cfg);
  res.json({ success: true, count: cfg.accounts.length, switched: cfg.username !== targetUsername });
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
    messagePagiSudah: cfg.messagePagiSudah || '',
    messagePulang: cfg.messagePulang || '',
    messagePulangSudah: cfg.messagePulangSudah || '',
  });
});

app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const allowed = [
    'authMode','username','password','cookie','waGateway','fonnteToken','waNumber',
    'schedulerEnabled','schedulerPagiEnabled','pagiHour','pagiMinute',
    'schedulerPulangEnabled','pulangHour','pulangMinute',
    'message','messagePagi','messagePagiSudah','messagePulang','messagePulangSudah','testModeSudahAbsen'
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
    detailMessage: template,
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
      detailMessage: cfg.message,
      detail: sendResult.results,
    });
  }
  res.json({ success: true, attendance: data, waSent: !!sendResult?.success, sendResult, notAbsent: !data.hasAbsenPagi });
});

// ─── Graphify Knowledge Graph Endpoints ───────────────────────────────────────
app.get('/api/graph/stats', (req, res) => {
  try {
    if (!fs.existsSync(GRAPH_FILE)) {
      return res.json({ success: false, error: 'Knowledge graph belum dibuat.' });
    }
    const graphData = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    const nodesCount = graphData.nodes?.length || Object.keys(graphData.nodes || {}).length || 0;
    const edgesCount = graphData.links?.length || graphData.edges?.length || 0;
    
    // Count communities if available
    let communityCount = 0;
    if (graphData.nodes) {
      const comms = new Set();
      const nodeArr = Array.isArray(graphData.nodes) ? graphData.nodes : Object.values(graphData.nodes);
      nodeArr.forEach(n => { if (n.community !== undefined) comms.add(n.community); });
      communityCount = comms.size;
    }

    res.json({
      success: true,
      nodesCount,
      edgesCount,
      communityCount,
      hasGraphHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'graph.html')),
      hasTreeHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'GRAPH_TREE.html')),
      hasCallflowHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'epresensi-jateng-callflow.html')),
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/graph/refresh', (req, res) => {
  const isWindows = process.platform === 'win32';
  const sep = isWindows ? ';' : '&&';
  const cmd = `python -m graphify extract . --code-only ${sep} python -m graphify cluster-only . ${sep} python -m graphify tree ${sep} python -m graphify export callflow-html`;

  exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      addLog({ type: 'error', message: `❌ Gagal update Knowledge Graph: ${error.message}` });
      return res.json({ success: false, error: error.message });
    }

    try {
      const srcDir = path.join(__dirname, 'graphify-out');
      const destDir = path.join(__dirname, 'public', 'graphify-out');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(srcDir, destDir, { recursive: true, force: true });
    } catch (e) {}

    addLog({ type: 'info', message: '🕸️ Knowledge Graph arsitektur berhasil diperbarui.' });
    res.json({ success: true, message: 'Knowledge graph berhasil diperbarui!' });
  });
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
    schedulerActive: masterCron !== null && cfg.schedulerEnabled,
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

// ─── Global Express Error Handler Middleware ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Express Unhandled Error]', err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan internal pada server.',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`
╔════════════════════════════════════════╗
║   ePresensi Notif — Fonnte WA          ║
║   http://localhost:${PORT}                 ║
╚════════════════════════════════════════╝`));
