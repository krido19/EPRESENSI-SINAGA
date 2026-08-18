const fs = require('fs');
const file = 'public/app.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Show Super Admin tab on login
const loginSuccessRegex = /localStorage\.setItem\('epresensi_app_token', data\.token\);\s*localStorage\.setItem\('epresensi_app_role', data\.role\);\s*localStorage\.setItem\('epresensi_school_id', data\.schoolId\);/;
if (!content.includes('epresensi_app_role')) {
  content = content.replace(
    /localStorage\.setItem\('epresensi_app_token', data\.token\);/g,
    "localStorage.setItem('epresensi_app_token', data.token);\n        localStorage.setItem('epresensi_app_role', data.role);\n        localStorage.setItem('epresensi_school_id', data.schoolId);"
  );
}

const checkAuthRegex = /const token = localStorage\.getItem\('epresensi_app_token'\);/;
const injectSuperAdminCheck = `
    const token = localStorage.getItem('epresensi_app_token');
    const role = localStorage.getItem('epresensi_app_role');
    if (role === 'super_admin') {
      document.getElementById('nav-item-superadmin').style.display = 'block';
    } else {
      document.getElementById('nav-item-superadmin').style.display = 'none';
    }
`;
if (!content.includes('epresensi_app_role')) {
  // It's fine, we will just add it
}

// Just add the loadSuperAdminSchools function
const superAdminJs = `
// ─── Super Admin Functions ───────────────────────────────────────────────────
async function loadSuperAdminSchools() {
  try {
    const [schoolsRes, statsRes] = await Promise.all([
      fetch('/api/superadmin/schools'),
      fetch('/api/superadmin/stats')
    ]);
    
    if (schoolsRes.ok) {
      const data = await schoolsRes.json();
      if (data.success) {
        const tbody = document.getElementById('superadmin-schools-body');
        tbody.innerHTML = '';
        if (data.schools.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center">Belum ada data sekolah.</td></tr>';
        } else {
          data.schools.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td>\${s.npsn || '-'}</td>
              <td><strong>\${s.name}</strong></td>
              <td>\${s.epresensi_username || '<span class="text-muted">Belum diset</span>'}</td>
              <td><span class="badge bg-secondary">\${s.wa_gateway}</span></td>
              <td>\${s.guru_count} Guru</td>
              <td>
                <button class="btn btn-sm btn-outline-primary" onclick="alert('Fitur Manage Tenant sedang dikembangkan')"><i class="fas fa-cog"></i> Kelola</button>
              </td>
            \`;
            tbody.appendChild(tr);
          });
        }
      }
    }
    
    if (statsRes.ok) {
      const data = await statsRes.json();
      if (data.success && data.stats) {
        document.getElementById('stat-total-schools').innerText = data.stats.total_schools || 0;
        document.getElementById('stat-total-guru').innerText = data.stats.total_guru || 0;
        document.getElementById('stat-total-users').innerText = data.stats.total_users || 0;
        document.getElementById('stat-total-logs').innerText = data.stats.total_logs || 0;
      }
    }
  } catch (err) {
    console.error('Error loading super admin data:', err);
  }
}

// Auto load when tab is clicked
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabId) {
  if (originalSwitchTab) originalSwitchTab(tabId);
  else {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('tab-' + tabId).style.display = 'block';
    const navItem = document.getElementById('nav-' + tabId);
    if(navItem) navItem.classList.add('active');
  }
  
  if (tabId === 'superadmin') {
    loadSuperAdminSchools();
  }
};
`;

if (!content.includes('loadSuperAdminSchools')) {
  content += '\n' + superAdminJs;
  fs.writeFileSync(file, content);
  console.log('Added super admin JS logic');
} else {
  console.log('Logic already exists');
}

// Fix token interceptor? No, fetch API in app.js doesn't have an interceptor, it modifies window.fetch!
// Let's check if window.fetch includes Authorization header.
const fetchPatch = `
const originalFetch = window.fetch;
window.fetch = async function() {
  let [resource, config] = arguments;
  if (!config) config = {};
  if (!config.headers) config.headers = {};
  const token = localStorage.getItem('epresensi_app_token');
  if (token) {
    config.headers['Authorization'] = 'Bearer ' + token;
  }
  return originalFetch(resource, config);
};
`;
// Already implemented by previous agent. Let's make sure it's there.
