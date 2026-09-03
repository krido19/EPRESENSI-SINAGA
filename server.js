'use strict';
require('dotenv').config();

// ─── Auto-Timestamp untuk semua log CMD ────────────────────────────────────────
(function patchConsoleWithTimestamp() {
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  function ts() { return new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB'; }
  console.log   = (...a) => _origLog  (`[${ts()}]`, ...a);
  console.warn  = (...a) => _origWarn (`[${ts()}] ⚠️`, ...a);
  console.error = (...a) => _origError(`[${ts()}] ❌`, ...a);
})();

// ─── Global Process Error Handlers (Anti-Crash Guard) ─────────────────────────
process.on('uncaughtException', (err) => { console.error('[CRITICAL] Uncaught Exception:', err.stack || err); });
process.on('unhandledRejection', (reason, promise) => { console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason); });

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { exec }   = require('child_process');
const multer     = require('multer');

// ─── Modules ──────────────────────────────────────────────────────────────────
const { supabase }                               = require('./src/supabase');
const { loadConfig, LOG_FILE }                   = require('./src/config');
const { loadLogs }                               = require('./src/logger');
const { requireAppAuth, authLimiter }            = require('./src/auth');
const { initBaileys, getWaState }                = require('./src/whatsapp');
const { setupScheduler }                         = require('./src/scheduler');

// ─── Routes ───────────────────────────────────────────────────────────────────
const adminRoutes     = require('./src/routes/admin');
const schedulerRoutes = require('./src/routes/scheduler');
const authRoutes      = require('./src/routes/auth');
const apiRoutes       = require('./src/routes/api');
const internalRoutes  = require('./src/routes/internal');

// ─── Server Version ───────────────────────────────────────────────────────────
const SERVER_VERSION = Date.now().toString();
console.log(`[Server] Version token: ${SERVER_VERSION}`);
console.log('[DEBUG INIT] Supabase URL:', process.env.SUPABASE_URL, 'Key Prefix:', (process.env.SUPABASE_SERVICE_ROLE_KEY || '').substring(0, 15));

// ─── Express App ──────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// CORS
const allowedOrigins = ['http://localhost:3000','http://127.0.0.1:3000','http://localhost','http://127.0.0.1'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.includes('.onrender.com') || origin.includes('.up.railway.app') || origin.includes('.koyeb.app') || origin.includes('119.28.100.51') || origin.includes('absen-online.xyz')) return callback(null, true);
    return callback(new Error('CORS Policy: Akses dari domain luar tidak diizinkan.'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/graphify-out', express.static(path.join(__dirname, 'graphify-out')));

// ─── Internal Routes (localhost only, no auth) ───────────────────────────────
app.use('/internal', internalRoutes);

// ─── Global API Auth Guard ────────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  if (['/auth/app-login','/status','/version','/graph/stats'].includes(req.path)) return next();
  return requireAppAuth(req, res, next);
});

// ─── Mount Routes ─────────────────────────────────────────────────────────────
app.use('/api/admin',      adminRoutes);
app.use('/api/scheduler',  schedulerRoutes);
app.use('/api',            authRoutes);
app.use('/api/colleagues', apiRoutes);   // GET /api/colleagues, /api/colleagues/:nip/history
app.use('/api',            apiRoutes);   // POST /api/send-*, /api/check, /api/recipients, dll


// ─── Misc Endpoints ───────────────────────────────────────────────────────────
const GRAPH_FILE = path.join(__dirname, 'graphify-out', 'graph.json');

app.get('/api/graph/stats', (req, res) => {
  try {
    if (!fs.existsSync(GRAPH_FILE)) return res.json({ success: false, error: 'Knowledge graph belum dibuat.' });
    const graphData    = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    const nodesCount   = graphData.nodes?.length || Object.keys(graphData.nodes || {}).length || 0;
    const edgesCount   = graphData.links?.length || graphData.edges?.length || 0;
    let communityCount = 0;
    if (graphData.nodes) { const comms = new Set(); const nodeArr = Array.isArray(graphData.nodes) ? graphData.nodes : Object.values(graphData.nodes); nodeArr.forEach(n => { if (n.community !== undefined) comms.add(n.community); }); communityCount = comms.size; }
    res.json({ success: true, nodesCount, edgesCount, communityCount, hasGraphHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'graph.html')), hasTreeHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'GRAPH_TREE.html')), hasCallflowHtml: fs.existsSync(path.join(__dirname, 'graphify-out', 'epresensi-jateng-callflow.html')) });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/api/graph/refresh', (req, res) => {
  const { addLog } = require('./src/logger');
  const isWindows = process.platform === 'win32';
  const sep = isWindows ? ';' : '&&';
  const cmd = `python -m graphify extract . --code-only ${sep} python -m graphify cluster-only . ${sep} python -m graphify tree ${sep} python -m graphify export callflow-html`;
  exec(cmd, { cwd: __dirname }, (error) => {
    if (error) { addLog({ type: 'error', message: `❌ Gagal update Knowledge Graph: ${error.message}` }); return res.json({ success: false, error: error.message }); }
    try { const srcDir = path.join(__dirname, 'graphify-out'); const destDir = path.join(__dirname, 'public', 'graphify-out'); if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true }); fs.cpSync(srcDir, destDir, { recursive: true, force: true }); } catch(e) {}
    addLog({ type: 'info', message: '🕸️ Knowledge Graph arsitektur berhasil diperbarui.' });
    res.json({ success: true, message: 'Knowledge graph berhasil diperbarui!' });
  });
});

// GET /api/logs
app.get('/api/logs', (req, res) => res.json(loadLogs()));
app.delete('/api/logs', (req, res) => { fs.writeFileSync(LOG_FILE, JSON.stringify([])); res.json({ success: true }); });

// GET /api/version
app.get('/api/version', (req, res) => res.json({ version: SERVER_VERSION }));

// GET /api/status
app.get('/api/status', requireAppAuth, async (req, res) => {
  const cfg = loadConfig();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const todayPagi   = new Date(now); todayPagi.setHours(cfg.pagiHour ?? 7, cfg.pagiMinute ?? 30, 0, 0);
  const todayPulang = new Date(now); todayPulang.setHours(cfg.pulangHour ?? 18, cfg.pulangMinute ?? 0, 0, 0);
  const candidates  = [];
  if (cfg.schedulerPagiEnabled !== false) { if (todayPagi > now) candidates.push(todayPagi); else { const t = new Date(todayPagi); t.setDate(t.getDate() + 1); candidates.push(t); } }
  if (cfg.schedulerPulangEnabled !== false) { if (todayPulang > now) candidates.push(todayPulang); else { const t = new Date(todayPulang); t.setDate(t.getDate() + 1); candidates.push(t); } }
  candidates.sort((a, b) => a - b);
  const nextCheck    = candidates[0] || null;
  const cookieExpiry = cfg.cookieExpiry ? new Date(cfg.cookieExpiry) : null;
  let q = supabase.from('recipients').select('*', { count: 'exact', head: true }).eq('aktif', true);
  if (req.userRole !== 'super_admin') q = q.eq('school_id', req.schoolId);
  const { count } = await q;
  res.json({
    authMode: cfg.authMode || 'auto',
    schedulerActive: cfg.schedulerEnabled,
    schedulerEnabled: cfg.schedulerEnabled || false,
    pagiTime:   `${String(cfg.pagiHour ?? 7).padStart(2,'0')}:${String(cfg.pagiMinute ?? 30).padStart(2,'0')}`,
    pulangTime: `${String(cfg.pulangHour ?? 18).padStart(2,'0')}:${String(cfg.pulangMinute ?? 0).padStart(2,'0')}`,
    checkTime:  `${String(cfg.pagiHour ?? 7).padStart(2,'0')}:${String(cfg.pagiMinute ?? 30).padStart(2,'0')} & ${String(cfg.siangHour ?? 15).padStart(2,'0')}:${String(cfg.siangMinute ?? 30).padStart(2,'0')} & ${String(cfg.pulangHour ?? 18).padStart(2,'0')}:${String(cfg.pulangMinute ?? 0).padStart(2,'0')}`,
    nextCheck: nextCheck ? nextCheck.toISOString() : null,
    currentTime: now.toISOString(),
    usernameSet: !!cfg.username, passwordSet: !!cfg.password,
    cookieSet: !!cfg.cookie, cookieValid: cfg.cookie && (!cookieExpiry || cookieExpiry > now),
    cookieExpiry: cfg.cookieExpiry, fonnteSet: !!cfg.fonnteToken, waNumberSet: !!cfg.waNumber,
    recipientCount: count || 0
  });
});

// GET /health
app.get('/health', (req, res) => {
  const { waConnectionStatus, waConnectedUser } = getWaState();
  const uptimeSec = Math.floor(process.uptime());
  res.json({
    status: 'ok', service: 'ePresensi Notif', version: SERVER_VERSION,
    uptime: `${Math.floor(uptimeSec/3600)}j ${Math.floor((uptimeSec%3600)/60)}m ${uptimeSec%60}s`,
    uptime_sec: uptimeSec,
    time_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }),
    whatsapp: { status: waConnectionStatus, number: waConnectedUser?.number || null, name: waConnectedUser?.name || null },
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Express Unhandled Error]', err);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server.', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
initBaileys();
setupScheduler();

app.listen(PORT, () => console.log(`
╔════════════════════════════════════════╗
║   ePresensi Notif — Fonnte WA          ║
║   http://localhost:${PORT}                 ║
║   Health: http://localhost:${PORT}/health  ║
╚════════════════════════════════════════╝`));
