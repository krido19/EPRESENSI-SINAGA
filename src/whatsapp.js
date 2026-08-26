'use strict';
const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');
const QRCode  = require('qrcode');
const pino    = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const { loadConfig }                = require('./config');
const { addLog }                    = require('./logger');
const { supabase }                  = require('./supabase');

const BAILEYS_AUTH_DIR = path.join(__dirname, '..', 'baileys_auth_info');

// ─── State ────────────────────────────────────────────────────────────────────
let waSock             = null;
let waQrCodeDataUrl    = null;
let waConnectionStatus = 'disconnected';
let waConnectedUser    = null;
let waDisconnectedAt   = null;

// ─── initBaileys ──────────────────────────────────────────────────────────────
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
        const statusCode    = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        waConnectionStatus  = 'disconnected';
        waConnectedUser     = null;
        waQrCodeDataUrl     = null;
        waDisconnectedAt    = Date.now();

        console.debug(`[WhatsApp Web] Terputus (Status: ${statusCode || 'unknown'}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(initBaileys, 4000);
        } else {
          try { fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
          setTimeout(initBaileys, 2000);
        }
      } else if (connection === 'open') {
        waConnectionStatus = 'connected';
        waQrCodeDataUrl    = null;
        const userJid      = waSock.user?.id || '';
        const cleanNumber  = userJid.split(':')[0] || userJid.split('@')[0];
        waConnectedUser    = { jid: userJid, number: cleanNumber, name: waSock.user?.name || 'Admin Presensi' };

        console.debug(`[WhatsApp Web] ✅ Terhubung: +${cleanNumber}`);
        addLog({ type: 'info', message: `📱 WhatsApp Web (Baileys) Terhubung: +${cleanNumber}` });

        if (waDisconnectedAt) {
          const downMs  = Date.now() - waDisconnectedAt;
          waDisconnectedAt = null;
          const downMin = Math.round(downMs / 60000);
          if (downMin >= 5) {
            const globalCfg = loadConfig();
            const adminNo   = globalCfg.waAdminNumber || '085868733378';
            const alertMsg  = `⚠️ *ePresensi Notif — Alert*\n\nWhatsApp sempat terputus selama *${downMin} menit* dan baru saja terhubung kembali.\n\nJika ada jadwal notifikasi yang terlewat selama periode tersebut, silakan kirim ulang manual dari dashboard.\n\n_Pesan otomatis sistem_`;
            sendWhatsApp(adminNo, alertMsg).catch(() => {});
            console.warn(`[WA Alert] WhatsApp terputus ${downMin} menit — notifikasi admin dikirim ke ${adminNo}`);
          }
        }
      }
    });
  } catch (err) {
    console.error('Error initBaileys:', err.message);
  }
}

// ─── sendWhatsApp ─────────────────────────────────────────────────────────────
async function sendWhatsApp(targetOrToken, messageOrTarget, tokenOrMessage = null) {
  let target, message, tokenOverride;
  if (tokenOrMessage && typeof tokenOrMessage === 'string' && (messageOrTarget.match(/^[0-9+]+$/) || messageOrTarget.includes('@'))) {
    tokenOverride = targetOrToken; target = messageOrTarget; message = tokenOrMessage;
  } else {
    target = targetOrToken; message = messageOrTarget; tokenOverride = tokenOrMessage;
  }

  const cfg             = loadConfig();

  // Prioritas: jika ada Fonnte token (dari sekolah/override) → pakai Fonnte
  // Baileys hanya dipakai jika tidak ada Fonnte token sama sekali
  const effectiveToken = tokenOverride || cfg.fonnteToken || null;
  const gateway        = effectiveToken ? 'fonnte' : (cfg.waGateway || 'baileys');

  if (gateway === 'fonnte' && effectiveToken) {
    try {
      const formData = new URLSearchParams();
      formData.append('target', target);
      formData.append('message', message);
      formData.append('countryCode', '62');
      const res    = await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: effectiveToken }, body: formData });
      const result = await res.json();
      const isSuccess = result.status === true || result.status === 'true';
      return { success: isSuccess, data: result, error: isSuccess ? null : (result.reason || result.message || 'Fonnte gagal mengirim pesan'), gateway: 'fonnte' };
    } catch (err) {
      return { success: false, error: `Fonnte Error: ${err.message}`, gateway: 'fonnte' };
    }
  } else {
    // Baileys fallback — hanya jika tidak ada Fonnte token
    if (!waSock || waConnectionStatus !== 'connected') {
      return { success: false, error: 'WhatsApp Web belum terhubung. Silakan buka menu Pengaturan & scan QR Code WhatsApp.', gateway: 'baileys' };
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

// ─── sendWhatsAppWithRetry ────────────────────────────────────────────────────
async function sendWhatsAppWithRetry(target, message, tokenOverride = null, maxRetry = 3) {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    lastResult = await sendWhatsApp(target, message, tokenOverride);
    if (lastResult.success) return lastResult;
    if (attempt < maxRetry) {
      const delayMs = 2000 * Math.pow(2, attempt - 1);
      console.warn(`[WA Retry] Gagal (attempt ${attempt}/${maxRetry}) ke ${target} — coba lagi dalam ${delayMs/1000}s: ${lastResult.error}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error(`[WA Retry] ❌ Semua ${maxRetry} percobaan gagal untuk ${target}: ${lastResult?.error}`);
  return lastResult;
}

// ─── sendToAllRecipients ──────────────────────────────────────────────────────
async function sendToAllRecipients(token, messageTemplate, targetOverride = null, config = null) {
  let query = supabase.from('recipients').select('*').eq('aktif', true);
  if (config && config.schoolId) query = query.eq('school_id', config.schoolId);
  const { data }  = await query;
  const recipients = data || [];
  const results    = [];
  const targets    = targetOverride ? [{ nama: 'Admin', nomor: targetOverride }, ...recipients] : recipients;

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

// ─── Getters untuk state WA (digunakan oleh route) ───────────────────────────
function getWaState() {
  return { waSock, waQrCodeDataUrl, waConnectionStatus, waConnectedUser };
}

function setWaSock(sock) { waSock = sock; }
function setWaStatus(status) { waConnectionStatus = status; }

module.exports = {
  initBaileys,
  sendWhatsApp,
  sendWhatsAppWithRetry,
  sendToAllRecipients,
  getWaState,
  BAILEYS_AUTH_DIR
};
