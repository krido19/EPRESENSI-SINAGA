const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove duplicate /api/colleagues (line 1348 to 1354 approx)
content = content.replace(/\/\/ Colleagues Endpoint \(Monitoring Semua Rekan Guru Hari Ini\)[\s\S]*?app\.get\('\/api\/colleagues', async \(req, res\) => \{[\s\S]*?res\.json\(result\);\n\}\);\n/g, '');

// 2. Fix requireAppAuth to use Supabase
const requireAppAuthOld = /\/\/ 4\. API Authentication Guard Middleware[\s\S]*?function requireAppAuth\(req, res, next\) \{[\s\S]*?next\(\);\n\}/;
const requireAppAuthNew = `// 4. API Authentication Guard Middleware (Supabase JWT)
async function requireAppAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Akses ditolak. Harap login terlebih dahulu.' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  
  if (error || !data.user) {
    console.error('Supabase Auth Error:', error?.message);
    return res.status(401).json({ success: false, error: 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.' });
  }

  req.user = data.user;
  
  const { data: roleData } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).single();
  req.school_id = roleData?.school_id || process.env.DEFAULT_SCHOOL_ID;
  req.user_role = roleData?.role || 'school_admin';

  next();
}`;
content = content.replace(requireAppAuthOld, requireAppAuthNew);

// 3. Inject tenantCfg middleware right after Global API Gateway Protection
const globalApiOld = /\/\/ 5\. Global API Gateway Protection\napp\.use\('\/api', \(req, res, next\) => \{[\s\S]*?return requireAppAuth\(req, res, next\);\n\}\);/;
const globalApiNew = `// 5. Global API Gateway Protection
app.use('/api', (req, res, next) => {
  if (
    req.path === '/auth/app-login' ||
    req.path === '/status' ||
    req.path === '/graph/stats'
  ) {
    return next();
  }
  return requireAppAuth(req, res, next);
});

// 6. Multi-Tenant Config Loader Middleware
app.use('/api', async (req, res, next) => {
  if (
    req.path === '/auth/app-login' ||
    req.path === '/status' ||
    req.path === '/graph/stats'
  ) {
    return next();
  }

  if (!req.school_id) return next();

  try {
    const { data: school } = await supabase.from('schools').select('*').eq('id', req.school_id).single();
    const { data: config } = await supabase.from('school_configs').select('*').eq('school_id', req.school_id).single();

    req.tenantCfg = {
      authMode: 'auto',
      username: school?.epresensi_username || '',
      password: school?.epresensi_password || '',
      waGateway: school?.wa_gateway || 'fonnte',
      fonnteToken: school?.fonnte_token || '',
      schedulerEnabled: config?.scheduler_enabled !== false,
      pagiHour: config?.pagi_hour ?? 7,
      pagiMinute: config?.pagi_minute ?? 30,
      pulangHour: config?.pulang_hour ?? 18,
      pulangMinute: config?.pulang_minute ?? 0,
      messagePagi: config?.message_pagi || '',
      messagePagiSudah: config?.message_pagi_sudah || '',
      messagePulang: config?.message_pulang || '',
      messagePulangSudah: config?.message_pulang_sudah || '',
      namaSekolah: school?.name || 'Sekolah',
      unitCode: school?.unit_code || '',
      opdCode: school?.opd_code || '',
      school_id: req.school_id
    };
  } catch (err) {
    console.error('Failed to load tenant config:', err);
    req.tenantCfg = loadConfig(typeof req !== 'undefined' ? req : undefined); // fallback
  }
  next();
});`;
content = content.replace(globalApiOld, globalApiNew);

// 4. Fix ALL `tenantCfg` usages in endpoints to use `req.tenantCfg`
content = content.replace(/const session = await ensureValidSession\(false, tenantCfg\);/g, "const session = await ensureValidSession(false, req.tenantCfg || loadConfig(req));");
content = content.replace(/await checkAttendance\(session\.cookie\)/g, "await checkAttendance(session.cookie, req.tenantCfg || loadConfig(req))");

// Wait, checkAttendance definition needs tenantCfg!
content = content.replace(/async function checkAttendance\(cookie\) \{/g, "async function checkAttendance(cookie, tenantCfg = null) {");

// /api/send-unabsent has a missing session call parameter:
content = content.replace(/const session = await ensureValidSession\(\);/g, "const session = await ensureValidSession(false, req.tenantCfg || loadConfig(req));");

// 5. Fix /api/status reference error:
content = content.replace(/schedulerActive: \(cronPagi !== null \|\| cronPulang !== null\) && cfg\.schedulerEnabled,/g, "schedulerActive: (typeof masterCron !== 'undefined' && masterCron !== null) && cfg.schedulerEnabled,");

fs.writeFileSync(file, content);
console.log('Unified fix complete');
