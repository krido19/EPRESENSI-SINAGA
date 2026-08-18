const fs = require('fs');
const file = 'public/app.js';
let content = fs.readFileSync(file, 'utf8');

// The beginning of the file is broken. Replace the broken section cleanly.
const correctStart = `// ─── Authenticated Fetch Interceptor (Security Layer) ─────────────────────────
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const token = localStorage.getItem('epresensi_app_token');
  const opts = { ...options };

  if (typeof url === 'string' && url.startsWith('/api') && !url.includes('/api/auth/app-login')) {
    opts.headers = { ...(opts.headers || {}) };
    if (token && !opts.headers['Authorization']) {
      opts.headers['Authorization'] = \`Bearer \${token}\`;
    }
  }

  const response = await originalFetch(url, opts);
  if (response.status === 401 && typeof url === 'string' && url.startsWith('/api') && !url.includes('/api/auth/app-login')) {
    localStorage.removeItem('epresensi_app_token');
    if (typeof checkAppAuth === 'function') checkAppAuth();
  }
  return response;
};

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
    if (mainAppWrapper) mainAppWrapper.style.display = 'flex';
    return true;
  } else {
    if (appGatekeeperScreen) appGatekeeperScreen.style.display = 'flex';
    if (mainAppWrapper) mainAppWrapper.style.display = 'none';
    return false;
  }
}

if (btnToggleGatekeeperEye && gatekeeperInputPassword) {
  btnToggleGatekeeperEye.addEventListener('click', () => {
    const isPass = gatekeeperInputPassword.type === 'password';
    gatekeeperInputPassword.type = isPass ? 'text' : 'password';
    btnToggleGatekeeperEye.textContent = isPass ? '🙈' : '👁️';
  });
}

`;

// Find where gatekeeperForm listener starts (it should still exist)
const gatekeeperFormIdx = content.indexOf('if (gatekeeperForm) {');

if (gatekeeperFormIdx !== -1) {
  content = correctStart + content.slice(gatekeeperFormIdx);
  fs.writeFileSync(file, content);
  console.log('Fixed app.js beginning successfully. Total lines: ' + content.split('\n').length);
} else {
  console.error('Could not find gatekeeperForm marker!');
}
