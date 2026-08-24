'use strict';
const fs             = require('fs');
const { LOG_FILE }   = require('./config');
const { supabase }   = require('./supabase');

// ─── loadLogs ─────────────────────────────────────────────────────────────────
function loadLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); }
  catch (e) { return []; }
}

// ─── addLog ───────────────────────────────────────────────────────────────────
function addLog(entry, fallbackEntry) {
  const logEntry = entry || fallbackEntry;
  if (!logEntry || !logEntry.message) return;
  try {
    const logs = loadLogs();
    logs.unshift({ ...logEntry, timestamp: new Date().toISOString() });
    if (logs.length > 200) logs.splice(200);
    const tempFile = `${LOG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(logs, null, 2), 'utf8');
    fs.renameSync(tempFile, LOG_FILE);
  } catch (e) {
    console.error('Error saving log:', e.message);
  }
}

// ─── logNotificationToSupabase ────────────────────────────────────────────────
async function logNotificationToSupabase({ school_id, type, nama, nomor, status, error_msg = null, gateway = 'baileys', message = null }) {
  try {
    await supabase.from('notification_logs').insert({
      school_id:  school_id || null,
      type:       type      || 'manual',
      nama:       nama      || '',
      nomor:      nomor     || '',
      status,
      error_msg,
      gateway,
      message:    message ? message.substring(0, 500) : null,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('[NotifLog] Gagal simpan ke Supabase:', e.message);
  }
}

module.exports = { loadLogs, addLog, logNotificationToSupabase };
