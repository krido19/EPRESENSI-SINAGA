// ─── 🔄 Version Check — Deteksi Update Server Otomatis ──────────────────────
(function initVersionCheck() {
  let knownVersion = null;
  const banner = document.getElementById('updateBanner');

  async function checkVersion() {
    try {
      // Gunakan XMLHttpRequest langsung agar bypass interceptor token
      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/version');
        xhr.onload = () => resolve({ json: () => JSON.parse(xhr.responseText) });
        xhr.onerror = reject;
        xhr.send();
      });
      const data = res.json();
      if (!knownVersion) {
        knownVersion = data.version;
      } else if (data.version !== knownVersion) {
        if (banner) banner.classList.add('visible');
      }
    } catch (_) { /* server mungkin restart, diam saja */ }
  }

  // Cek setiap 60 detik
  checkVersion();
  setInterval(checkVersion, 60000);
})();

// ─── 🔐 Authenticated Fetch Interceptor (Security Layer) ─────────────────────
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const token = localStorage.getItem('epresensi_app_token');
  const opts = { ...options };

  if (typeof url === 'string' && url.startsWith('/api') && !url.includes('/api/auth/app-login')) {
    opts.headers = { ...(opts.headers || {}) };
    if (token && !opts.headers['Authorization']) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const response = await originalFetch(url, opts);
  if (response.status === 401 && typeof url === 'string' && url.startsWith('/api') && !url.includes('/api/auth/app-login')) {
    localStorage.removeItem('epresensi_app_token');
    if (typeof checkAppAuth === 'function') checkAppAuth();
  }
  return response;
};

// Helper untuk fetch dan parse JSON otomatis
window.apiFetch = async function(url, options = {}) {
  const opts = { ...options };
  if (opts.body && typeof opts.body === 'string') {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  }
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch (err) {
    console.error('[apiFetch Error]', err);
    return { success: false, error: err.message };
  }
};

// ─── App Gatekeeper Security Elements ───────────────────────────────────────
const appGatekeeperScreen        = document.getElementById('appGatekeeperScreen');
const mainAppWrapper             = document.getElementById('mainAppWrapper');
const gatekeeperForm             = document.getElementById('gatekeeperForm');
const gatekeeperInputEmail       = document.getElementById('gatekeeperInputEmail');
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
    if (mainAppWrapper) mainAppWrapper.style.display = 'flex';
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
    const email    = gatekeeperInputEmail ? gatekeeperInputEmail.value.trim() : '';
    const password = gatekeeperInputPassword ? gatekeeperInputPassword.value.trim() : '';
    if (!email || !password) {
      if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = '❌ Email dan password wajib diisi.';
      return;
    }

    if (btnSubmitGatekeeper) {
      btnSubmitGatekeeper.disabled = true;
      btnSubmitGatekeeper.textContent = 'Memverifikasi...';
    }
    if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = '';

    try {
      const res = await fetch('/api/auth/app-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (data.success && data.token) {
        localStorage.setItem('epresensi_app_token', data.token);
        if (data.role)     localStorage.setItem('epresensi_user_role', data.role);
        if (data.schoolId) localStorage.setItem('epresensi_school_id', data.schoolId);
        else               localStorage.removeItem('epresensi_school_id');
        checkAppAuth();
        applyRoleUI(data.role); // update tampilan sesuai role baru
        showToast(`Selamat datang, ${data.role === 'super_admin' ? 'Super Admin' : 'Admin Sekolah'}!`, 'success');
        // Selalu load status & monitoring untuk semua role (termasuk super_admin)
        loadStatus();
        loadColleagues();
        if (data.role !== 'super_admin') {
          loadSchoolAccounts();
          loadConfig();
          loadRecipients();
          loadLogs();
        }
      } else {
        if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = `❌ ${data.error || 'Email atau password salah'}`;
        if (gatekeeperInputPassword) { gatekeeperInputPassword.value = ''; gatekeeperInputPassword.focus(); }
      }
    } catch (err) {
      if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = `❌ Error koneksi: ${err.message}`;
    } finally {
      if (btnSubmitGatekeeper) {
        btnSubmitGatekeeper.disabled = false;
        btnSubmitGatekeeper.textContent = '🔓 Masuk ke Dashboard →';
      }
    }
  });
}

// ─── Role-based UI ────────────────────────────────────────────────────────────
function applyRoleUI(role) {
  role = role || localStorage.getItem('epresensi_user_role') || 'school_admin';
  const navSA = document.getElementById('navSuperAdmin');
  window.isSuperAdmin = (role === 'super_admin');

  if (role === 'super_admin') {
    if (navSA) navSA.style.display = '';
    // Ubah nama sekolah di topbar menjadi Super Admin
    const tbName = document.getElementById('topbarSchoolName');
    if (tbName) tbName.textContent = 'PANEL SUPER ADMIN';
    
    // Tampilkan badge di sidebar
    const roleBadge = document.getElementById('sidebarRoleBadge');
    if (roleBadge) roleBadge.style.display = 'inline-block';
    const sidebarBrand = document.getElementById('sidebarBrandSubtitle');
    if (sidebarBrand) sidebarBrand.textContent = 'Multi-Tenant System';

    // Sembunyikan referensi SMKN 3 Magelang di panel lain
    const monitoringDesc = document.getElementById('monitoringPanelDesc');
    if (monitoringDesc) monitoringDesc.textContent = 'Daftar presensi real-time seluruh guru & staf.';
    const templateAlertName = document.getElementById('templateAlertSchoolName');
    if (templateAlertName) templateAlertName.textContent = 'Sekolah';

    // Auto switch ke tab Super Admin setelah DOM siap
    setTimeout(() => {
      const saTab = document.querySelector('[data-tab="superadmin"]');
      if (saTab) saTab.click();
      // Load data Super Admin
      if (window._saasLoadStats)   window._saasLoadStats();
      if (window._saasLoadSchools) window._saasLoadSchools();
    }, 300);
  } else {
    if (navSA) navSA.style.display = 'none';
    const tbName = document.getElementById('topbarSchoolName');
    if (tbName && tbName.textContent === 'PANEL SUPER ADMIN') {
       tbName.textContent = 'SMKN 3 MAGELANG';
    }
    
    // Sembunyikan badge di sidebar
    const roleBadge = document.getElementById('sidebarRoleBadge');
    if (roleBadge) roleBadge.style.display = 'none';
    const sidebarBrand = document.getElementById('sidebarBrandSubtitle');
    if (sidebarBrand && sidebarBrand.textContent === 'Multi-Tenant System') {
      sidebarBrand.textContent = 'SMKN 3 MAGELANG';
    }

    // Kembalikan referensi SMKN 3 Magelang di panel lain
    const monitoringDesc = document.getElementById('monitoringPanelDesc');
    if (monitoringDesc && monitoringDesc.textContent === 'Daftar presensi real-time seluruh guru & staf.') {
      monitoringDesc.textContent = 'Daftar presensi real-time seluruh guru & staf SMKN 3 Magelang.';
    }
    const templateAlertName = document.getElementById('templateAlertSchoolName');
    if (templateAlertName) templateAlertName.textContent = 'SMKN 3 Magelang';
  }
}
// Jalankan on page load
applyRoleUI();

if (btnLogoutApp) {
  btnLogoutApp.addEventListener('click', () => {
    if (confirm('Kunci aplikasi dan kembali ke halaman login?')) {
      localStorage.removeItem('epresensi_app_token');
      localStorage.removeItem('epresensi_user_role');
      localStorage.removeItem('epresensi_school_id');
      checkAppAuth();
      if (gatekeeperInputEmail) gatekeeperInputEmail.value = '';
      if (gatekeeperInputPassword) { gatekeeperInputPassword.value = ''; }
      if (gatekeeperInputEmail) gatekeeperInputEmail.focus();
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
        if (data.token) {
          localStorage.setItem('epresensi_app_token', data.token);
        }
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

// Monthly Analytics & Chart Elements
const monthlyAnalyticsCard     = document.getElementById('monthlyAnalyticsCard');
const monthlyAnalyticsSubtitle = document.getElementById('monthlyAnalyticsSubtitle');
const btnToggleAnalyticsChart  = document.getElementById('btnToggleAnalyticsChart');
const toggleAnalyticsIcon      = document.getElementById('toggleAnalyticsIcon');
const toggleAnalyticsText      = document.getElementById('toggleAnalyticsText');
const analyticsChartBody       = document.getElementById('analyticsChartBody');
const monthlyTotalHadir        = document.getElementById('monthlyTotalHadir');
const monthlyPctHadir          = document.getElementById('monthlyPctHadir');
const monthlyTotalBelum        = document.getElementById('monthlyTotalBelum');
const monthlyPctBelum          = document.getElementById('monthlyPctBelum');
const monthlyTotalIzin         = document.getElementById('monthlyTotalIzin');
const monthlyPctIzin           = document.getElementById('monthlyPctIzin');
const monthlyTotalSakit        = document.getElementById('monthlyTotalSakit');
const monthlyPctSakit          = document.getElementById('monthlyPctSakit');
const dailyChartBars           = document.getElementById('dailyChartBars');
const activeDayPopup           = document.getElementById('activeDayPopup');
const popupDateText            = document.getElementById('popupDateText');
const popupSubText             = document.getElementById('popupSubText');
const popupBadgesContainer     = document.getElementById('popupBadgesContainer');
const btnApplyDayFromChart     = document.getElementById('btnApplyDayFromChart');

// Progress Bar & Filter Pills
const progressPercentageText   = document.getElementById('progressPercentageText');
const progressFractionText     = document.getElementById('progressFractionText');
const progressBarFill          = document.getElementById('progressBarFill');
const chipFilterAll            = document.getElementById('chipFilterAll');
const chipFilterBelum          = document.getElementById('chipFilterBelum');
const chipFilterHadir          = document.getElementById('chipFilterHadir');
const chipFilterIzin           = document.getElementById('chipFilterIzin');
const chipFilterSakit          = document.getElementById('chipFilterSakit');
const countAllChip             = document.getElementById('countAllChip');
const countBelumChip           = document.getElementById('countBelumChip');
const countHadirChip           = document.getElementById('countHadirChip');
const countIzinChip            = document.getElementById('countIzinChip');
const countSakitChip           = document.getElementById('countSakitChip');

// Recipients
const recipientsTableBody      = document.getElementById('recipientsTableBody');
const recipientTotalCount      = document.getElementById('recipientTotalCount');
const excelFileInput          = document.getElementById('excelFileInput');
const btnDownloadTemplate     = document.getElementById('btnDownloadTemplate');

if (btnDownloadTemplate) {
  btnDownloadTemplate.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/recipients/template');
      if (!response.ok) throw new Error('Gagal mengunduh template');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'template_guru.xlsx';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match && match.length > 1) filename = match[1];
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      if (typeof showToast === 'function') {
        showToast('Gagal download: ' + err.message, 'error');
      } else {
        alert('Error: ' + err.message);
      }
    }
  });
}
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

const cfgSchedulerSiangEnabled    = document.getElementById('cfgSchedulerSiangEnabled');
const cfgSiangHour                = document.getElementById('cfgSiangHour');
const cfgSiangMinute              = document.getElementById('cfgSiangMinute');

const cfgSchedulerPulangEnabled   = document.getElementById('cfgSchedulerPulangEnabled');
const cfgPulangHour               = document.getElementById('cfgPulangHour');
const cfgPulangMinute             = document.getElementById('cfgPulangMinute');

const btnTestLogin                = document.getElementById('btnTestLogin');
const testLoginFeedback           = document.getElementById('testLoginFeedback');

const cfgMessagePagi              = document.getElementById('cfgMessagePagi');
const cfgMessagePagiSudah         = document.getElementById('cfgMessagePagiSudah');
const cfgMessageSiang             = document.getElementById('cfgMessageSiang');
const cfgMessageSiangSudah        = document.getElementById('cfgMessageSiangSudah');
const cfgMessagePulang            = document.getElementById('cfgMessagePulang');
const cfgMessagePulangSudah       = document.getElementById('cfgMessagePulangSudah');
const whatsappPreviewPagi         = document.getElementById('whatsappPreviewPagi');
const whatsappPreviewPagiSudah    = document.getElementById('whatsappPreviewPagiSudah');
const whatsappPreviewSiang        = document.getElementById('whatsappPreviewSiang');
const whatsappPreviewSiangSudah   = document.getElementById('whatsappPreviewSiangSudah');
const whatsappPreviewPulang       = document.getElementById('whatsappPreviewPulang');
const whatsappPreviewPulangSudah  = document.getElementById('whatsappPreviewPulangSudah');
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

// ─── Modern Date Strip ────────────────────────────────────────────────────────
const dateStripScroll = document.getElementById('dateStripScroll');
const dateStripPrev   = document.getElementById('dateStripPrev');
const dateStripNext   = document.getElementById('dateStripNext');

const DAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

let activeDatePill = null;

function buildDateStrip(activeDay) {
  if (!dateStripScroll || !colleagueDaySelect) return;
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  // Force horizontal layout on the scroll container via inline style (bulletproof)
  Object.assign(dateStripScroll.style, {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    overflowX: 'auto',
    overflowY: 'visible',
    gap: '4px',
    alignItems: 'center',
    scrollBehavior: 'smooth',
    paddingBottom: '6px',
    minWidth: '0',
    flex: '1 1 auto'
  });

  // Keep hidden select in sync
  colleagueDaySelect.innerHTML = '';
  dateStripScroll.innerHTML = '';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dayName = DAY_SHORT[dateObj.getDay()];
    const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
    const isToday   = (d === today);
    const isActive  = (d === (activeDay || today));

    // Hidden select option
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `Tgl ${d}`;
    if (isActive) opt.selected = true;
    colleagueDaySelect.appendChild(opt);

    // Visible pill — inline styles as failsafe
    const pill = document.createElement('div');
    pill.className = 'date-pill'
      + (isWeekend ? ' is-weekend' : '')
      + (isToday   ? ' is-today'   : '')
      + (isActive  ? ' is-active'  : '');
    pill.dataset.day = d;
    // Inline style to guarantee column layout inside each pill
    Object.assign(pill.style, {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      width: '44px',
      minWidth: '44px'
    });
    pill.innerHTML = `
      <span class="dp-day" style="font-size:0.6rem;font-weight:700;letter-spacing:0.04em;color:#94a3b8;text-transform:uppercase;line-height:1">${dayName}</span>
      <span class="dp-num" style="font-size:1rem;font-weight:800;line-height:1.2">${d}</span>
      <span class="dp-dot"></span>
    `;
    pill.addEventListener('click', () => selectDatePill(d));
    dateStripScroll.appendChild(pill);

    if (isActive) activeDatePill = pill;
  }

  // Scroll today/active into center view
  setTimeout(() => {
    if (activeDatePill) {
      activeDatePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, 80);
}

function selectDatePill(d) {
  // Update hidden select
  if (colleagueDaySelect) colleagueDaySelect.value = d;
  // Update pill classes
  dateStripScroll?.querySelectorAll('.date-pill').forEach(p => {
    const isNow = parseInt(p.dataset.day) === d;
    p.classList.toggle('is-active', isNow);
    if (isNow) {
      activeDatePill = p;
      p.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
  loadColleagues();
}

// Arrow navigation
if (dateStripPrev) {
  dateStripPrev.addEventListener('click', () => {
    const cur = parseInt(colleagueDaySelect?.value || new Date().getDate());
    if (cur > 1) selectDatePill(cur - 1);
  });
}
if (dateStripNext) {
  dateStripNext.addEventListener('click', () => {
    const now = new Date();
    const max = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cur = parseInt(colleagueDaySelect?.value || now.getDate());
    if (cur < max) selectDatePill(cur + 1);
  });
}

// Allow chart click to update the date strip too
window.updateDateStripFromChart = function(day) {
  selectDatePill(day);
};

// ─── Init Options (Hour/Minute selects for scheduler) ─────────────────────────
function initSelectOptions() {
  // Populate Pagi & Pulang Hour & Minute Selects
  [cfgPagiHour, cfgSiangHour, cfgPulangHour].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${String(i).padStart(2, '0')}:00 WIB`;
      sel.appendChild(opt);
    }
  });

  [cfgPagiMinute, cfgSiangMinute, cfgPulangMinute].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < 60; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${String(i).padStart(2, '0')} Menit`;
      sel.appendChild(opt);
    }
  });
}

// ─── Tab Switching & Universal Hamburger Sidebar ──────────────────────────────
const btnToggleSidebar  = document.getElementById('btnToggleSidebar');
const dashboardSidebar  = document.getElementById('dashboardSidebar');
const sidebarBackdrop   = document.getElementById('sidebarBackdrop');

function initSidebarState() {
  const isCollapsed = localStorage.getItem('epresensi_sidebar_collapsed') === 'true';
  if (isCollapsed && window.innerWidth > 960 && mainAppWrapper) {
    mainAppWrapper.classList.add('sidebar-collapsed');
  }
}

if (btnToggleSidebar) {
  btnToggleSidebar.addEventListener('click', () => {
    if (window.innerWidth <= 960) {
      const isOpen = dashboardSidebar?.classList.toggle('mobile-open');
      if (sidebarBackdrop) {
        if (isOpen) sidebarBackdrop.classList.add('show');
        else sidebarBackdrop.classList.remove('show');
      }
    } else {
      if (mainAppWrapper) {
        const isCollapsed = mainAppWrapper.classList.toggle('sidebar-collapsed');
        localStorage.setItem('epresensi_sidebar_collapsed', isCollapsed ? 'true' : 'false');
      }
    }
  });
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', () => {
    dashboardSidebar?.classList.remove('mobile-open');
    sidebarBackdrop.classList.remove('show');
  });
}

initSidebarState();

window.switchNavTab = function(tabName) {
  const targetTab = tabName.replace(/^tab-/, '');
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === targetTab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${targetTab}`);
  });
  if (window.innerWidth <= 960 && dashboardSidebar) {
    dashboardSidebar.classList.remove('mobile-open');
    sidebarBackdrop?.classList.remove('show');
  }
  // Load data saat masuk ke tab tertentu
  if (targetTab === 'monitoring') { loadStatus(); loadColleagues(); }
  if (targetTab === 'config' || targetTab === 'template') loadConfig();
  if (targetTab === 'recipients') loadRecipients();
  if (targetTab === 'logs') loadLogs();
};

document.querySelectorAll('.tab-item').forEach(btn => {
  btn.addEventListener('click', () => {
    window.switchNavTab(btn.dataset.tab);
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
  // Super Admin tidak punya akun ePresensi pribadi — tampilkan status khusus
  if (window.isSuperAdmin) {
    if (statusValue) statusValue.textContent = 'Super Admin';
    if (hudPersonalStatus) hudPersonalStatus.textContent = '⚡ Super Admin';
    if (hudPersonalTime) hudPersonalTime.textContent = 'Kelola semua sekolah';
  }

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

    // Pastikan dropdown options sudah ada sebelum set nilai
    initSelectOptions();

    if (cfgUsername) cfgUsername.value = config.username || '';
    if (cfgFonnteToken && config.fonnteToken) cfgFonnteToken.value = config.fonnteToken;
    if (cfgSchedulerEnabled) cfgSchedulerEnabled.checked = config.schedulerEnabled !== false;

    switchWaGatewayUI(config.waGateway || 'baileys');

    if (cfgSchedulerPagiEnabled) cfgSchedulerPagiEnabled.checked = config.schedulerPagiEnabled !== false;
    if (cfgPagiHour) cfgPagiHour.value = String(config.pagiHour ?? 7);
    if (cfgPagiMinute) cfgPagiMinute.value = String(config.pagiMinute ?? 30);

    if (cfgSchedulerSiangEnabled) cfgSchedulerSiangEnabled.checked = config.schedulerSiangEnabled !== false;
    if (cfgSiangHour) cfgSiangHour.value = String(config.siangHour ?? 15);
    if (cfgSiangMinute) cfgSiangMinute.value = String(config.siangMinute ?? 30);

    if (cfgSchedulerPulangEnabled) cfgSchedulerPulangEnabled.checked = config.schedulerPulangEnabled !== false;
    if (cfgPulangHour) cfgPulangHour.value = String(config.pulangHour ?? 18);
    if (cfgPulangMinute) cfgPulangMinute.value = String(config.pulangMinute ?? 0);

    if (cfgMessagePagi) cfgMessagePagi.value = config.messagePagi || '';
    if (cfgMessagePagiSudah) cfgMessagePagiSudah.value = config.messagePagiSudah || '';
    if (cfgMessageSiang) cfgMessageSiang.value = config.messageSiang || '';
    if (cfgMessageSiangSudah) cfgMessageSiangSudah.value = config.messageSiangSudah || '';
    if (cfgMessagePulang) cfgMessagePulang.value = config.messagePulang || '';
    if (cfgMessagePulangSudah) cfgMessagePulangSudah.value = config.messagePulangSudah || '';
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

// ─── Theme Switcher (Dark & Light Mode) ───────────────────────────────────────
const themeToggleIcon = document.getElementById('themeToggleIcon');
const themeToggleText = document.getElementById('themeToggleText');

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (themeToggleIcon) themeToggleIcon.textContent = '☀️';
    if (themeToggleText) themeToggleText.textContent = 'Light';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (themeToggleIcon) themeToggleIcon.textContent = '🌙';
    if (themeToggleText) themeToggleText.textContent = 'Dark';
  }
  localStorage.setItem('epresensi_theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('epresensi_theme') || 'dark';
  applyTheme(saved);
}

window.toggleAppTheme = function() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  applyTheme(isLight ? 'dark' : 'light');
};

initTheme();

// ─── Dynamic Avatar Initial Generator ─────────────────────────────────────────
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #8b5cf6, #6366f1)',
  'linear-gradient(135deg, #10b981, #06b6d4)',
  'linear-gradient(135deg, #f43f5e, #fb923c)',
  'linear-gradient(135deg, #3b82f6, #6366f1)',
  'linear-gradient(135deg, #f59e0b, #eab308)',
  'linear-gradient(135deg, #d946ef, #ec4899)'
];

function getTeacherAvatar(name) {
  if (!name) return '<span class="teacher-avatar" style="background: var(--accent-gradient)">GR</span>';
  const clean = name.replace(/S\.Kom|S\.Pd|M\.Pd|S\.T|M\.Kom|Dr\.|Drs\.|H\.|Hj\.|,/gi, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  let initials = parts[0] ? parts[0][0] : 'G';
  if (parts.length > 1) {
    initials += parts[parts.length - 1][0];
  } else if (parts[0] && parts[0].length > 1) {
    initials += parts[0][1];
  }
  initials = initials.toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const grad = AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];

  return `<span class="teacher-avatar" style="background: ${grad}">${initials}</span>`;
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
function updateDonutChart(percent) {
  const path = document.getElementById('hudDonutProgress');
  if (path) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    path.setAttribute('stroke-dasharray', `${clamped}, 100`);
    if (clamped >= 80) {
      path.style.stroke = 'var(--emerald-400)';
    } else if (clamped >= 50) {
      path.style.stroke = 'var(--purple-400)';
    } else {
      path.style.stroke = 'var(--rose-500)';
    }
  }
}

// ─── Shimmer Skeleton Table Loader ────────────────────────────────────────────
function renderTableSkeleton(tableBody, rows = 6, cols = 8) {
  if (!tableBody) return;
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const width = c === 3 ? '160px' : (c === 0 ? '18px' : (c === 2 ? '130px' : '55px'));
      html += `<td><span class="skeleton-box" style="width: ${width}; height: 16px;"></span></td>`;
    }
    html += '</tr>';
  }
  tableBody.innerHTML = html;
}

// ─── Multi-Select Batch Actions ───────────────────────────────────────────────
const selectedTeachers = new Map(); // key: identifier, val: { nama, nomor }
const floatingBatchBar  = document.getElementById('floatingBatchBar');
const batchCountTag     = document.getElementById('batchCountTag');
const batchCountBtn     = document.getElementById('batchCountBtn');
const btnSendBatchWa    = document.getElementById('btnSendBatchWa');
const btnCancelBatch    = document.getElementById('btnCancelBatch');
const selectAllColleagues = document.getElementById('selectAllColleagues');
const selectAllRecipients = document.getElementById('selectAllRecipients');

function updateBatchBar() {
  const count = selectedTeachers.size;
  if (count > 0) {
    if (batchCountTag) batchCountTag.textContent = `${count} Guru Terpilih`;
    if (batchCountBtn) batchCountBtn.textContent = count;
    floatingBatchBar?.classList.add('show');
  } else {
    floatingBatchBar?.classList.remove('show');
  }
}

window.toggleTeacherSelect = function(id, nama, nomor, checked) {
  if (checked) {
    selectedTeachers.set(id, { nama, nomor });
  } else {
    selectedTeachers.delete(id);
  }
  updateBatchBar();
};

if (btnCancelBatch) {
  btnCancelBatch.addEventListener('click', () => {
    selectedTeachers.clear();
    document.querySelectorAll('.teacher-select-cb').forEach(cb => cb.checked = false);
    updateBatchBar();
  });
}

if (btnSendBatchWa) {
  btnSendBatchWa.addEventListener('click', async () => {
    const list = Array.from(selectedTeachers.values()).filter(t => t.nomor);
    if (list.length === 0) {
      showToast('Tidak ada guru dengan nomor WA valid di pilihan Anda.', 'warning');
      return;
    }

    const confirmSend = confirm(`Kirim pesan WhatsApp sekarang ke ${list.length} guru yang Anda pilih?`);
    if (!confirmSend) return;

    showToast(`Mengirim pesan WhatsApp ke ${list.length} guru terpilih...`, 'info');
    let successCount = 0;

    for (const t of list) {
      try {
        const res = await fetch('/api/send-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nomor: t.nomor, nama: t.nama })
        });
        const data = await res.json();
        if (data.success) successCount++;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1200));
    }

    showToast(`✅ Berhasil terkirim ke ${successCount} dari ${list.length} guru terpilih!`, 'success');
    selectedTeachers.clear();
    document.querySelectorAll('.teacher-select-cb').forEach(cb => cb.checked = false);
    updateBatchBar();
    loadLogs();
  });
}

if (selectAllColleagues) {
  selectAllColleagues.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#colleaguesTableBody .teacher-select-cb').forEach(cb => {
      cb.checked = checked;
      const id = cb.dataset.id;
      const nama = cb.dataset.nama;
      const nomor = cb.dataset.nomor;
      if (checked) selectedTeachers.set(id, { nama, nomor });
      else selectedTeachers.delete(id);
    });
    updateBatchBar();
  });
}

if (selectAllRecipients) {
  selectAllRecipients.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#recipientsTableBody .teacher-select-cb').forEach(cb => {
      cb.checked = checked;
      const id = cb.dataset.id;
      const nama = cb.dataset.nama;
      const nomor = cb.dataset.nomor;
      if (checked) selectedTeachers.set(id, { nama, nomor });
      else selectedTeachers.delete(id);
    });
    updateBatchBar();
  });
}

// ─── Monitoring Rekan Guru (SMKN 3 Magelang with Instant Local Cache) ─────────
let selectedChartDay = null;

function applyColleaguesData(data) {
  colleagues = data.colleagues || [];
  const total = colleagues.length;
  const hadir = colleagues.filter(c => c.isHadir).length;
  const belum = total - hadir;
  
  // Count Izin (termasuk Dinas Luar & Tugas Luar) dan Sakit untuk hari yang dipilih
  const izinCount = colleagues.filter(c => c.status && (
    c.status.includes('Izin') || c.status.includes('Cuti') ||
    c.status === 'Dinas Luar' || c.status === 'Tugas Luar'
  )).length;
  const sakitCount = colleagues.filter(c => c.status && c.status.includes('Sakit')).length;
  // belumCount murni: tidak hadir, bukan Libur, bukan Izin/Cuti, bukan Sakit
  const belumMurniCount = colleagues.filter(c => !c.isHadir && c.status === 'Belum Absen').length;

  // Update Chips Counts
  if (countAllChip) countAllChip.textContent = total;
  if (countHadirChip) countHadirChip.textContent = hadir;
  if (countBelumChip) countBelumChip.textContent = belumMurniCount;
  if (countIzinChip) countIzinChip.textContent = izinCount;
  if (countSakitChip) countSakitChip.textContent = sakitCount;
  if (unabsentBadgeCount) unabsentBadgeCount.textContent = belumMurniCount;

  // Update Progress Bar & HUD Metrics
  const percentage = total > 0 ? parseFloat(((hadir / total) * 100).toFixed(1)) : 0;
  if (progressPercentageText) progressPercentageText.textContent = `${percentage}% Rekan Sudah Hadir`;
  if (progressFractionText) progressFractionText.textContent = `${hadir} / ${total} Guru`;
  if (progressBarFill) progressBarFill.style.width = `${percentage}%`;

  if (hudColleaguePercent) hudColleaguePercent.textContent = `${percentage}%`;
  if (hudColleagueFraction) hudColleagueFraction.textContent = `${hadir} / ${total} Guru Hadir`;
  
  const btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
  if (btnDownloadTemplate) btnDownloadTemplate.innerHTML = `📥 Unduh Template (${total} Guru)`;
  
  const templateAlertCount = document.getElementById('templateAlertCount');
  if (templateAlertCount) templateAlertCount.textContent = total;
  
  updateDonutChart(percentage);
  renderMonthlyAnalytics(colleagues);
  renderColleaguesTable();

  const datalist = document.getElementById('listGuruSkaniga');
  if (datalist) {
    datalist.innerHTML = colleagues.map(c => `<option value="${c.nama}">`).join('');
  }
}

// ─── 1-Month Analytics & Daily Attendance Chart Generator ─────────────────────
function renderMonthlyAnalytics(colleaguesList) {
  if (!colleaguesList || colleaguesList.length === 0) return;

  const totalTeachers = colleaguesList.length;
  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYear = now.getFullYear();
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const monthName = monthNames[currentMonthIdx];

  const schoolLabel = window.isSuperAdmin ? 'Total Semua Sekolah' : 'Sekolah Anda';
  if (monthlyAnalyticsSubtitle) {
    monthlyAnalyticsSubtitle.textContent = `Rekapitulasi presensi bulan ${monthName} ${currentYear} (${totalTeachers} Rekan Guru — ${schoolLabel})`;
  }
  const monthlyAnalyticsTitle = document.getElementById('monthlyAnalyticsTitle');
  if (monthlyAnalyticsTitle) {
    monthlyAnalyticsTitle.textContent = `Rekapitulasi & Analisis Presensi 1 Bulan (${totalTeachers} Rekan Guru)`;
  }

  // 1. Accumulate month totals across all teachers
  let aggHadir = 0;
  let aggBelum = 0;
  let aggIzin  = 0;
  let aggSakit = 0;

  // 2. Prepare 31-day daily buckets
  const daysInMonth = new Date(currentYear, currentMonthIdx + 1, 0).getDate();
  const dailyStats = Array.from({ length: daysInMonth }, (_, idx) => ({
    day: idx + 1,
    hadir: 0,
    belum: 0,
    izin: 0,
    sakit: 0,
    libur: 0,
    total: totalTeachers,
    isWeekend: false,
    hari: ''
  }));

  colleaguesList.forEach(c => {
    if (!c.monthHistory || !c.monthHistory.history) return;
    aggHadir += c.monthHistory.totalHadir || 0;
    aggBelum += c.monthHistory.totalBelum || 0;
    aggIzin  += c.monthHistory.totalIzin || 0;
    aggSakit += c.monthHistory.totalSakit || 0;

    c.monthHistory.history.forEach((h, hIdx) => {
      if (hIdx >= daysInMonth) return;
      const bucket = dailyStats[hIdx];
      bucket.isWeekend = h.isWeekend;
      bucket.hari = h.hari;

      if (h.isHadir) {
        bucket.hadir++;
      } else if (h.status && (h.status.includes('Izin') || h.status.includes('Cuti'))) {
        bucket.izin++;
      } else if (h.status && h.status.includes('Sakit')) {
        bucket.sakit++;
      } else if (h.isWeekend || (h.status && h.status.includes('Libur'))) {
        bucket.libur++;
      } else if (h.isPast || h.isToday) {
        bucket.belum++;
      }
    });
  });

  const totalActions = aggHadir + aggBelum + aggIzin + aggSakit;
  const pctHadir = totalActions > 0 ? ((aggHadir / totalActions) * 100).toFixed(1) : 0;
  const pctBelum = totalActions > 0 ? ((aggBelum / totalActions) * 100).toFixed(1) : 0;
  const pctIzin  = totalActions > 0 ? ((aggIzin / totalActions) * 100).toFixed(1) : 0;
  const pctSakit = totalActions > 0 ? ((aggSakit / totalActions) * 100).toFixed(1) : 0;

  if (monthlyTotalHadir) monthlyTotalHadir.textContent = aggHadir.toLocaleString('id-ID');
  if (monthlyPctHadir)   monthlyPctHadir.textContent   = `${pctHadir}%`;
  if (monthlyTotalBelum) monthlyTotalBelum.textContent = aggBelum.toLocaleString('id-ID');
  if (monthlyPctBelum)   monthlyPctBelum.textContent   = `${pctBelum}%`;
  if (monthlyTotalIzin)  monthlyTotalIzin.textContent  = aggIzin.toLocaleString('id-ID');
  if (monthlyPctIzin)    monthlyPctIzin.textContent    = `${pctIzin}%`;
  if (monthlyTotalSakit) monthlyTotalSakit.textContent = aggSakit.toLocaleString('id-ID');
  if (monthlyPctSakit)   monthlyPctSakit.textContent   = `${pctSakit}%`;

  // 3. Render Daily Stacked Bars
  if (!dailyChartBars) return;

  // Force horizontal flex layout on the chart container (inline style = highest priority)
  Object.assign(dailyChartBars.style, {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-end',
    height: '130px',
    gap: '3px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    paddingBottom: '8px',
    width: '100%'
  });

  const currentSelectedDay = parseInt(colleagueDaySelect ? colleagueDaySelect.value : now.getDate());
  const colStyle = 'display:inline-flex;flex-direction:column;align-items:center;flex:1;height:100%;cursor:pointer;border-radius:6px;padding:2px 1px;min-width:0;';
  const trackStyle = 'flex:1;width:10px;border-radius:4px;overflow:hidden;display:flex;flex-direction:column-reverse;background:rgba(255,255,255,0.06);';

  // If no colleagues data at all, render skeleton placeholder bars
  if (totalTeachers === 0) {
    dailyChartBars.innerHTML = Array.from({ length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }, (_, i) => {
      const d = i + 1;
      const dateObj = new Date(now.getFullYear(), now.getMonth(), d);
      const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const hari = dayNames[dateObj.getDay()];
      const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
      const bg = isWeekend ? 'rgba(255,255,255,0.08)' : 'rgba(168,85,247,0.2)';
      return `<div style="${colStyle}" data-day="${d}" onclick="selectChartDay(${d})" title="Tgl ${d} (${hari})">
        <div style="${trackStyle}"><div style="width:100%;height:${isWeekend?'100':'5'}%;background:${bg};"></div></div>
        <span style="font-size:0.62rem;font-family:monospace;color:#64748b;margin-top:4px;font-weight:600;">${d}</span>
        <span style="font-size:0.55rem;color:#475569;">${hari}</span>
      </div>`;
    }).join('');
    return;
  }

  dailyChartBars.innerHTML = dailyStats.map(stat => {
    const isToday    = stat.day === now.getDate();
    const isSelected = stat.day === (selectedChartDay || currentSelectedDay);
    const hHadir = Math.max(stat.hadir / totalTeachers * 100, 0);
    const hBelum = Math.max(stat.belum / totalTeachers * 100, 0);
    const hIzin  = Math.max(stat.izin  / totalTeachers * 100, 0);
    const hSakit = Math.max(stat.sakit / totalTeachers * 100, 0);
    const hLibur = stat.isWeekend ? 100 : Math.max(stat.libur / totalTeachers * 100, 0);

    const extra = isToday    ? 'border:1px dashed rgba(168,85,247,0.6);background:rgba(168,85,247,0.08);'
                : isSelected ? 'background:rgba(168,85,247,0.15);'
                : '';

    return `<div style="${colStyle}${extra}" data-day="${stat.day}" onclick="selectChartDay(${stat.day})" title="Tgl ${stat.day} (${stat.hari}): ${stat.hadir} Hadir, ${stat.belum} Belum">
      <div style="${trackStyle}">
        ${hHadir > 0 ? `<div style="width:100%;height:${hHadir}%;background:#10b981;"></div>` : ''}
        ${hBelum > 0 ? `<div style="width:100%;height:${hBelum}%;background:#f43f5e;"></div>` : ''}
        ${hIzin  > 0 ? `<div style="width:100%;height:${hIzin}%;background:#f59e0b;"></div>`  : ''}
        ${hSakit > 0 ? `<div style="width:100%;height:${hSakit}%;background:#0ea5e9;"></div>` : ''}
        ${hLibur > 0 && hHadir === 0 ? `<div style="width:100%;height:${hLibur}%;background:rgba(255,255,255,0.15);"></div>` : ''}
      </div>
      <span style="font-size:0.62rem;font-family:monospace;color:${isToday?'#c084fc':'#64748b'};margin-top:4px;font-weight:600;">${stat.day}</span>
      <span style="font-size:0.55rem;color:${isToday?'#a855f7':'#475569'};">${(stat.hari||'').slice(0,3)}</span>
    </div>`;
  }).join('');
}

window.selectChartDay = function(day) {
  selectedChartDay = day;
  document.querySelectorAll('.day-bar-column').forEach(col => {
    col.classList.toggle('selected-day', parseInt(col.dataset.day) === day);
  });

  const now = new Date();
  const dayObj = new Date(now.getFullYear(), now.getMonth(), day);
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const dayName = dayNames[dayObj.getDay()];
  const isWeekend = (dayName === 'Sabtu' || dayName === 'Minggu');

  // Count stats for this day across colleagues
  let hadir = 0, belum = 0, izin = 0, sakit = 0, libur = 0;
  colleagues.forEach(c => {
    if (c.monthHistory && c.monthHistory.history && c.monthHistory.history[day - 1]) {
      const h = c.monthHistory.history[day - 1];
      if (h.isHadir) hadir++;
      else if (h.status && (h.status.includes('Izin') || h.status.includes('Cuti'))) izin++;
      else if (h.status && h.status.includes('Sakit')) sakit++;
      else if (isWeekend || (h.status && h.status.includes('Libur'))) libur++;
      else belum++;
    }
  });

  if (popupDateText) popupDateText.textContent = `📅 ${dayName}, ${day} ${months[now.getMonth()]} ${now.getFullYear()}`;
  if (popupSubText) popupSubText.textContent = `Rekapitulasi 98 guru pada tanggal ${day}`;

  if (popupBadgesContainer) {
    popupBadgesContainer.innerHTML = `
      <span class="mini-stat-badge mini-badge-hadir">🟢 ${hadir} Hadir</span>
      ${belum > 0 ? `<span class="mini-stat-badge mini-badge-belum">🔴 ${belum} Belum Absen</span>` : ''}
      ${izin > 0 ? `<span class="mini-stat-badge mini-badge-izin">🟡 ${izin} Izin/Cuti</span>` : ''}
      ${sakit > 0 ? `<span class="mini-stat-badge mini-badge-sakit">🔵 ${sakit} Sakit</span>` : ''}
      ${isWeekend ? `<span class="mini-stat-badge mini-badge-libur">⚪ Libur Akhir Pekan</span>` : ''}
    `;
  }

  if (activeDayPopup) activeDayPopup.style.display = 'flex';
};

if (btnApplyDayFromChart) {
  btnApplyDayFromChart.addEventListener('click', () => {
    if (selectedChartDay) {
      selectDatePill(selectedChartDay);
      showToast(`Menampilkan data presensi Tanggal ${selectedChartDay}`, 'info');
      document.querySelector('.table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

if (btnToggleAnalyticsChart && analyticsChartBody) {
  btnToggleAnalyticsChart.addEventListener('click', () => {
    const isHidden = analyticsChartBody.style.display === 'none';
    analyticsChartBody.style.display = isHidden ? 'block' : 'none';
    if (toggleAnalyticsIcon) toggleAnalyticsIcon.textContent = isHidden ? '📉' : '📊';
    if (toggleAnalyticsText) toggleAnalyticsText.textContent = isHidden ? 'Sembunyikan Grafik' : 'Buka Grafik 1 Bulan';
  });
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

  // Jika belum ada cache lokal sama sekali, tampilkan shimmer skeleton
  if (!hasRenderedFromCache) {
    renderTableSkeleton(colleaguesTableBody, 8, 8);
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
            <td colspan="8" class="table-empty" style="padding: 32px 16px;">
              <div style="font-size: 2.2rem; margin-bottom: 8px;">🔑</div>
              <div style="font-weight: 700; color: var(--rose-400); font-size: 1.05rem; margin-bottom: 6px;">
                Sesi ePresensi Memerlukan Login Ulang
              </div>
              <div style="color: var(--text-muted); font-size: 0.84rem; max-width: 460px; margin: 0 auto 18px; line-height: 1.55;">
                ${escapeHtml(data.error || 'Sesi login telah berakhir atau password ePresensi perlu dimasukkan ulang.')}
              </div>
              <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
                <button type="button" class="modern-btn btn-purple-gradient btn-sm" onclick="window.openSchoolAccountModal()">
                  🏫 Masuk / Ganti Akun Sekolah
                </button>
                <button type="button" class="modern-btn btn-glass btn-sm" onclick="window.switchNavTab('config')">
                  ⚙️ Pengaturan ePresensi
                </button>
              </div>
            </td>
          </tr>`;
      }
      return;
    }

    // Hapus cache hari lain dulu agar localStorage tidak meluap (quota ~5MB)
    try {
      const keysToDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('epresensi_cache_day_') && k !== cacheKey) keysToDelete.push(k);
      }
      keysToDelete.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (quotaErr) {
      console.warn('[Cache] localStorage quota exceeded, skip cache:', quotaErr.message);
    }
    applyColleaguesData(data);

    if (force) {
      showToast(`✅ Data presensi ${colleagues.length} guru berhasil diperbarui!`, 'success');
    }
  } catch (err) {
    if (!hasRenderedFromCache && colleaguesTableBody) {
      colleaguesTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="table-empty" style="color: var(--rose-500);">
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
    const matchSearch = (c.nama || '').toLowerCase().includes(query) || (c.nip || '').includes(query);
    if (!matchSearch) return false;

    if (activeFilter === 'hadir') return c.isHadir;
    // belum: hanya status "Belum Absen" murni, exclude Sakit, Izin, Cuti, Dinas Luar, Tugas Luar, Libur
    if (activeFilter === 'belum') return !c.isHadir && c.status === 'Belum Absen';
    // izin: termasuk Dinas Luar & Tugas Luar
    if (activeFilter === 'izin') return c.status && (
      c.status.includes('Izin') || c.status.includes('Cuti') ||
      c.status === 'Dinas Luar' || c.status === 'Tugas Luar'
    );
    if (activeFilter === 'sakit') return c.status && c.status.includes('Sakit');
    
    // Monthly Filters
    if (activeFilter === 'monthly_hadir') return c.monthHistory && c.monthHistory.totalHadir > 0;
    if (activeFilter === 'monthly_belum') return c.monthHistory && c.monthHistory.totalBelum > 0;
    if (activeFilter === 'monthly_izin') return c.monthHistory && c.monthHistory.totalIzin > 0;
    if (activeFilter === 'monthly_sakit') return c.monthHistory && c.monthHistory.totalSakit > 0;

    return true;
  });

  if (tableSummaryFootnote) tableSummaryFootnote.textContent = `Menampilkan ${filtered.length} dari ${colleagues.length} rekan guru`;

  if (filtered.length === 0) {
    colleaguesTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="table-empty">
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
    } else if (c.status.includes('Izin') || c.status.includes('Cuti') || c.status === 'Dinas Luar' || c.status === 'Tugas Luar') {
      badgeClass = 'badge-status badge-status-izin';
    } else if (c.status.includes('Sakit')) {
      badgeClass = 'badge-status badge-status-sakit';
    } else {
      badgeClass = 'badge-status badge-status-belum';
    }

    const cleanC = c.nama ? c.nama.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const matchedRecipient = Array.isArray(recipients) ? recipients.find(r => {
      const cleanR = (r.nama || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanR.includes(cleanC) || cleanC.includes(cleanR);
    }) : null;

    const isSelected = selectedTeachers.has(c.nip || c.no);
    const waBtnHtml = matchedRecipient
      ? `<button class="modern-btn btn-purple btn-xs mr-1" onclick="sendDirectWa('${matchedRecipient.nomor}', '${escapeHtml(c.nama).replace(/'/g, "\\'")}',${ c.isHadir ? 'true' : 'false'})" title="Kirim WA ke ${escapeHtml(c.nama)}">
          💬 WA
        </button>`
      : '';

    return `
      <tr>
        <td class="text-center">
          <input type="checkbox" class="teacher-select-cb" ${isSelected ? 'checked' : ''} data-id="${c.nip || c.no}" data-nama="${escapeHtml(c.nama)}" data-nomor="${matchedRecipient ? matchedRecipient.nomor : ''}" onchange="toggleTeacherSelect('${c.nip || c.no}', '${escapeHtml(c.nama).replace(/'/g, "\\'")}', '${matchedRecipient ? matchedRecipient.nomor : ''}', this.checked)">
        </td>
        <td class="text-muted font-mono">${c.no}</td>
        <td class="font-mono text-muted">${c.nip || '-'}</td>
        <td>
          <div class="teacher-avatar-wrap">
            ${getTeacherAvatar(c.nama)}
            <a href="javascript:void(0)" class="teacher-link" onclick="openTeacherHistory('${c.nip}', '${escapeHtml(c.nama)}')">
              <strong>${escapeHtml(c.nama)}</strong>${window.isSuperAdmin && c.namaSekolah ? `<span style="font-size: 0.75rem; color: var(--purple-400); font-weight: 600; margin-left: 6px;">(${escapeHtml(c.namaSekolah)})</span>` : ''}
              <small>Lihat Riwayat 1 Bulan &rarr;</small>
            </a>
          </div>
        </td>
        <td class="font-mono">${c.jamMasuk ? `<strong>${c.jamMasuk}</strong>` : '-'}</td>
        <td class="font-mono">${c.jamPulang ? `<strong>${c.jamPulang}</strong>` : '-'}</td>
        <td><span class="${badgeClass}">${c.status}</span></td>
        <td class="text-center" style="white-space: nowrap;">
          ${waBtnHtml}
          <button class="modern-btn btn-glass btn-xs" onclick="openTeacherHistory('${c.nip}', '${escapeHtml(c.nama)}')">
            Detail
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Filter Pills Event ───────────────────────────────────────────────────────
[chipFilterAll, chipFilterBelum, chipFilterHadir, chipFilterIzin, chipFilterSakit].forEach(chip => {
  if (chip) {
    chip.addEventListener('click', () => {
      window.setFilter(chip.dataset.filter, chip);
    });
  }
});

window.setFilter = function(filterType, chipElement = null) {
  activeFilter = filterType;
  
  // Reset all active states
  document.querySelectorAll('.pill-btn').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.analytics-stat-box').forEach(b => {
    b.style.boxShadow = 'none';
    b.style.borderColor = 'var(--border-glass)';
  });

  if (chipElement) {
    // It's a daily pill click
    chipElement.classList.add('active');
  } else {
    // It's a monthly stat box click
    // Also reset pills to 'Semua' visually so they don't look active
    const statBoxClass = filterType.replace('monthly_', 'stat-box-');
    const box = document.querySelector('.' + statBoxClass);
    if (box) {
      box.style.boxShadow = '0 0 15px rgba(168, 85, 247, 0.4)';
      box.style.borderColor = 'rgba(168, 85, 247, 0.8)';
    }
  }

  renderColleaguesTable();
};

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

if (btnQuickSendUnabsent) btnQuickSendUnabsent.addEventListener('click', triggerSendUnabsent);

// ─── Teacher 1-Month History Modal (Instant 0ms from Preloaded In-Memory Data) ──
function renderHistoryModalContent(nama, nip, monthHistory) {
  if (historyModalTeacherName) historyModalTeacherName.textContent = nama;
  if (historyModalTeacherNip) historyModalTeacherNip.textContent = `NIP: ${nip || '-'}`;
  if (historyStatHadir) historyStatHadir.textContent = monthHistory.totalHadir ?? 0;
  if (historyStatIzin)  historyStatIzin.textContent  = monthHistory.totalIzin ?? 0;
  if (historyStatSakit) historyStatSakit.textContent = monthHistory.totalSakit ?? 0;
  if (historyStatBelum) historyStatBelum.textContent = monthHistory.totalBelum ?? 0;

  const list = monthHistory.history || [];
  if (!historyTableBody) return;

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
}

window.openTeacherHistory = async function(nip, nama) {
  if (!nip) {
    showToast('NIP guru tidak valid.', 'error');
    return;
  }

  // 1. INSTANT ZERO-LATENCY PATH: check in-memory colleagues array already loaded in background
  const teacher = colleagues.find(c => String(c.nip).trim() === String(nip).trim());
  if (teacher && teacher.monthHistory && teacher.monthHistory.history && teacher.monthHistory.history.length > 0) {
    renderHistoryModalContent(nama, nip, teacher.monthHistory);
    colleagueHistoryModal?.classList.add('show');
    return;
  }

  // 2. Fallback: if not yet in memory, show loading and fetch from API
  if (historyModalTeacherName) historyModalTeacherName.textContent = nama;
  if (historyModalTeacherNip) historyModalTeacherNip.textContent = `NIP: ${nip}`;
  if (historyStatHadir) historyStatHadir.textContent = '-';
  if (historyStatIzin)  historyStatIzin.textContent  = '-';
  if (historyStatSakit) historyStatSakit.textContent = '-';
  if (historyStatBelum) historyStatBelum.textContent = '-';

  if (historyTableBody) {
    historyTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">
          <div class="loading-spinner"></div>
          <span>Memuat riwayat presensi 1 bulan untuk ${nama}...</span>
        </td>
      </tr>`;
  }

  colleagueHistoryModal?.classList.add('show');

  try {
    const res = await fetch(`/api/colleagues/${nip}/history`);
    const data = await res.json();

    if (!data.success) {
      if (historyTableBody) {
        historyTableBody.innerHTML = `
          <tr>
            <td colspan="5" class="table-empty" style="color: var(--rose-500);">
              ❌ Gagal memuat riwayat: ${data.error}
            </td>
          </tr>`;
      }
      return;
    }

    renderHistoryModalContent(data.nama || nama, nip, data);
  } catch (err) {
    if (historyTableBody) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="table-empty" style="color: var(--rose-500);">
            ❌ Error: ${err.message}
          </td>
        </tr>`;
    }
  }
};

if (btnCloseHistoryModal) btnCloseHistoryModal.addEventListener('click', () => colleagueHistoryModal?.classList.remove('show'));
if (btnCloseHistoryModalBtn) btnCloseHistoryModalBtn.addEventListener('click', () => colleagueHistoryModal?.classList.remove('show'));
if (colleagueHistoryModal) {
  colleagueHistoryModal.addEventListener('click', (e) => {
    if (e.target === colleagueHistoryModal) colleagueHistoryModal.classList.remove('show');
  });
}

// ─── Recipients Management ────────────────────────────────────────────────────
async function loadRecipients() {
  try {
    const res = await fetch('/api/recipients');
    const data = await res.json();
    // Guard: API returns object {success:false} when session expired
    if (Array.isArray(data)) {
      recipients = data;
    } else if (data && Array.isArray(data.recipients)) {
      recipients = data.recipients;
    } else {
      recipients = [];
      if (data && data.needLogin) {
        showToast('Sesi habis, silakan login ulang di Pengaturan.', 'error');
      }
    }
    if (recipientTotalCount) recipientTotalCount.textContent = `Total: ${recipients.length} Guru Terdaftar`;
    if (hudRecipientCount) hudRecipientCount.textContent = recipients.length;
    renderRecipientsTable();
  } catch (err) {
    console.error('Error loadRecipients:', err);
  }
}

function renderRecipientsTable() {
  const thAsal = document.getElementById('thAsalSekolah');
  if (thAsal) thAsal.style.display = window.isSuperAdmin ? '' : 'none';

  if (recipients.length === 0) {
    recipientsTableBody.innerHTML = `
      <tr>
        <td colspan="${window.isSuperAdmin ? '7' : '6'}" class="table-empty">
          Belum ada nomor guru terdaftar. Silakan import Excel atau tambah manual.
        </td>
      </tr>`;
    return;
  }

  recipientsTableBody.innerHTML = recipients.map((r, i) => {
    const isSelected = selectedTeachers.has(r.id);
    const externalBadge = r.is_external
      ? `<span style="display:inline-block;margin-left:6px;padding:2px 7px;border-radius:6px;font-size:0.72rem;font-weight:700;background:rgba(249,115,22,0.18);color:#fb923c;border:1px solid rgba(249,115,22,0.35);vertical-align:middle;">🌐 EKSTERNAL</span>`
      : '';
    const sekolahInfo = r.is_external && r.sekolah_asal
      ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">${escapeHtml(r.sekolah_asal)}</div>`
      : '';
    return `
    <tr>
      <td class="text-center">
        <input type="checkbox" class="teacher-select-cb" ${isSelected ? 'checked' : ''} data-id="${r.id}" data-nama="${escapeHtml(r.nama)}" data-nomor="${r.nomor}" onchange="toggleTeacherSelect('${r.id}', '${escapeHtml(r.nama).replace(/'/g, "\\'")}', '${r.nomor}', this.checked)">
      </td>
      <td class="text-muted font-mono">${i + 1}</td>
      <td>
        <div class="teacher-avatar-wrap">
          ${getTeacherAvatar(r.nama)}
          <strong>${escapeHtml(r.nama)}</strong>
        </div>
      </td>
      <td class="font-mono">${r.nomor}</td>
      ${window.isSuperAdmin ? `<td><span class="badge" style="background: rgba(147, 51, 234, 0.2); color: #d8b4fe; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem;">${r.schools ? escapeHtml(r.schools.name) : 'Tidak Terikat'}</span></td>` : ''}
      <td>
        <label class="custom-switch" style="transform: scale(0.8);">
          <input type="checkbox" ${r.aktif !== false ? 'checked' : ''} onchange="toggleRecipientActive('${r.id}', this.checked)">
          <span class="switch-slider"></span>
        </label>
      </td>
      <td class="text-center" style="white-space: nowrap;">
        <button class="modern-btn btn-purple btn-xs mr-1" onclick="sendDirectWa('${r.nomor}', '${escapeHtml(r.nama).replace(/'/g, "\\'")}')" title="Kirim Pesan WhatsApp Langsung">
          💬 Kirim WA
        </button>
        <button class="modern-btn btn-glass btn-xs mr-1" onclick="openEditRecipient('${r.id}', '${escapeHtml(r.nama).replace(/'/g, "\\'")}', '${r.nomor}')">
          ✏️ Edit
        </button>
        <button class="modern-btn btn-danger-ghost btn-xs" onclick="deleteRecipient('${r.id}')">
          🗑️ Hapus
        </button>
      </td>
    </tr>
  `}).join('');
}

window.sendDirectWa = async function(nomor, nama, isHadir = null) {
  if (!nomor) {
    showToast('Nomor WhatsApp tidak valid.', 'error');
    return;
  }

  const confirmSend = confirm(`Kirim pesan WhatsApp pengingat presensi sekarang ke ${nama} (${nomor})?`);
  if (!confirmSend) return;

  showToast(`Mengirim WhatsApp ke ${nama}...`, 'info');
  try {
    const res = await fetch('/api/send-direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomor, nama, isHadir })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Pesan WhatsApp berhasil dikirim ke ${nama}!`, 'success');
      loadLogs();
    } else {
      showToast(`Gagal kirim: ${data.error || 'Terjadi kesalahan'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

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

window.openEditRecipient = function(id, nama, nomor, isExternal = false, sekolahAsal = '') {
  if (editRecipientId) editRecipientId.value = id;
  if (editNama) editNama.value = nama;
  if (editNomor) editNomor.value = nomor;
  const editExtCb = document.getElementById('editIsExternal');
  const editSekolahWrap = document.getElementById('editSekolahAsalWrap');
  const editSekolahInput = document.getElementById('editSekolahAsal');
  if (editExtCb) editExtCb.checked = !!isExternal;
  if (editSekolahInput) editSekolahInput.value = sekolahAsal || '';
  if (editSekolahWrap) editSekolahWrap.style.display = isExternal ? '' : 'none';
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
  // Toggle sekolah asal field di modal edit
  const editExtCb = document.getElementById('editIsExternal');
  const editSekolahWrap = document.getElementById('editSekolahAsalWrap');
  if (editExtCb && editSekolahWrap) {
    editExtCb.addEventListener('change', () => {
      editSekolahWrap.style.display = editExtCb.checked ? '' : 'none';
    });
  }

  editRecipientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editRecipientId.value;
    const nama = editNama.value.trim();
    const nomor = editNomor.value.trim();
    const isExternal = document.getElementById('editIsExternal')?.checked || false;
    const sekolahAsal = document.getElementById('editSekolahAsal')?.value.trim() || '';

    try {
      const res = await fetch(`/api/recipients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama, nomor, is_external: isExternal, sekolah_asal: sekolahAsal })
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
  // Toggle sekolah asal field di modal tambah
  const manualExtCb = document.getElementById('manualIsExternal');
  const manualSekolahWrap = document.getElementById('manualSekolahAsalWrap');
  if (manualExtCb && manualSekolahWrap) {
    manualExtCb.addEventListener('change', () => {
      manualSekolahWrap.style.display = manualExtCb.checked ? '' : 'none';
    });
  }

  addRecipientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const namaVal = document.getElementById('manualNama').value.trim();
    const nomor = document.getElementById('manualNomor').value.trim();
    const isExternal = document.getElementById('manualIsExternal')?.checked || false;
    const sekolahAsal = document.getElementById('manualSekolahAsal')?.value.trim() || '';

    let school_id = null;
    if (window.isSuperAdmin && typeof colleagues !== 'undefined') {
      const c = colleagues.find(x => x.nama.toLowerCase() === namaVal.toLowerCase());
      if (c && c.school_id) school_id = c.school_id;
    }

    try {
      const res = await fetch('/api/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama: namaVal, nomor, school_id, is_external: isExternal, sekolah_asal: sekolahAsal })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(`Gagal: ${data.error}`, 'error');
      } else {
        showToast('Penerima berhasil ditambahkan!', 'success');
        addRecipientModal.classList.remove('show');
        addRecipientForm.reset();
        if (manualSekolahWrap) manualSekolahWrap.style.display = 'none';
        loadRecipients();
        loadStatus();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}

if (excelFileInput) {
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
}

// ─── Instant Actions ──────────────────────────────────────────────────────────
if (btnCheckOnly) btnCheckOnly.addEventListener('click', () => performCheck(false));

if (btnCheckAndSend) {
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
}

if (btnSendNow) {
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
}

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
      schedulerSiangEnabled: cfgSchedulerSiangEnabled ? cfgSchedulerSiangEnabled.checked : true,
      siangHour: parseInt(cfgSiangHour?.value ?? 15),
      siangMinute: parseInt(cfgSiangMinute?.value ?? 30),
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

// ─── Manual Trigger Scheduler ─────────────────────────────────────────────────
async function runNowScheduler(type) {
  const btn = type === 'pagi'
    ? document.getElementById('btnRunNowPagi')
    : document.getElementById('btnRunNowPulang');
  const label = type === 'pagi' ? '🌅 Pagi' : '🌆 Pulang';
  const origText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `⏳ Mengirim ${label}...`; }
  try {
    const res = await fetch('/api/scheduler/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || `${label}: Selesai!`, 'success');
      loadLogs();
    } else {
      showToast(`${label} Error: ${data.message}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
}

const btnRunNowPagi   = document.getElementById('btnRunNowPagi');
const btnRunNowPulang = document.getElementById('btnRunNowPulang');
if (btnRunNowPagi)   btnRunNowPagi.addEventListener('click',   () => runNowScheduler('pagi'));
if (btnRunNowPulang) btnRunNowPulang.addEventListener('click', () => runNowScheduler('pulang'));

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

function formatWaHtml(tmpl) {
  if (!tmpl) return '';
  const sanitized = escapeHtml(tmpl);
  return sanitized
    .replace(/\{nama\}/gi, 'Bapak/Ibu Guru')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function updateMessagePreviews() {
  if (cfgMessagePagi && whatsappPreviewPagi) {
    whatsappPreviewPagi.innerHTML = formatWaHtml(cfgMessagePagi.value);
  }
  if (cfgMessagePagiSudah && whatsappPreviewPagiSudah) {
    whatsappPreviewPagiSudah.innerHTML = formatWaHtml(cfgMessagePagiSudah.value);
  }
  if (cfgMessageSiang && whatsappPreviewSiang) {
    whatsappPreviewSiang.innerHTML = formatWaHtml(cfgMessageSiang.value);
  }
  if (cfgMessageSiangSudah && whatsappPreviewSiangSudah) {
    whatsappPreviewSiangSudah.innerHTML = formatWaHtml(cfgMessageSiangSudah.value);
  }
  if (cfgMessagePulang && whatsappPreviewPulang) {
    whatsappPreviewPulang.innerHTML = formatWaHtml(cfgMessagePulang.value);
  }
  if (cfgMessagePulangSudah && whatsappPreviewPulangSudah) {
    whatsappPreviewPulangSudah.innerHTML = formatWaHtml(cfgMessagePulangSudah.value);
  }
}

if (cfgMessagePagi) cfgMessagePagi.addEventListener('input', updateMessagePreviews);
if (cfgMessagePagiSudah) cfgMessagePagiSudah.addEventListener('input', updateMessagePreviews);
if (cfgMessageSiang) cfgMessageSiang.addEventListener('input', updateMessagePreviews);
if (cfgMessageSiangSudah) cfgMessageSiangSudah.addEventListener('input', updateMessagePreviews);
if (cfgMessagePulang) cfgMessagePulang.addEventListener('input', updateMessagePreviews);
if (cfgMessagePulangSudah) cfgMessagePulangSudah.addEventListener('input', updateMessagePreviews);

if (btnSaveTemplate) {
  btnSaveTemplate.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messagePagi: cfgMessagePagi?.value || '',
          messagePagiSudah: cfgMessagePagiSudah?.value || '',
          messageSiang: cfgMessageSiang?.value || '',
          messageSiangSudah: cfgMessageSiangSudah?.value || '',
          messagePulang: cfgMessagePulang?.value || '',
          messagePulangSudah: cfgMessagePulangSudah?.value || ''
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

// ─── Logs & Log Detail Modal ──────────────────────────────────────────────────
const logDetailModal       = document.getElementById('logDetailModal');
const btnCloseLogModal     = document.getElementById('btnCloseLogModal');
const btnCloseLogModalBtn  = document.getElementById('btnCloseLogModalBtn');
const btnCopyLogMessage    = document.getElementById('btnCopyLogMessage');
const logModalBadge        = document.getElementById('logModalBadge');
const logModalTitle        = document.getElementById('logModalTitle');
const logModalTime         = document.getElementById('logModalTime');
const logModalMetaCard     = document.getElementById('logModalMetaCard');
const logModalRecipient    = document.getElementById('logModalRecipient');
const logModalPhone        = document.getElementById('logModalPhone');
const logModalMessageBox   = document.getElementById('logModalMessageBox');
const logModalMessageBody  = document.getElementById('logModalMessageBody');
const logModalMultiTargets = document.getElementById('logModalMultiTargets');
const logModalTargetsList  = document.getElementById('logModalTargetsList');

let activeLogRawMessage = '';

async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    // Guard: API may return {success:false} when session expired
    logs = Array.isArray(data) ? data : (Array.isArray(data?.logs) ? data.logs : []);
    renderLogs();
  } catch (err) {
    console.error('Error loadLogs:', err);
  }
}

function renderLogs() {
  if (!logsContainer) return;
  if (!logs || logs.length === 0) {
    logsContainer.innerHTML = '<div class="empty-feed">Belum ada aktivitas tercatat.</div>';
    return;
  }

  logsContainer.innerHTML = logs.map((l, idx) => {
    const d = new Date(l.timestamp);
    const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let color = 'var(--text-primary)';
    let isWaLog = false;

    if (l.type === 'sent') {
      color = 'var(--emerald-400)';
      isWaLog = true;
    } else if (l.type === 'error') {
      color = 'var(--rose-400)';
      if (l.message?.includes('Kirim') || l.message?.includes('WA')) isWaLog = true;
    } else if (l.message?.includes('WhatsApp') || l.message?.includes('Kirim')) {
      isWaLog = true;
    }

    const actionBadge = isWaLog 
      ? `<button type="button" class="log-view-btn" onclick="event.stopPropagation(); window.openLogDetail(${idx})">💬 Lihat Pesan &rarr;</button>` 
      : `<button type="button" class="log-view-btn log-view-btn-ghost" onclick="event.stopPropagation(); window.openLogDetail(${idx})">👁️ Detail</button>`;

    return `
      <div class="log-row log-row-clickable" onclick="window.openLogDetail(${idx})" title="Klik untuk melihat rincian & pesan yang dikirim">
        <div class="log-row-left">
          <span class="log-msg-text" style="color: ${color};">${escapeHtml(l.message)}</span>
        </div>
        <div class="log-row-right">
          ${actionBadge}
          <span class="log-time">${dateStr}, ${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

window.openLogDetail = function(idx) {
  const l = logs[idx];
  if (!l) return;
  const modal = document.getElementById('logDetailModal');
  if (!modal) return;

  const d = new Date(l.timestamp);
  const formattedTime = d.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' });
  const timeEl = document.getElementById('logModalTime');
  if (timeEl) timeEl.textContent = formattedTime;

  let recipientName = '-';
  let recipientPhone = '-';
  let rawText = '';
  let isMulti = false;

  // Extract recipient info
  if (l.recipient) {
    recipientName = l.recipient.nama || '-';
    recipientPhone = l.recipient.nomor || '-';
  } else {
    // Try to parse from message string: "...ke Nama (08123456789)"
    const match = l.message.match(/ke\s+([^(]+?)(?:\s*\(([^)]+)\))?$/i);
    if (match) {
      recipientName = match[1]?.trim() || '-';
      recipientPhone = match[2]?.trim() || '-';
    }
  }

  // Extract message content
  if (l.detailMessage) {
    rawText = l.detailMessage;
  } else if (l.type === 'sent' || l.message.includes('Kirim Langsung') || l.message.includes('Notifikasi')) {
    // Fallback if detailMessage was not saved in older logs
    const defaultTmpl = config.messagePagi || config.message || 'Halo *{nama}*! 👋\n\nPengingat presensi:\nAnda tercatat belum melakukan *absen* hari ini di ePresensi Jateng.\n\nSegera lakukan presensi sekarang ya! ⏰\n\n_Pesan otomatis SMKN 3 Magelang_';
    rawText = defaultTmpl.replace(/\{nama\}/gi, recipientName !== '-' ? recipientName : 'Bapak/Ibu');
  } else {
    rawText = l.message;
  }

  // Check multi targets
  const multiBox = document.getElementById('logModalMultiTargets');
  const multiList = document.getElementById('logModalTargetsList');
  if (l.targets && Array.isArray(l.targets) && l.targets.length > 0) {
    isMulti = true;
    if (multiBox) multiBox.style.display = 'block';
    if (multiList) {
      multiList.innerHTML = l.targets.map(t => `
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 4px;">
          <strong>${escapeHtml(t.nama)}</strong>
          <span class="font-mono text-muted">${escapeHtml(t.nomor || '-')}</span>
        </div>
      `).join('');
    }
  } else {
    if (multiBox) multiBox.style.display = 'none';
  }

  activeLogRawMessage = rawText;

  // Update UI elements
  const badgeEl = document.getElementById('logModalBadge');
  const titleEl = document.getElementById('logModalTitle');
  if (l.type === 'sent') {
    if (badgeEl) { badgeEl.textContent = 'NOTIFIKASI WHATSAPP TERKIRIM'; badgeEl.style.color = 'var(--emerald-400)'; }
    if (titleEl) titleEl.textContent = 'Detail Pesan WhatsApp';
  } else if (l.type === 'error') {
    if (badgeEl) { badgeEl.textContent = 'LOG ERROR / GAGAL'; badgeEl.style.color = 'var(--rose-400)'; }
    if (titleEl) titleEl.textContent = 'Detail Kegagalan';
  } else {
    if (badgeEl) { badgeEl.textContent = 'LOG SISTEM'; badgeEl.style.color = 'var(--purple-400)'; }
    if (titleEl) titleEl.textContent = 'Rincian Aktivitas';
  }

  const metaCard = document.getElementById('logModalMetaCard');
  const recEl = document.getElementById('logModalRecipient');
  const phoneEl = document.getElementById('logModalPhone');
  if (recipientName !== '-' || recipientPhone !== '-') {
    if (metaCard) metaCard.style.display = 'block';
    if (recEl) recEl.textContent = recipientName;
    if (phoneEl) phoneEl.textContent = recipientPhone;
  } else {
    if (metaCard) metaCard.style.display = 'none';
  }

  const bodyEl = document.getElementById('logModalMessageBody');
  if (bodyEl) {
    bodyEl.innerHTML = formatWaHtml(rawText);
  }

  modal.classList.add('show');
};

if (btnCloseLogModal) btnCloseLogModal.addEventListener('click', () => document.getElementById('logDetailModal')?.classList.remove('show'));
if (btnCloseLogModalBtn) btnCloseLogModalBtn.addEventListener('click', () => document.getElementById('logDetailModal')?.classList.remove('show'));
const modalLogOverlay = document.getElementById('logDetailModal');
if (modalLogOverlay) {
  modalLogOverlay.addEventListener('click', (e) => {
    if (e.target === modalLogOverlay) modalLogOverlay.classList.remove('show');
  });
}

if (btnCopyLogMessage) {
  btnCopyLogMessage.addEventListener('click', () => {
    if (!activeLogRawMessage) return;
    navigator.clipboard.writeText(activeLogRawMessage).then(() => {
      showToast('📋 Pesan berhasil disalin ke clipboard!', 'success');
    }).catch(() => {
      showToast('Gagal menyalin teks', 'error');
    });
  });
}

window.clearAllLogs = async function() {
  if (!confirm('Apakah Anda yakin ingin menghapus semua catatan riwayat log aktivitas?')) return;
  try {
    const res = await fetch('/api/logs', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      logs = [];
      renderLogs();
      showToast('Log aktivitas dibersihkan', 'info');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', window.clearAllLogs);
}

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

// ─── Graphify Knowledge Graph UI ──────────────────────────────────────────────
const graphIframe             = document.getElementById('graphIframe');
const btnRefreshGraph         = document.getElementById('btnRefreshGraph');
const btnOpenGraphExternal    = document.getElementById('btnOpenGraphExternal');
const graphStatNodes          = document.getElementById('graphStatNodes');
const graphStatEdges          = document.getElementById('graphStatEdges');
const graphStatCommunities    = document.getElementById('graphStatCommunities');
const graphViewBtns           = document.querySelectorAll('.graph-view-btn');

async function loadGraphStats() {
  try {
    const res = await fetch('/api/graph/stats');
    const data = await res.json();
    if (data.success) {
      if (graphStatNodes) graphStatNodes.textContent = data.nodesCount;
      if (graphStatEdges) graphStatEdges.textContent = data.edgesCount;
      if (graphStatCommunities) graphStatCommunities.textContent = data.communityCount;
    }
  } catch (err) {
    console.error('Error loadGraphStats:', err);
  }
}

graphViewBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    graphViewBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const targetSrc = btn.dataset.src;
    if (graphIframe && targetSrc) {
      graphIframe.src = targetSrc;
    }
    if (btnOpenGraphExternal && targetSrc) {
      btnOpenGraphExternal.href = targetSrc;
    }
  });
});

if (btnRefreshGraph) {
  btnRefreshGraph.addEventListener('click', async () => {
    btnRefreshGraph.disabled = true;
    btnRefreshGraph.textContent = '⏳ Memproses AST...';
    showToast('Menganalisis kode & memperbarui Knowledge Graph...', 'info');

    try {
      const res = await fetch('/api/graph/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Knowledge Graph berhasil diperbarui!', 'success');
        loadGraphStats();
        if (graphIframe) {
          const currentSrc = graphIframe.src;
          graphIframe.src = '';
          setTimeout(() => { graphIframe.src = currentSrc; }, 300);
        }
        loadLogs();
      } else {
        showToast(`Gagal update graph: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btnRefreshGraph.disabled = false;
      btnRefreshGraph.textContent = '🔄 Update Graph';
    }
  });
}

// ─── Multi-School Account Management Controller ───────────────────────────────
const btnOpenSchoolModal      = document.getElementById('btnOpenSchoolModal');
const schoolAccountModal      = document.getElementById('schoolAccountModal');
const btnCloseSchoolModal     = document.getElementById('btnCloseSchoolModal');
const btnCloseSchoolModalBtn  = document.getElementById('btnCloseSchoolModalBtn');
const topbarSchoolName        = document.getElementById('topbarSchoolName');
const topbarSubtitle          = document.getElementById('topbarSubtitle');
const savedAccountsList       = document.getElementById('savedAccountsList');
const savedAccountsCount      = document.getElementById('savedAccountsCount');
const formAddSchoolAccount    = document.getElementById('formAddSchoolAccount');
const newAccUsername          = document.getElementById('newAccUsername');
const newAccPassword          = document.getElementById('newAccPassword');
const newAccSchoolName        = document.getElementById('newAccSchoolName');
const btnSubmitAddAccount     = document.getElementById('btnSubmitAddAccount');
const addAccountFeedback      = document.getElementById('addAccountFeedback');

let schoolAccounts = [];
let activeSchoolAccount = null;

async function loadSchoolAccounts() {
  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    activeSchoolAccount = data.activeAccount;
    schoolAccounts = data.accounts || [];

    if (topbarSchoolName && activeSchoolAccount) {
      topbarSchoolName.textContent = activeSchoolAccount.namaSekolah || 'SMKN 3 MAGELANG';
    }
    if (topbarSubtitle && activeSchoolAccount) {
      topbarSubtitle.textContent = `Sistem Monitoring & Notifikasi WhatsApp — ${activeSchoolAccount.namaSekolah || 'SMKN 3 Magelang'}`;
    }

    renderSavedAccounts();
  } catch (err) {
    console.error('Error loadSchoolAccounts:', err);
  }
}

function renderSavedAccounts() {
  if (!savedAccountsList) return;
  if (savedAccountsCount) savedAccountsCount.textContent = `${schoolAccounts.length} Akun Tersimpan`;

  if (schoolAccounts.length === 0) {
    savedAccountsList.innerHTML = `<div class="text-muted text-xs p-3 text-center">Belum ada akun sekolah tambahan tersimpan.</div>`;
    return;
  }

  savedAccountsList.innerHTML = schoolAccounts.map(acc => {
    const isActive = acc.isActive;
    const initial = (acc.namaSekolah || 'S').charAt(0).toUpperCase();

    const switchBtn = isActive
      ? `<span class="badge-status badge-status-hadir font-mono" style="font-size: 0.72rem; padding: 4px 10px;">🟢 Aktif</span>`
      : `<button type="button" class="modern-btn btn-purple btn-xs" onclick="switchSchoolAccount('${escapeHtml(acc.username)}')">⚡ Beralih</button>`;

    const deleteBtn = !isActive && schoolAccounts.length > 1
      ? `<button type="button" class="modern-btn btn-danger btn-xs" onclick="deleteSchoolAccount('${escapeHtml(acc.username)}')" title="Hapus Akun">🗑️</button>`
      : '';

    return `
      <div class="school-account-card ${isActive ? 'active-card' : ''}">
        <div class="school-acc-left">
          <div class="school-acc-avatar">${initial === 'S' ? '🏫' : '🎓'}</div>
          <div>
            <div class="school-acc-name">${escapeHtml(acc.namaSekolah || 'Unit Sekolah')}</div>
            <div class="school-acc-meta">👤 ${escapeHtml(acc.namaUser || acc.username)} • NIP: ${escapeHtml(acc.username)}</div>
          </div>
        </div>
        <div class="school-acc-actions">
          ${switchBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

window.switchSchoolAccount = async function(username) {
  showToast('Beralih akun sekolah & menghubungkan session...', 'info');
  try {
    const res = await fetch('/api/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();

    if (!data.success) {
      showToast(`Gagal beralih: ${data.error}`, 'error');
      return;
    }

    showToast(`🏫 Berhasil beralih ke ${data.account.namaSekolah}!`, 'success');
    if (schoolAccountModal) schoolAccountModal.classList.remove('show');

    // Reload all dashboard components
    await loadSchoolAccounts();
    await loadStatus();
    await loadConfig();
    await loadColleagues(true);
    await loadLogs();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.deleteSchoolAccount = async function(username) {
  if (!confirm(`Hapus akun ${username} dari daftar multi-sekolah?`)) return;
  try {
    const res = await fetch(`/api/accounts/${username}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Akun berhasil dihapus dari daftar.', 'info');
      loadSchoolAccounts();
    } else {
      showToast(`Gagal: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.openSchoolAccountModal = function() {
  loadSchoolAccounts();
  if (addAccountFeedback) addAccountFeedback.style.display = 'none';
  if (schoolAccountModal) {
    schoolAccountModal.classList.add('show');
  }
};

if (btnOpenSchoolModal) {
  btnOpenSchoolModal.addEventListener('click', window.openSchoolAccountModal);
}

if (btnCloseSchoolModal) btnCloseSchoolModal.addEventListener('click', () => schoolAccountModal?.classList.remove('show'));
if (btnCloseSchoolModalBtn) btnCloseSchoolModalBtn.addEventListener('click', () => schoolAccountModal?.classList.remove('show'));
if (schoolAccountModal) {
  schoolAccountModal.addEventListener('click', (e) => {
    if (e.target === schoolAccountModal) schoolAccountModal.classList.remove('show');
  });
}

if (formAddSchoolAccount) {
  formAddSchoolAccount.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = newAccUsername?.value.trim();
    const password = newAccPassword?.value.trim();
    const customSchoolName = newAccSchoolName?.value.trim();

    if (!username || !password) {
      showToast('Username dan Password wajib diisi.', 'warning');
      return;
    }

    btnSubmitAddAccount.disabled = true;
    btnSubmitAddAccount.textContent = '⏳ Masuk ke ePresensi...';
    if (addAccountFeedback) {
      addAccountFeedback.style.display = 'block';
      addAccountFeedback.style.color = 'var(--purple-400)';
      addAccountFeedback.textContent = 'Sedang melakukan autentikasi & mendeteksi profil sekolah...';
    }

    try {
      const res = await fetch('/api/accounts/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, customSchoolName })
      });
      const data = await res.json();

      if (!data.success) {
        if (addAccountFeedback) {
          addAccountFeedback.style.color = 'var(--rose-500)';
          addAccountFeedback.textContent = `❌ ${data.error}`;
        }
        showToast(`Login gagal: ${data.error}`, 'error');
        return;
      }

      showToast(`🎉 Berhasil masuk ke ${data.account.namaSekolah}!`, 'success');
      if (newAccUsername) newAccUsername.value = '';
      if (newAccPassword) newAccPassword.value = '';
      if (newAccSchoolName) newAccSchoolName.value = '';
      if (addAccountFeedback) addAccountFeedback.style.display = 'none';
      if (schoolAccountModal) schoolAccountModal.classList.remove('show');

      // Refresh everything
      await loadSchoolAccounts();
      await loadStatus();
      await loadConfig();
      await loadColleagues(true);
      await loadLogs();
    } catch (err) {
      if (addAccountFeedback) {
        addAccountFeedback.style.color = 'var(--rose-500)';
        addAccountFeedback.textContent = `❌ ${err.message}`;
      }
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btnSubmitAddAccount.disabled = false;
      btnSubmitAddAccount.textContent = '🚀 Masuk & Simpan Profil Sekolah';
    }
  });
}

// ─── Initialize ───────────────────────────────────────────────────────────────
checkAppAuth();
initSelectOptions();
buildDateStrip();      // render modern date strip on load

const currentInitRole = localStorage.getItem('epresensi_user_role') || 'school_admin';
// Selalu load status & monitoring untuk semua role (termasuk super_admin)
loadStatus();
loadColleagues();
if (currentInitRole !== 'super_admin') {
  loadSchoolAccounts();
  loadConfig();
  loadRecipients();
  loadLogs();
}
loadGraphStats();

// ─── Super Admin Module ────────────────────────────────────────────────────────
(function initSuperAdmin() {
  const navBtn      = document.getElementById('navSuperAdmin');
  const addWrap     = document.getElementById('formAddSchoolWrap');
  const formAdd     = document.getElementById('formAddSchool');
  const btnShow     = document.getElementById('btnShowAddSchool');
  const btnCancel   = document.getElementById('btnCancelAddSchool');
  const errEl       = document.getElementById('formAddSchoolError');
  const tbody       = document.getElementById('saasSchoolsBody');

  // Tab visibility dihandle oleh applyRoleUI() — tidak perlu cek lagi di sini

  // Expose agar applyRoleUI() bisa panggil setelah login
  window._saasLoadStats   = loadSaasStats;
  window._saasLoadSchools = loadSaasSchools;

  // Load Stats
  async function loadSaasStats() {
    try {
      const r = await apiFetch('/api/admin/stats');
      if (r.success) {
        document.getElementById('saasStatTotal').textContent = r.totalSchools ?? '-';
        document.getElementById('saasStatPro').textContent   = r.proSchools   ?? '-';
        document.getElementById('saasStatFree').textContent  = r.freeSchools  ?? '-';
      }
    } catch(e) {}
  }

  // Load Schools Table
  async function loadSaasSchools() {
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;opacity:.5;">Memuat...</td></tr>';
    try {
      const r = await apiFetch('/api/admin/schools');
      if (!r.success) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--red);">${r.error}</td></tr>`;
        return;
      }
      if (!r.schools || r.schools.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;opacity:.5;">Belum ada sekolah terdaftar.</td></tr>';
        return;
      }
      tbody.innerHTML = r.schools.map((s, i) => {
        const cfg    = s.school_configs?.[0] || {};
        const planBadge = s.plan === 'pro'
          ? '<span style="color:#10b981;font-weight:600;">✅ Pro</span>'
          : '<span style="color:#f59e0b;font-weight:600;">🆓 Free</span>';
        const schedulerBadge = cfg.scheduler_enabled !== false
          ? '<span style="color:#10b981;">Aktif</span>'
          : '<span style="color:#ef4444;">Nonaktif</span>';
        const jam = `${String(cfg.pagi_hour??7).padStart(2,'0')}:${String(cfg.pagi_minute??30).padStart(2,'0')} / ${String(cfg.siang_hour??15).padStart(2,'0')}:${String(cfg.siang_minute??30).padStart(2,'0')} / ${String(cfg.pulang_hour??18).padStart(2,'0')}:${String(cfg.pulang_minute??0).padStart(2,'0')}`;
        return `<tr>
          <td class="font-mono">${i+1}</td>
          <td><strong>${s.name}</strong><br><span style="font-size:.75rem;opacity:.6;">${s.npsn||'-'}</span></td>
          <td class="font-mono" style="font-size:.82rem;">${s.email}</td>
          <td>${planBadge}</td>
          <td>${schedulerBadge}</td>
          <td class="font-mono" style="font-size:.82rem;">${jam}</td>
          <td>
            <button class="modern-btn" style="padding:5px 10px;font-size:.78rem;background:rgba(239,68,68,.15);color:#f87171;" onclick="deleteSaasSchool('${s.id}','${s.name}')">🗑️ Hapus</button>
          </td>
        </tr>`;
      }).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red);">${e.message}</td></tr>`;
    }
  }

  // Load when super admin tab is opened
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-tab="superadmin"]')) {
      loadSaasStats();
      loadSaasSchools();
    }
  });

  // Show/hide form
  if (btnShow)   btnShow.addEventListener('click', () => { if(addWrap) addWrap.style.display=''; btnShow.style.display='none'; });
  if (btnCancel) btnCancel.addEventListener('click', () => { if(addWrap) addWrap.style.display='none'; if(btnShow) btnShow.style.display=''; if(formAdd) formAdd.reset(); if(errEl) errEl.textContent=''; });

  // Submit form tambah sekolah
  if (formAdd) {
    formAdd.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      const btn = document.getElementById('btnSubmitAddSchool');
      if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

      const pagiParts   = (document.getElementById('saasSchoolPagi')?.value || '07:30').split(':');
      const siangParts  = (document.getElementById('saasSchoolSiang')?.value || '15:30').split(':');
      const pulangParts = (document.getElementById('saasSchoolPulang')?.value || '18:00').split(':');

      try {
        const r = await apiFetch('/api/admin/schools', {
          method: 'POST',
          body: JSON.stringify({
            name:                document.getElementById('saasSchoolName')?.value.trim(),
            npsn:                document.getElementById('saasSchoolNpsn')?.value.trim(),
            email:               document.getElementById('saasSchoolEmail')?.value.trim(),
            password:            document.getElementById('saasSchoolPassword')?.value.trim(),
            plan:                document.getElementById('saasSchoolPlan')?.value,
            epresensi_username:  document.getElementById('saasSchoolEpUser')?.value.trim(),
            epresensi_password:  document.getElementById('saasSchoolEpPass')?.value.trim(),
            fonnte_token:        document.getElementById('saasSchoolFonnte')?.value.trim(),
            pagi_hour:     parseInt(pagiParts[0]) || 7,
            pagi_minute:   parseInt(pagiParts[1]) || 30,
            siang_hour:    parseInt(siangParts[0]) || 15,
            siang_minute:  parseInt(siangParts[1]) || 30,
            pulang_hour:   parseInt(pulangParts[0]) || 18,
            pulang_minute: parseInt(pulangParts[1]) || 0,
          })
        });
        if (r.success) {
          showToast(`✅ Sekolah "${r.school.name}" berhasil ditambahkan!`, 'success');
          formAdd.reset();
          if (addWrap) addWrap.style.display = 'none';
          if (btnShow) btnShow.style.display = '';
          loadSaasSchools();
          loadSaasStats();
        } else {
          if (errEl) errEl.textContent = `❌ ${r.error}`;
        }
      } catch(err) {
        if (errEl) errEl.textContent = `❌ ${err.message}`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 Simpan Sekolah'; }
      }
    });
  }

  // Delete school (global function for onclick)
  window.deleteSaasSchool = async (id, name) => {
    if (!confirm(`Hapus sekolah "${name}"? Semua data konfigurasi akan ikut terhapus!`)) return;
    try {
      const r = await apiFetch(`/api/admin/schools/${id}`, { method: 'DELETE' });
      if (r.success) {
        showToast(`🗑️ Sekolah "${name}" dihapus.`, 'info');
        loadSaasSchools();
        loadSaasStats();
      } else {
        showToast(`❌ Gagal: ${r.error}`, 'error');
      }
    } catch(e) {
      showToast(`❌ ${e.message}`, 'error');
    }
  };
})();


