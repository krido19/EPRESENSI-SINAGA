// ─── App Gatekeeper Security Elements ───────────────────────────────────────
const appGatekeeperScreen        = document.getElementById('appGatekeeperScreen');
const mainAppWrapper             = document.getElementById('mainAppWrapper');
const gatekeeperForm             = document.getElementById('gatekeeperForm');
const gatekeeperInputPassword    = document.getElementById('gatekeeperInputPassword');
const btnToggleGatekeeperEye     = document.getElementById('btnToggleGatekeeperEye');
const gatekeeperErrorMsg         = document.getElementById('gatekeeperErrorMsg');
const btnSubmitGatekeeper        = document.getElementById('btnSubmitGatekeeper');
const btnLogoutApp               = document.getElementById('btnLogoutApp');

const changeAppPasswordForm      = document.getElementById('changeAppPasswordForm');
const currentAppPasswordInput    = document.getElementById('currentAppPasswordInput');
const newAppPasswordInput        = document.getElementById('newAppPasswordInput');

// Gatekeeper Auth Check
function checkAppAuth() {
  const token = localStorage.getItem('epresensi_app_token');
  if (token) {
    if (appGatekeeperScreen) appGatekeeperScreen.style.display = 'none';
    if (mainAppWrapper) mainAppWrapper.style.display = 'block';
  } else {
    if (appGatekeeperScreen) appGatekeeperScreen.style.display = 'flex';
    if (mainAppWrapper) mainAppWrapper.style.display = 'none';
  }
}

if (btnToggleGatekeeperEye && gatekeeperInputPassword) {
  btnToggleGatekeeperEye.addEventListener('click', () => {
    const isPass = gatekeeperInputPassword.type === 'password';
    gatekeeperInputPassword.type = isPass ? 'text' : 'password';
    btnToggleGatekeeperEye.textContent = isPass ? '🙈' : '👁️';
  });
}

if (gatekeeperForm) {
  gatekeeperForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = gatekeeperInputPassword.value.trim();
    if (!password) return;

    if (btnSubmitGatekeeper) {
      btnSubmitGatekeeper.disabled = true;
      btnSubmitGatekeeper.textContent = 'Memverifikasi...';
    }
    if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = '';

    try {
      const res = await fetch('/api/auth/app-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (data.success && data.token) {
        localStorage.setItem('epresensi_app_token', data.token);
        checkAppAuth();
        showToast('Selamat datang di Dashboard ePresensi!', 'success');
        loadStatus();
        loadColleagues();
      } else {
        if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = `❌ ${data.error || 'Password salah'}`;
        gatekeeperInputPassword.value = '';
        gatekeeperInputPassword.focus();
      }
    } catch (err) {
      if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = `❌ Error: ${err.message}`;
    } finally {
      if (btnSubmitGatekeeper) {
        btnSubmitGatekeeper.disabled = false;
        btnSubmitGatekeeper.textContent = '🔓 Buka Dashboard →';
      }
    }
  });
}

if (btnLogoutApp) {
  btnLogoutApp.addEventListener('click', () => {
    if (confirm('Kunci aplikasi dan kembali ke halaman login?')) {
      localStorage.removeItem('epresensi_app_token');
      checkAppAuth();
      if (gatekeeperInputPassword) {
        gatekeeperInputPassword.value = '';
        gatekeeperInputPassword.focus();
      }
      showToast('Aplikasi terkunci.', 'info');
    }
  });
}

if (changeAppPasswordForm) {
  changeAppPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = currentAppPasswordInput.value.trim();
    const newPassword = newAppPasswordInput.value.trim();

    try {
      const res = await fetch('/api/auth/change-app-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword })
      });
      const data = await res.json();

      if (data.success) {
        showToast('✅ Password akses aplikasi berhasil diubah!', 'success');
        changeAppPasswordForm.reset();
      } else {
        showToast(`❌ Gagal: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

// ─── State ──────────────────────────────────────────────────────────────────
let config = {};
let recipients = [];
let colleagues = [];
let logs = [];
let activeFilter = 'all';
let nextCheckDate = null;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const todayDateBadge      = document.getElementById('todayDateBadge');
const statusValue         = document.getElementById('statusValue');
const jamMasukVal         = document.getElementById('jamMasukVal');
const jamPulangVal        = document.getElementById('jamPulangVal');
const headerStatusBadge   = document.getElementById('headerStatusBadge');
const headerStatusText    = document.getElementById('headerStatusText');

// Top Metric Cards Elements
const hudPersonalStatus    = document.getElementById('hudPersonalStatus');
const hudPersonalTime      = document.getElementById('hudPersonalTime');
const hudColleaguePercent  = document.getElementById('hudColleaguePercent');
const hudColleagueFraction = document.getElementById('hudColleagueFraction');
const hudBotTime           = document.getElementById('hudBotTime');
const hudBotCountdown      = document.getElementById('hudBotCountdown');
const hudRecipientCount    = document.getElementById('hudRecipientCount');

// Sidebar Scheduler Elements
const schedulerBadge          = document.getElementById('schedulerBadge');
const schedulerTimeText       = document.getElementById('schedulerTimeText');
const nextCheckText           = document.getElementById('nextCheckText');
const schedulerCountdownText  = document.getElementById('schedulerCountdownText');

// Action Buttons
const btnCheckAndSend     = document.getElementById('btnCheckAndSend');
const btnSendNow          = document.getElementById('btnSendNow');
const btnCheckOnly        = document.getElementById('btnCheckOnly');

// Colleague Monitoring
const colleaguesTableBody      = document.getElementById('colleaguesTableBody');
const searchColleagueInput     = document.getElementById('searchColleagueInput');
const colleagueDaySelect       = document.getElementById('colleagueDaySelect');
const btnRefreshColleagues     = document.getElementById('btnRefreshColleagues');
const btnQuickSendUnabsent     = document.getElementById('btnQuickSendUnabsent');
const unabsentBadgeCount       = document.getElementById('unabsentBadgeCount');
const btnCopyBelumAbsenToWA    = document.getElementById('btnCopyBelumAbsenToWA');
const tableSummaryFootnote     = document.getElementById('tableSummaryFootnote');

// Progress Bar & Filter Pills
const progressPercentageText   = document.getElementById('progressPercentageText');
const progressFractionText     = document.getElementById('progressFractionText');
const progressBarFill          = document.getElementById('progressBarFill');
const chipFilterAll            = document.getElementById('chipFilterAll');
const chipFilterBelum          = document.getElementById('chipFilterBelum');
const chipFilterHadir          = document.getElementById('chipFilterHadir');
const countAllChip             = document.getElementById('countAllChip');
const countBelumChip           = document.getElementById('countBelumChip');
const countHadirChip           = document.getElementById('countHadirChip');

// Recipients
const recipientsTableBody      = document.getElementById('recipientsTableBody');
const recipientTotalCount      = document.getElementById('recipientTotalCount');
const excelFileInput          = document.getElementById('excelFileInput');
const btnAddRecipientModal     = document.getElementById('btnAddRecipientModal');
const btnClearAllRecipients    = document.getElementById('btnClearAllRecipients');

const addRecipientModal   = document.getElementById('addRecipientModal');
const btnCloseModal       = document.getElementById('btnCloseModal');
const btnCancelModal      = document.getElementById('btnCancelModal');
const addRecipientForm    = document.getElementById('addRecipientForm');

// Config & Template Elements
const configForm                  = document.getElementById('configForm');
const cfgUsername                 = document.getElementById('cfgUsername');
const cfgPassword                 = document.getElementById('cfgPassword');
const cfgFonnteToken              = document.getElementById('cfgFonnteToken');
const cfgSchedulerEnabled         = document.getElementById('cfgSchedulerEnabled');

// WhatsApp Gateway Elements
const radioGatewayBaileys         = document.getElementById('radioGatewayBaileys');
const radioGatewayFonnte          = document.getElementById('radioGatewayFonnte');
const panelGatewayBaileys         = document.getElementById('panelGatewayBaileys');
const panelGatewayFonnte          = document.getElementById('panelGatewayFonnte');

const waQrStateBox                = document.getElementById('waQrStateBox');
const waConnectedStateBox         = document.getElementById('waConnectedStateBox');
const waLoadingStateBox           = document.getElementById('waLoadingStateBox');
const waQrImage                   = document.getElementById('waQrImage');
const waConnectedInfo             = document.getElementById('waConnectedInfo');
const waLoadingText               = document.getElementById('waLoadingText');
const btnRefreshWaQr              = document.getElementById('btnRefreshWaQr');
const btnLogoutWaWeb              = document.getElementById('btnLogoutWaWeb');

const cfgSchedulerPagiEnabled     = document.getElementById('cfgSchedulerPagiEnabled');
const cfgPagiHour                 = document.getElementById('cfgPagiHour');
const cfgPagiMinute               = document.getElementById('cfgPagiMinute');

const cfgSchedulerPulangEnabled   = document.getElementById('cfgSchedulerPulangEnabled');
const cfgPulangHour               = document.getElementById('cfgPulangHour');
const cfgPulangMinute             = document.getElementById('cfgPulangMinute');

const btnTestLogin                = document.getElementById('btnTestLogin');
const testLoginFeedback           = document.getElementById('testLoginFeedback');

const cfgMessagePagi              = document.getElementById('cfgMessagePagi');
const cfgMessagePulang            = document.getElementById('cfgMessagePulang');
const whatsappPreviewPagi         = document.getElementById('whatsappPreviewPagi');
const whatsappPreviewPulang       = document.getElementById('whatsappPreviewPulang');
const btnSaveTemplate             = document.getElementById('btnSaveTemplate');

const logsContainer       = document.getElementById('logsContainer');
const btnClearLogs        = document.getElementById('btnClearLogs');
const toast               = document.getElementById('toast');

// History Modal
const colleagueHistoryModal     = document.getElementById('colleagueHistoryModal');
const btnCloseHistoryModal      = document.getElementById('btnCloseHistoryModal');
const btnCloseHistoryModalBtn   = document.getElementById('btnCloseHistoryModalBtn');
const historyModalTeacherName   = document.getElementById('historyModalTeacherName');
const historyModalTeacherNip    = document.getElementById('historyModalTeacherNip');
const historyStatHadir          = document.getElementById('historyStatHadir');
const historyStatIzin           = document.getElementById('historyStatIzin');
const historyStatSakit          = document.getElementById('historyStatSakit');
const historyStatBelum          = document.getElementById('historyStatBelum');
const historyTableBody          = document.getElementById('historyTableBody');

// ─── Init Options ─────────────────────────────────────────────────────────────
function initSelectOptions() {
  const now = new Date();
  const currentDay = now.getDate();

  if (colleagueDaySelect) {
    colleagueDaySelect.innerHTML = '';
    for (let d = 1; d <= 31; d++) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `Tgl ${d} ${d === currentDay ? '(Hari ini)' : ''}`;
      if (d === currentDay) opt.selected = true;
      colleagueDaySelect.appendChild(opt);
    }
  }

  // Populate Pagi & Pulang Hour & Minute Selects
  [cfgPagiHour, cfgPulangHour].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${String(i).padStart(2, '0')}:00 WIB`;
      sel.appendChild(opt);
    }
  });

  [cfgPagiMinute, cfgPulangMinute].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < 60; i += 5) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${String(i).padStart(2, '0')} Menit`;
      sel.appendChild(opt);
    }
  });
}

// ─── Tab Switching & Mobile Sidebar ───────────────────────────────────────────
const btnToggleMobileSidebar = document.getElementById('btnToggleMobileSidebar');
const dashboardSidebar = document.getElementById('dashboardSidebar');

if (btnToggleMobileSidebar && dashboardSidebar) {
  btnToggleMobileSidebar.addEventListener('click', () => {
    dashboardSidebar.classList.toggle('mobile-open');
  });
}

document.querySelectorAll('.tab-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    document.getElementById(tabId)?.classList.add('active');

    // Auto-close sidebar on mobile
    if (window.innerWidth <= 960 && dashboardSidebar) {
      dashboardSidebar.classList.remove('mobile-open');
    }
  });
});

// ─── Toast Notification ───────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = `toast-notification show ${type}`;
  setTimeout(() => { toast.className = 'toast-notification'; }, 3500);
}

// ─── Live Scheduler Countdown ─────────────────────────────────────────────────
function updateCountdown() {
  if (!nextCheckDate || !config.schedulerEnabled) {
    const txt = 'Nonaktif';
    schedulerCountdownText.textContent = txt;
    schedulerCountdownText.style.color = 'var(--text-muted)';
    hudBotCountdown.textContent = txt;
    hudBotCountdown.style.color = 'var(--text-muted)';
    return;
  }

  const now = new Date();
  const diff = nextCheckDate - now;

  if (diff <= 0) {
    const txt = 'Memeriksa sekarang...';
    schedulerCountdownText.textContent = txt;
    schedulerCountdownText.style.color = 'var(--purple-500)';
    hudBotCountdown.textContent = txt;
    hudBotCountdown.style.color = 'var(--purple-500)';
    return;
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const countdownStr = `${String(hours).padStart(2, '0')}j ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}d`;
  schedulerCountdownText.textContent = countdownStr;
  schedulerCountdownText.style.color = 'var(--purple-500)';
  hudBotCountdown.textContent = `dalam ${countdownStr}`;
  hudBotCountdown.style.color = 'var(--purple-500)';
}
setInterval(updateCountdown, 1000);

// ─── Load Status & Config ─────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    if (todayDateBadge) todayDateBadge.textContent = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

    if (headerStatusText) {
      if (data.cookieValid && data.fonnteSet) {
        headerStatusText.textContent = 'Sistem Siap & Terhubung';
      } else if (!data.usernameSet) {
        headerStatusText.textContent = 'Belum Konfigurasi Akun';
      } else {
        headerStatusText.textContent = 'Session Aktif';
      }
    }

    if (schedulerBadge) {
      if (data.schedulerActive) {
        schedulerBadge.textContent = 'AKTIF';
        schedulerBadge.className = 'status-badge active';
      } else {
        schedulerBadge.textContent = 'NONAKTIF';
        schedulerBadge.className = 'status-badge';
      }
    }
    if (schedulerTimeText) schedulerTimeText.textContent = `${data.checkTime} WIB`;
    if (hudBotTime) hudBotTime.textContent = `${data.checkTime} WIB`;
    
    if (data.nextCheck) {
      nextCheckDate = new Date(data.nextCheck);
      if (nextCheckText) nextCheckText.textContent = nextCheckDate.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';
      updateCountdown();
    } else {
      if (nextCheckText) nextCheckText.textContent = '-';
      nextCheckDate = null;
    }

    if (hudRecipientCount) hudRecipientCount.textContent = data.recipientCount || 0;

  } catch (err) {
    console.error('Error loadStatus:', err);
  }
}

// ─── WhatsApp Gateway Switcher & Status ──────────────────────────────────────
function switchWaGatewayUI(gateway) {
  if (gateway === 'fonnte') {
    if (panelGatewayBaileys) panelGatewayBaileys.style.display = 'none';
    if (panelGatewayFonnte) panelGatewayFonnte.style.display = 'block';
    if (radioGatewayFonnte) radioGatewayFonnte.checked = true;
  } else {
    if (panelGatewayBaileys) panelGatewayBaileys.style.display = 'block';
    if (panelGatewayFonnte) panelGatewayFonnte.style.display = 'none';
    if (radioGatewayBaileys) radioGatewayBaileys.checked = true;
    loadWaStatus();
  }
}

if (radioGatewayBaileys) {
  radioGatewayBaileys.addEventListener('change', () => switchWaGatewayUI('baileys'));
}
if (radioGatewayFonnte) {
  radioGatewayFonnte.addEventListener('change', () => switchWaGatewayUI('fonnte'));
}

async function loadWaStatus() {
  try {
    const res = await fetch('/api/wa/status');
    const data = await res.json();

    if (data.status === 'connected') {
      if (waQrStateBox) waQrStateBox.style.display = 'none';
      if (waLoadingStateBox) waLoadingStateBox.style.display = 'none';
      if (waConnectedStateBox) waConnectedStateBox.style.display = 'block';
      if (waConnectedInfo && data.user) {
        waConnectedInfo.textContent = `Nomor: +${data.user.number || '-'} (${data.user.name || 'Admin'})`;
      }
    } else if (data.status === 'qr_ready' && data.qr) {
      if (waConnectedStateBox) waConnectedStateBox.style.display = 'none';
      if (waLoadingStateBox) waLoadingStateBox.style.display = 'none';
      if (waQrStateBox) waQrStateBox.style.display = 'block';
      if (waQrImage) waQrImage.src = data.qr;
    } else {
      if (waConnectedStateBox) waConnectedStateBox.style.display = 'none';
      if (waQrStateBox) waQrStateBox.style.display = 'none';
      if (waLoadingStateBox) {
        waLoadingStateBox.style.display = 'block';
        if (waLoadingText) waLoadingText.textContent = 'Menyiapkan koneksi WhatsApp Web...';
      }
    }
  } catch (err) {
    console.error('Error loadWaStatus:', err);
  }
}
setInterval(loadWaStatus, 3500);

if (btnRefreshWaQr) {
  btnRefreshWaQr.addEventListener('click', async () => {
    showToast('Memperbarui QR Code WhatsApp...', 'info');
    if (waLoadingStateBox) {
      waLoadingStateBox.style.display = 'block';
      if (waLoadingText) waLoadingText.textContent = 'Menghasilkan QR Code baru...';
    }
    if (waQrStateBox) waQrStateBox.style.display = 'none';
    try {
      await fetch('/api/wa/restart', { method: 'POST' });
      setTimeout(loadWaStatus, 1500);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

if (btnLogoutWaWeb) {
  btnLogoutWaWeb.addEventListener('click', async () => {
    if (!confirm('Putuskan sesi WhatsApp Web ini? Anda perlu scan QR ulang untuk menghubungkannya kembali.')) return;
    showToast('Memutuskan koneksi WhatsApp Web...', 'info');
    try {
      await fetch('/api/wa/logout', { method: 'POST' });
      showToast('Koneksi WhatsApp Web diputuskan.', 'info');
      setTimeout(loadWaStatus, 1500);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();

    if (cfgUsername) cfgUsername.value = config.username || '';
    if (cfgFonnteToken && config.fonnteToken) cfgFonnteToken.value = config.fonnteToken;
    if (cfgSchedulerEnabled) cfgSchedulerEnabled.checked = config.schedulerEnabled !== false;

    switchWaGatewayUI(config.waGateway || 'baileys');

    if (cfgSchedulerPagiEnabled) cfgSchedulerPagiEnabled.checked = config.schedulerPagiEnabled !== false;
    if (cfgPagiHour) cfgPagiHour.value = config.pagiHour ?? 7;
    if (cfgPagiMinute) cfgPagiMinute.value = config.pagiMinute ?? 30;

    if (cfgSchedulerPulangEnabled) cfgSchedulerPulangEnabled.checked = config.schedulerPulangEnabled !== false;
    if (cfgPulangHour) cfgPulangHour.value = config.pulangHour ?? 18;
    if (cfgPulangMinute) cfgPulangMinute.value = config.pulangMinute ?? 0;
    
    if (cfgMessagePagi && config.messagePagi) cfgMessagePagi.value = config.messagePagi;
    if (cfgMessagePulang && config.messagePulang) cfgMessagePulang.value = config.messagePulang;
    updateMessagePreviews();
  } catch (err) {
    console.error('Error loadConfig:', err);
  }
}

// ─── Attendance Check (Personal) ──────────────────────────────────────────────
async function performCheck(silenceToast = false) {
  if (statusValue) statusValue.textContent = 'Memeriksa...';
  if (hudPersonalStatus) hudPersonalStatus.textContent = 'Memeriksa...';

  try {
    const res = await fetch('/api/check', { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      if (statusValue) statusValue.textContent = 'Gagal Cek';
      if (hudPersonalStatus) hudPersonalStatus.textContent = 'Gagal Cek';
      if (!silenceToast) showToast(`Gagal: ${data.error}`, 'error');
      return data;
    }

    const att = data.data;
    if (statusValue) statusValue.textContent = att.status;
    if (hudPersonalStatus) hudPersonalStatus.textContent = att.status;

    if (jamMasukVal) jamMasukVal.textContent  = att.jamMasuk  ? `${att.jamMasuk} WIB` : '-';
    if (jamPulangVal) jamPulangVal.textContent = att.jamPulang ? `${att.jamPulang} WIB` : '-';
    if (hudPersonalTime) hudPersonalTime.textContent = att.jamMasuk ? `Masuk: ${att.jamMasuk} WIB • Pulang: ${att.jamPulang || '-'}` : (att.status.includes('Libur') ? 'Libur (OFF)' : 'Belum Absen Masuk');

    if (att.hasAbsenPagi) {
      if (statusValue) statusValue.style.color = 'var(--emerald-500)';
      if (hudPersonalStatus) hudPersonalStatus.style.color = 'var(--emerald-500)';
    } else if (att.status.includes('Libur') || att.status.includes('Akhir Pekan')) {
      if (statusValue) statusValue.style.color = 'var(--text-muted)';
      if (hudPersonalStatus) hudPersonalStatus.style.color = 'var(--text-muted)';
    } else {
      if (statusValue) statusValue.style.color = 'var(--rose-500)';
      if (hudPersonalStatus) hudPersonalStatus.style.color = 'var(--rose-500)';
    }

    if (!silenceToast) showToast(`Status presensi: ${att.status}`, 'success');
    loadLogs();
    return data;
  } catch (err) {
    if (statusValue) statusValue.textContent = 'Error Jaringan';
    if (hudPersonalStatus) hudPersonalStatus.textContent = 'Error Jaringan';
    if (!silenceToast) showToast(`Error: ${err.message}`, 'error');
  }
}

// ─── Monitoring Rekan Guru (SMKN 3 Magelang with Instant Local Cache) ─────────
function applyColleaguesData(data) {
  colleagues = data.colleagues || [];
  const total = colleagues.length;
  const hadir = data.hadirCount || 0;
  const belum = data.belumCount || 0;
  
  // Update Chips Counts
  if (countAllChip) countAllChip.textContent = total;
  if (countHadirChip) countHadirChip.textContent = hadir;
  if (countBelumChip) countBelumChip.textContent = belum;
  if (unabsentBadgeCount) unabsentBadgeCount.textContent = belum;

  // Update Progress Bar & HUD Metrics
  const percentage = total > 0 ? ((hadir / total) * 100).toFixed(1) : 0;
  if (progressPercentageText) progressPercentageText.textContent = `${percentage}% Rekan Sudah Hadir`;
  if (progressFractionText) progressFractionText.textContent = `${hadir} / ${total} Guru`;
  if (progressBarFill) progressBarFill.style.width = `${percentage}%`;

  if (hudColleaguePercent) hudColleaguePercent.textContent = `${percentage}%`;
  if (hudColleagueFraction) hudColleagueFraction.textContent = `${hadir} / ${total} Guru Hadir`;

  renderColleaguesTable();
}

async function loadColleagues(force = false) {
  if (!colleagueDaySelect || !colleaguesTableBody) return;
  const selectedDay = colleagueDaySelect.value;
  const cacheKey = `epresensi_cache_day_${selectedDay}`;

  // 1. INSTANT LOCAL CACHE LOAD (0ms latency on refresh!)
  const localCached = localStorage.getItem(cacheKey);
  let hasRenderedFromCache = false;

  if (localCached) {
    try {
      const parsed = JSON.parse(localCached);
      if (parsed && parsed.colleagues && parsed.colleagues.length > 0) {
        applyColleaguesData(parsed);
        hasRenderedFromCache = true;
      }
    } catch (e) {
      console.warn('Cache parse error:', e);
    }
  }

  // Jika belum ada cache lokal sama sekali, tampilkan loading spinner
  if (!hasRenderedFromCache) {
    colleaguesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <div class="loading-spinner"></div>
          <span>Mengambil data presensi tanggal ${selectedDay} dari ePresensi Jateng...</span>
        </td>
      </tr>`;
  }

  // 2. BACKGROUND FETCH (Update fresh data)
  try {
    const url = `/api/colleagues?day=${selectedDay}${force ? '&force=true' : ''}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      if (!hasRenderedFromCache) {
        colleaguesTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="table-empty" style="color: var(--rose-500);">
              ❌ Gagal memuat data: ${data.error}
            </td>
          </tr>`;
      }
      return;
    }

    // Simpan ke LocalStorage untuk akses instan selanjutnya
    localStorage.setItem(cacheKey, JSON.stringify(data));
    applyColleaguesData(data);

    if (force) {
      showToast('✅ Data presensi 98 guru berhasil diperbarui!', 'success');
    }
  } catch (err) {
    if (!hasRenderedFromCache && colleaguesTableBody) {
      colleaguesTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty" style="color: var(--rose-500);">
            ❌ Error koneksi: ${err.message}
          </td>
        </tr>`;
    }
  }
}

function renderColleaguesTable() {
  if (!colleaguesTableBody) return;
  const query = searchColleagueInput ? searchColleagueInput.value.toLowerCase().trim() : '';

  const filtered = colleagues.filter(c => {
    const matchSearch = c.nama.toLowerCase().includes(query) || c.nip.includes(query);
    if (!matchSearch) return false;

    if (activeFilter === 'hadir') return c.isHadir;
    if (activeFilter === 'belum') return !c.isHadir && !c.status.includes('Libur');
    return true;
  });

  if (tableSummaryFootnote) tableSummaryFootnote.textContent = `Menampilkan ${filtered.length} dari ${colleagues.length} rekan guru`;

  if (filtered.length === 0) {
    colleaguesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          Tidak ada data guru yang sesuai dengan pencarian/filter.
        </td>
      </tr>`;
    return;
  }

  colleaguesTableBody.innerHTML = filtered.map(c => {
    let badgeClass = 'badge-status';

    if (c.isHadir) {
      badgeClass = 'badge-status badge-status-hadir';
    } else if (c.status.includes('Libur')) {
      badgeClass = 'badge-status badge-status-libur';
    } else if (c.status.includes('Izin') || c.status.includes('Sakit')) {
      badgeClass = 'badge-status badge-status-izin';
    } else {
      badgeClass = 'badge-status badge-status-belum';
    }

    return `
      <tr>
        <td class="text-muted font-mono">${c.no}</td>
        <td class="font-mono text-muted">${c.nip || '-'}</td>
        <td>
          <a href="javascript:void(0)" class="teacher-link" onclick="openTeacherHistory('${c.nip}', '${escapeHtml(c.nama)}')">
            <strong>${escapeHtml(c.nama)}</strong>
            <small>Lihat Riwayat 1 Bulan &rarr;</small>
          </a>
        </td>
        <td class="font-mono">${c.jamMasuk ? `<strong>${c.jamMasuk}</strong>` : '-'}</td>
        <td class="font-mono">${c.jamPulang ? `<strong>${c.jamPulang}</strong>` : '-'}</td>
        <td><span class="${badgeClass}">${c.status}</span></td>
        <td class="text-center">
          <button class="modern-btn btn-glass btn-xs" onclick="openTeacherHistory('${c.nip}', '${escapeHtml(c.nama)}')">
            Detail
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Filter Pills Event ───────────────────────────────────────────────────────
[chipFilterAll, chipFilterBelum, chipFilterHadir].forEach(chip => {
  if (chip) {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderColleaguesTable();
    });
  }
});

if (searchColleagueInput) searchColleagueInput.addEventListener('input', renderColleaguesTable);
if (colleagueDaySelect) colleagueDaySelect.addEventListener('change', loadColleagues);
if (btnRefreshColleagues) {
  btnRefreshColleagues.addEventListener('click', () => {
    showToast('Memperbarui data presensi rekan...', 'info');
    loadColleagues(true);
  });
}

// ─── 1-Click Send WA to Unabsent Colleagues ──────────────────────────────────
async function triggerSendUnabsent() {
  const belumCount = parseInt(countBelumChip.textContent) || 0;
  if (belumCount === 0) {
    showToast('Semua rekan guru sudah hadir hari ini.', 'success');
    return;
  }

  const confirmSend = confirm(`Kirim notifikasi WhatsApp secara otomatis ke ${belumCount} rekan yang belum absen hari ini?`);
  if (!confirmSend) return;

  btnQuickSendUnabsent.disabled = true;
  btnQuickSendUnabsent.textContent = 'Mengirim WA...';

  try {
    const res = await fetch('/api/send-unabsent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: colleagueDaySelect.value })
    });
    const data = await res.json();

    if (!data.success) {
      showToast(`Gagal: ${data.error}`, 'error');
    } else {
      showToast(`✅ Berhasil mengirim WA ke ${data.sentCount} rekan guru!`, 'success');
      loadLogs();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btnQuickSendUnabsent.disabled = false;
    btnQuickSendUnabsent.innerHTML = `⚡ Kirim WA ke yang Belum Absen (<span id="unabsentBadgeCount">${countBelumChip.textContent}</span>)`;
  }
}

btnQuickSendUnabsent.addEventListener('click', triggerSendUnabsent);

// ─── Teacher 1-Month History Modal ────────────────────────────────────────────
window.openTeacherHistory = async function(nip, nama) {
  if (!nip) {
    showToast('NIP guru tidak valid.', 'error');
    return;
  }

  historyModalTeacherName.textContent = nama;
  historyModalTeacherNip.textContent = `NIP: ${nip}`;
  historyStatHadir.textContent = '-';
  historyStatIzin.textContent = '-';
  historyStatSakit.textContent = '-';
  historyStatBelum.textContent = '-';

  historyTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="table-empty">
        <div class="loading-spinner"></div>
        <span>Memuat riwayat presensi 1 bulan untuk ${nama}...</span>
      </td>
    </tr>`;

  colleagueHistoryModal.classList.add('show');

  try {
    const res = await fetch(`/api/colleagues/${nip}/history`);
    const data = await res.json();

    if (!data.success) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="table-empty" style="color: var(--rose-500);">
            ❌ Gagal memuat riwayat: ${data.error}
          </td>
        </tr>`;
      return;
    }

    historyStatHadir.textContent = data.totalHadir || 0;
    historyStatIzin.textContent  = data.totalIzin || 0;
    historyStatSakit.textContent = data.totalSakit || 0;
    historyStatBelum.textContent = data.totalBelum || 0;

    const list = data.history || [];
    if (list.length === 0) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="table-empty">
            Tidak ada data presensi bulan ini.
          </td>
        </tr>`;
      return;
    }

    historyTableBody.innerHTML = list.map(h => {
      let badge = 'badge-status';
      if (h.isHadir) badge = 'badge-status badge-status-hadir';
      else if (h.status.includes('Libur')) badge = 'badge-status badge-status-libur';
      else if (h.status.includes('Izin') || h.status.includes('Sakit')) badge = 'badge-status badge-status-izin';
      else if (h.isPast) badge = 'badge-status badge-status-belum';

      const todayHighlight = h.isToday ? 'style="background: rgba(168, 85, 247, 0.12); font-weight: 600;"' : '';

      return `
        <tr ${todayHighlight}>
          <td class="font-mono"><strong>Tgl ${h.tanggal}</strong> ${h.isToday ? '<span class="text-purple">●</span>' : ''}</td>
          <td class="${h.isWeekend ? 'text-muted' : ''}">${h.hari}</td>
          <td class="font-mono">${h.jamMasuk !== '-' ? `<strong>${h.jamMasuk}</strong>` : '-'}</td>
          <td class="font-mono">${h.jamPulang !== '-' ? `<strong>${h.jamPulang}</strong>` : '-'}</td>
          <td><span class="${badge}">${h.status}</span></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    historyTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty" style="color: var(--rose-500);">
          ❌ Error: ${err.message}
        </td>
      </tr>`;
  }
};

btnCloseHistoryModal.addEventListener('click', () => colleagueHistoryModal.classList.remove('show'));
btnCloseHistoryModalBtn.addEventListener('click', () => colleagueHistoryModal.classList.remove('show'));
colleagueHistoryModal.addEventListener('click', (e) => {
  if (e.target === colleagueHistoryModal) colleagueHistoryModal.classList.remove('show');
});

// ─── Recipients Management ────────────────────────────────────────────────────
async function loadRecipients() {
  try {
    const res = await fetch('/api/recipients');
    recipients = await res.json();
    recipientTotalCount.textContent = `Total: ${recipients.length} Guru Terdaftar`;
    hudRecipientCount.textContent = recipients.length;
    renderRecipientsTable();
  } catch (err) {
    console.error('Error loadRecipients:', err);
  }
}

function renderRecipientsTable() {
  if (recipients.length === 0) {
    recipientsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">
          Belum ada nomor guru terdaftar. Silakan import Excel atau tambah manual.
        </td>
      </tr>`;
    return;
  }

  recipientsTableBody.innerHTML = recipients.map((r, i) => `
    <tr>
      <td class="text-muted font-mono">${i + 1}</td>
      <td><strong>${escapeHtml(r.nama)}</strong></td>
      <td class="font-mono">${r.nomor}</td>
      <td>
        <label class="custom-switch" style="transform: scale(0.8);">
          <input type="checkbox" ${r.aktif !== false ? 'checked' : ''} onchange="toggleRecipientActive('${r.id}', this.checked)">
          <span class="switch-slider"></span>
        </label>
      </td>
      <td class="text-center" style="white-space: nowrap;">
        <button class="modern-btn btn-glass btn-xs mr-1" onclick="openEditRecipient('${r.id}', '${escapeHtml(r.nama).replace(/'/g, "\\'")}', '${r.nomor}')">
          ✏️ Edit
        </button>
        <button class="modern-btn btn-danger-ghost btn-xs" onclick="deleteRecipient('${r.id}')">
          🗑️ Hapus
        </button>
      </td>
    </tr>
  `).join('');
}

window.toggleRecipientActive = async function(id, aktif) {
  try {
    const res = await fetch(`/api/recipients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktif })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Status penerima diperbarui', 'info');
      loadStatus();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

// Edit Recipient Modal
const editRecipientModal   = document.getElementById('editRecipientModal');
const btnCloseEditModal     = document.getElementById('btnCloseEditModal');
const btnCancelEditModal    = document.getElementById('btnCancelEditModal');
const editRecipientForm     = document.getElementById('editRecipientForm');
const editRecipientId       = document.getElementById('editRecipientId');
const editNama              = document.getElementById('editNama');
const editNomor             = document.getElementById('editNomor');

window.openEditRecipient = function(id, nama, nomor) {
  if (editRecipientId) editRecipientId.value = id;
  if (editNama) editNama.value = nama;
  if (editNomor) editNomor.value = nomor;
  if (editRecipientModal) editRecipientModal.classList.add('show');
};

if (btnCloseEditModal) btnCloseEditModal.addEventListener('click', () => editRecipientModal?.classList.remove('show'));
if (btnCancelEditModal) btnCancelEditModal.addEventListener('click', () => editRecipientModal?.classList.remove('show'));
if (editRecipientModal) {
  editRecipientModal.addEventListener('click', (e) => {
    if (e.target === editRecipientModal) editRecipientModal.classList.remove('show');
  });
}

if (editRecipientForm) {
  editRecipientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editRecipientId.value;
    const nama = editNama.value.trim();
    const nomor = editNomor.value.trim();

    try {
      const res = await fetch(`/api/recipients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama, nomor })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(`Gagal edit: ${data.error}`, 'error');
      } else {
        showToast('Data penerima berhasil diperbarui!', 'success');
        editRecipientModal.classList.remove('show');
        loadRecipients();
        loadStatus();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

window.deleteRecipient = async function(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus nomor guru ini dari database WhatsApp?')) return;
  try {
    const res = await fetch(`/api/recipients/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Penerima berhasil dihapus!', 'success');
      loadRecipients();
      loadStatus();
    } else {
      showToast(`Gagal menghapus: ${data.error || 'Terjadi kesalahan'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

if (btnClearAllRecipients) {
  btnClearAllRecipients.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin mengosongkan SEMUA nomor guru dari database WhatsApp?')) return;
    try {
      await fetch('/api/recipients', { method: 'DELETE' });
      showToast('Semua penerima berhasil dikosongkan', 'info');
      loadRecipients();
      loadStatus();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

// Modal Tambah Penerima Manual
if (btnAddRecipientModal) btnAddRecipientModal.addEventListener('click', () => addRecipientModal?.classList.add('show'));
if (btnCloseModal) btnCloseModal.addEventListener('click', () => addRecipientModal?.classList.remove('show'));
if (btnCancelModal) btnCancelModal.addEventListener('click', () => addRecipientModal?.classList.remove('show'));
if (addRecipientModal) {
  addRecipientModal.addEventListener('click', (e) => {
    if (e.target === addRecipientModal) addRecipientModal.classList.remove('show');
  });
}

if (addRecipientForm) {
  addRecipientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = document.getElementById('manualNama').value.trim();
    const nomor = document.getElementById('manualNomor').value.trim();

    try {
      const res = await fetch('/api/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama, nomor })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(`Gagal: ${data.error}`, 'error');
      } else {
        showToast('Penerima berhasil ditambahkan!', 'success');
        addRecipientModal.classList.remove('show');
        addRecipientForm.reset();
        loadRecipients();
        loadStatus();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

// Import Excel
excelFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  showToast('Mengimpor file Excel...', 'info');

  try {
    const res = await fetch('/api/recipients/import', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!data.success) {
      showToast(`Gagal import: ${data.error}`, 'error');
    } else {
      showToast(`✅ Berhasil import ${data.added} guru! (${data.skipped} dilewati)`, 'success');
      loadRecipients();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    excelFileInput.value = '';
  }
});

// ─── Instant Actions ──────────────────────────────────────────────────────────
btnCheckOnly.addEventListener('click', () => performCheck(false));

btnCheckAndSend.addEventListener('click', async () => {
  showToast('Memeriksa presensi dan memproses notifikasi...', 'info');
  try {
    const res = await fetch('/api/check-and-send', { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showToast(`Gagal: ${data.error}`, 'error');
      return;
    }

    const att = data.attendance;
    if (att.hasAbsenPagi) {
      showToast(`Anda sudah absen pagi (${att.jamMasuk}). Pesan tidak dikirim.`, 'info');
    } else if (data.waSent) {
      showToast(`✅ Terkirim ke ${data.sendResult.successCount} penerima!`, 'success');
    } else {
      showToast('Belum absen pagi, namun gagal kirim WA.', 'warning');
    }

    loadStatus();
    loadLogs();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
});

btnSendNow.addEventListener('click', async () => {
  if (!confirm('Kirim pesan WhatsApp sekarang ke semua penerima yang terdaftar?')) return;
  showToast('Mengirim pesan WhatsApp...', 'info');

  try {
    const res = await fetch('/api/send-now', { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showToast(`Gagal: ${data.error}`, 'error');
    } else {
      showToast(`✅ Terkirim ke ${data.successCount} dari ${data.totalCount} penerima!`, 'success');
    }

    loadLogs();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
});

// ─── Config Form ──────────────────────────────────────────────────────
if (configForm) {
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      username: cfgUsername?.value.trim() || '',
      password: cfgPassword?.value.trim() || '',
      waGateway: radioGatewayFonnte?.checked ? 'fonnte' : 'baileys',
      fonnteToken: cfgFonnteToken?.value.trim() || '',
      schedulerEnabled: cfgSchedulerEnabled ? cfgSchedulerEnabled.checked : true,
      schedulerPagiEnabled: cfgSchedulerPagiEnabled ? cfgSchedulerPagiEnabled.checked : true,
      pagiHour: parseInt(cfgPagiHour?.value ?? 7),
      pagiMinute: parseInt(cfgPagiMinute?.value ?? 30),
      schedulerPulangEnabled: cfgSchedulerPulangEnabled ? cfgSchedulerPulangEnabled.checked : true,
      pulangHour: parseInt(cfgPulangHour?.value ?? 18),
      pulangMinute: parseInt(cfgPulangMinute?.value ?? 0),
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Konfigurasi jadwal & akun berhasil disimpan!', 'success');
        loadStatus();
      } else {
        showToast('Gagal menyimpan konfigurasi.', 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

if (btnTestLogin) {
  btnTestLogin.addEventListener('click', async () => {
    if (testLoginFeedback) {
      testLoginFeedback.textContent = 'Mencoba login...';
      testLoginFeedback.style.color = 'var(--text-muted)';
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cfgUsername?.value.trim() || '',
          password: cfgPassword?.value.trim() || ''
        })
      });
      const data = await res.json();

      if (data.success) {
        if (testLoginFeedback) {
          testLoginFeedback.textContent = '✅ Login Berhasil!';
          testLoginFeedback.style.color = 'var(--emerald-500)';
        }
        showToast('Auto-login ePresensi berhasil!', 'success');
        loadStatus();
      } else {
        if (testLoginFeedback) {
          testLoginFeedback.textContent = `❌ ${data.error}`;
          testLoginFeedback.style.color = 'var(--rose-500)';
        }
        showToast(`Gagal: ${data.error}`, 'error');
      }
    } catch (err) {
      if (testLoginFeedback) {
        testLoginFeedback.textContent = `❌ ${err.message}`;
        testLoginFeedback.style.color = 'var(--rose-500)';
      }
    }
  });
}

// ─── Dual Template Preview & Save ─────────────────────────────────────────────
function formatWaHtml(tmpl) {
  if (!tmpl) return '';
  return tmpl
    .replace(/\{nama\}/gi, 'Bapak/Ibu Guru')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function updateMessagePreviews() {
  if (cfgMessagePagi && whatsappPreviewPagi) {
    whatsappPreviewPagi.innerHTML = formatWaHtml(cfgMessagePagi.value);
  }
  if (cfgMessagePulang && whatsappPreviewPulang) {
    whatsappPreviewPulang.innerHTML = formatWaHtml(cfgMessagePulang.value);
  }
}

if (cfgMessagePagi) cfgMessagePagi.addEventListener('input', updateMessagePreviews);
if (cfgMessagePulang) cfgMessagePulang.addEventListener('input', updateMessagePreviews);

if (btnSaveTemplate) {
  btnSaveTemplate.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messagePagi: cfgMessagePagi?.value || '',
          messagePulang: cfgMessagePulang?.value || ''
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Semua template pesan berhasil disimpan!', 'success');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    logs = await res.json();
    renderLogs();
  } catch (err) {
    console.error('Error loadLogs:', err);
  }
}

function renderLogs() {
  if (logs.length === 0) {
    logsContainer.innerHTML = '<div class="empty-feed">Belum ada aktivitas tercatat.</div>';
    return;
  }

  logsContainer.innerHTML = logs.map(l => {
    const time = new Date(l.timestamp).toLocaleTimeString('id-ID');
    let color = 'var(--text-primary)';
    if (l.type === 'sent') color = 'var(--emerald-500)';
    if (l.type === 'error') color = 'var(--rose-500)';

    return `
      <div class="log-row">
        <span style="color: ${color};">${escapeHtml(l.message)}</span>
        <span class="log-time">${time}</span>
      </div>
    `;
  }).join('');
}

btnClearLogs.addEventListener('click', async () => {
  await fetch('/api/logs', { method: 'DELETE' });
  logs = [];
  renderLogs();
  showToast('Log aktivitas dibersihkan', 'info');
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Initialize ───────────────────────────────────────────────────────────────
checkAppAuth();
initSelectOptions();
loadStatus();
loadConfig();
loadRecipients();
loadColleagues();
loadLogs();
