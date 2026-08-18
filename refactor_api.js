const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// Add the middleware after requireAppAuth use
const gatewayStr = `app.use('/api', (req, res, next) => {
  // Whitelist public endpoints (login, status health check, graph stats)
  if (
    req.path === '/auth/app-login' ||
    req.path === '/status' ||
    req.path === '/graph/stats'
  ) {
    return next();
  }
  return requireAppAuth(req, res, next);
});`;

const middlewareStr = `app.use('/api', (req, res, next) => {
  // Whitelist public endpoints (login, status health check, graph stats)
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
      school_id: req.school_id // keep track for saveConfig
    };
  } catch (err) {
    console.error('Failed to load tenant config:', err);
    req.tenantCfg = globalConfig; // fallback
  }
  next();
});`;

if (content.includes(gatewayStr)) {
  content = content.replace(gatewayStr, middlewareStr);
  console.log('Added tenant middleware');
}

// Modify loadConfig definition
content = content.replace(
  `function loadConfig() {
  return globalConfig;
}`,
  `function loadConfig(req) {
  if (req && req.tenantCfg) return req.tenantCfg;
  return globalConfig;
}`
);

// Modify loadRecipients definition
content = content.replace(
  `function loadRecipients() {
  return globalRecipients;
}`,
  `function loadRecipients(req) {
  // TODO: Fetch from Supabase synchronously? No, express routes should be refactored to async.
  // For now, return globalRecipients if no req
  return globalRecipients;
}`
);

// We will replace occurrences manually by pattern matching
content = content.replace(/const cfg = loadConfig\(\);/g, 'const cfg = loadConfig(req);');
content = content.replace(/const config = loadConfig\(\);/g, 'const config = loadConfig(req);');
content = content.replace(/const current = loadConfig\(\);/g, 'const current = loadConfig(req);');
content = content.replace(/const cfg\s*=\s*loadConfig\(\);/g, 'const cfg = loadConfig(req);');
content = content.replace(/const c = loadConfig\(\);/g, 'const c = loadConfig(req);');

fs.writeFileSync(file, content);
console.log('Done refactoring loadConfig');
