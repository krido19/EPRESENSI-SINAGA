const fs = require('fs');
const file = 'public/index.html';
let content = fs.readFileSync(file, 'utf8');

const navBarRegex = /<li class="nav-item">[\s\S]*?<a class="nav-link" id="nav-logs"[\s\S]*?<\/li>/;
const navBarAddition = `
        <li class="nav-item" id="nav-item-superadmin" style="display: none;">
          <a class="nav-link" id="nav-superadmin" href="#" onclick="switchTab('superadmin')">👑 Super Admin</a>
        </li>
`;

if (!content.includes('nav-superadmin')) {
  content = content.replace(navBarRegex, match => match + navBarAddition);
}

const mainContentRegex = /<!-- Logs Tab -->[\s\S]*?<\/div>(\s*?)<\/div>\s*?<!-- Main Content End -->/;
const superAdminTab = `
      <!-- Super Admin Tab -->
      <div id="tab-superadmin" class="tab-content" style="display: none;">
        <div class="row g-3 mb-4">
          <div class="col-md-3">
            <div class="card bg-primary text-white h-100">
              <div class="card-body">
                <h6 class="card-title"><i class="fas fa-school"></i> Total Sekolah</h6>
                <h2 class="display-6" id="stat-total-schools">...</h2>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-success text-white h-100">
              <div class="card-body">
                <h6 class="card-title"><i class="fas fa-users"></i> Total Guru</h6>
                <h2 class="display-6" id="stat-total-guru">...</h2>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-warning text-dark h-100">
              <div class="card-body">
                <h6 class="card-title"><i class="fas fa-user-shield"></i> Total Admin</h6>
                <h2 class="display-6" id="stat-total-users">...</h2>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-info text-white h-100">
              <div class="card-body">
                <h6 class="card-title"><i class="fas fa-history"></i> Total Logs</h6>
                <h2 class="display-6" id="stat-total-logs">...</h2>
              </div>
            </div>
          </div>
        </div>

        <div class="card shadow-sm mb-4">
          <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
            <h5 class="mb-0"><i class="fas fa-building"></i> Daftar Sekolah Terdaftar</h5>
            <button class="btn btn-sm btn-light" onclick="loadSuperAdminSchools()">
              <i class="fas fa-sync-alt"></i> Refresh
            </button>
          </div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-hover table-striped mb-0">
                <thead class="table-light">
                  <tr>
                    <th>NPSN</th>
                    <th>Nama Sekolah</th>
                    <th>Akun ePresensi</th>
                    <th>Gateway WA</th>
                    <th>Total Guru Target</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody id="superadmin-schools-body">
                  <tr><td colspan="6" class="text-center py-4 text-muted">Memuat data sekolah...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
`;

if (!content.includes('tab-superadmin')) {
  content = content.replace(mainContentRegex, match => superAdminTab + match);
  fs.writeFileSync(file, content);
  console.log('Added super admin UI');
} else {
  console.log('Super admin UI already exists');
}
