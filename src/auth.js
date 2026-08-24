'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { loadConfig, CONFIG_FILE } = require('./config');
const { supabase }                = require('./supabase');

// ─── App Secret ───────────────────────────────────────────────────────────────
function getAppSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.trim().length > 0) return process.env.APP_SECRET.trim();
  const secretFile = path.join(__dirname, '..', '.app_secret');
  if (fs.existsSync(secretFile)) { try { const s = fs.readFileSync(secretFile, 'utf8').trim(); if (s) return s; } catch(e) {} }
  const generated = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(secretFile, generated, { mode: 0o600 }); } catch(e) {}
  return generated;
}
const AUTH_SECRET = getAppSecret();

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const rateLimitRecords = new Map();
function createRateLimiter({ windowMs = 60000, max = 20, message = 'Terlalu banyak permintaan. Silakan tunggu sebentar.' }) {
  return function (req, res, next) {
    const ip     = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const now    = Date.now();
    const record = rateLimitRecords.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
    record.count++;
    rateLimitRecords.set(ip, record);
    if (record.count > max) return res.status(429).json({ success: false, error: message });
    next();
  };
}
const authLimiter   = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Terlalu banyak percobaan login. Silakan tunggu 15 menit.' });
const actionLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Permintaan terlalu cepat. Harap tunggu.' });

// ─── JWT Token ────────────────────────────────────────────────────────────────
function generateAuthToken(password) {
  const timestamp = Date.now();
  const payload   = `${password}:${timestamp}`;
  const hmac      = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

function verifyAuthToken(token, currentPassword) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length < 3) return false;
    const [tokenPass, tokenTime, tokenHmac] = parts;
    if (tokenPass !== currentPassword) return false;
    if (Date.now() - parseInt(tokenTime) > 7 * 24 * 60 * 60 * 1000) return false;
    const expectedHmac = crypto.createHmac('sha256', AUTH_SECRET).update(`${tokenPass}:${tokenTime}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(tokenHmac), Buffer.from(expectedHmac));
  } catch(e) { return false; }
}

// ─── Auth Cache (60 detik) ────────────────────────────────────────────────────
const authCache = new Map();

// ─── requireAppAuth Middleware ────────────────────────────────────────────────
async function requireAppAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized: Token tidak ditemukan.' });

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    req.userId = cached.userId; req.userRole = cached.role; req.schoolId = cached.schoolId; req.tenantCfg = cached.tenantCfg;
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ success: false, error: 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.' });
  req.userId = data.user.id;

  try {
    const { data: roleData } = await supabase.from('user_roles').select('role, school_id').eq('user_id', data.user.id).single();
    const userRole    = roleData?.role || 'school_admin';
    const userSchoolId = userRole === 'super_admin' ? null : (roleData?.school_id || process.env.DEFAULT_SCHOOL_ID);
    req.user     = { id: data.user.id, email: data.user.email, role: userRole, schoolId: userSchoolId };
    req.userRole = userRole;
    req.schoolId = userSchoolId;

    let tenantCfg = null;
    if (userSchoolId) {
      const { data: school }    = await supabase.from('schools').select('*').eq('id', userSchoolId).single();
      const { data: schoolCfg } = await supabase.from('school_configs').select('*').eq('school_id', userSchoolId).single();
      if (school) {
        const localCfg = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { return {}; } })();
        tenantCfg = {
          username: school.epresensi_username || localCfg.username || '', password: school.epresensi_password || localCfg.password || '',
          cookie: localCfg.cookie || '', cookieExpiry: localCfg.cookieExpiry || null,
          fonnteToken: school.fonnte_token || localCfg.fonnteToken || '', waGateway: school.wa_gateway || localCfg.waGateway || 'baileys',
          waNumber: school.wa_number || localCfg.waNumber || '', unitCode: school.unit_code || localCfg.unitCode || 'F208007700',
          opdCode: school.opd_code || localCfg.opdCode || 'F200000000', namaSekolah: school.name || localCfg.namaSekolah || '',
          schoolId: school.id, plan: school.plan || 'free', authMode: localCfg.authMode || 'auto',
          schedulerEnabled: schoolCfg?.scheduler_enabled ?? localCfg.schedulerEnabled ?? true,
          schedulerPagiEnabled: localCfg.schedulerPagiEnabled !== false, schedulerPulangEnabled: localCfg.schedulerPulangEnabled !== false,
          pagiHour: schoolCfg?.pagi_hour ?? localCfg.pagiHour ?? 7, pagiMinute: schoolCfg?.pagi_minute ?? localCfg.pagiMinute ?? 30,
          pulangHour: schoolCfg?.pulang_hour ?? localCfg.pulangHour ?? 18, pulangMinute: schoolCfg?.pulang_minute ?? localCfg.pulangMinute ?? 0,
          messagePagi: schoolCfg?.message_pagi || localCfg.messagePagi || '', messagePagiSudah: schoolCfg?.message_pagi_sudah || localCfg.messagePagiSudah || '',
          messagePulang: schoolCfg?.message_pulang || localCfg.messagePulang || '', messagePulangSudah: schoolCfg?.message_pulang_sudah || localCfg.messagePulangSudah || '',
          message: localCfg.message || '',
        };
      }
    }
    req.tenantCfg = tenantCfg;
    authCache.set(token, { userId: data.user.id, role: req.userRole, schoolId: req.schoolId, tenantCfg, expiresAt: Date.now() + 60_000 });
  } catch(e) { console.error('[Auth] Error fetching tenant config:', e.message); }

  next();
}

module.exports = { requireAppAuth, generateAuthToken, verifyAuthToken, authLimiter, actionLimiter, authCache };
