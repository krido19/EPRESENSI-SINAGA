const fs = require('fs');
const file = 'public/app.js';
let content = fs.readFileSync(file, 'utf8');

// Find the correct login handler block - after the form submit handler starts
// We need to find and replace just the broken section inside gatekeeperForm handler

// The broken section - many duplicated nested gatekeeperForm handlers got injected
// Strategy: find first occurrence of "if (gatekeeperForm) {" and 
// then find the paired closing brace by counting braces

const correctLoginHandler = `if (gatekeeperForm) {
  gatekeeperForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gatekeeperInputEmail = document.getElementById('gatekeeperInputEmail');
    const email = gatekeeperInputEmail ? gatekeeperInputEmail.value.trim() : '';
    const password = gatekeeperInputPassword.value.trim();
    if (!email || !password) return;

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
        localStorage.setItem('epresensi_app_role', data.role);
        localStorage.setItem('epresensi_school_id', data.schoolId);
        checkAppAuth();
        showToast('Selamat datang di Dashboard ePresensi!', 'success');
        loadSchoolAccounts();
        loadStatus();
        loadConfig();
        loadRecipients();
        loadColleagues();
        loadLogs();
        loadGraphStats();
      } else {
        if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = \`❌ \${data.error || 'Login gagal'}\`;
        gatekeeperInputPassword.value = '';
        gatekeeperInputPassword.focus();
      }
    } catch (err) {
      if (gatekeeperErrorMsg) gatekeeperErrorMsg.textContent = \`❌ Error: \${err.message}\`;
    } finally {
      if (btnSubmitGatekeeper) {
        btnSubmitGatekeeper.disabled = false;
        btnSubmitGatekeeper.textContent = '🔓 Buka Dashboard →';
      }
    }
  });
}`;

// Find everything from "if (gatekeeperForm)" up to btnLogoutApp section or change-password section
// The marker after the login block should be btnLogoutApp or changeAppPasswordForm handler
const startMarker = 'if (gatekeeperForm) {';
const endMarker = 'if (btnLogoutApp) {';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  content = content.slice(0, startIdx) + correctLoginHandler + '\n\n' + content.slice(endIdx);
  fs.writeFileSync(file, content);
  console.log('Fixed login handler. Lines: ' + content.split('\n').length);
} else {
  console.error('Markers not found. startMarker:', startIdx, 'endMarker:', endIdx);
  // Show what's around line 58
  const lines = content.split('\n');
  console.log('Lines 56-70:');
  lines.slice(55, 70).forEach((l, i) => console.log((56+i) + ': ' + l));
}
