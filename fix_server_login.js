const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const oldRoute = `// ─── App Gatekeeper Security (Password: SMK3magelang by default) ───────────────
app.post('/api/auth/app-login', authLimiter, (req, res) => {
  const { password } = req.body;
  const cfg = loadConfig(typeof req !== 'undefined' ? req : undefined);
  const validPass = cfg.appPassword || process.env.APP_PASSWORD || 'SMK3magelang';

  if (password === validPass) {
    const token = generateAuthToken(validPass);
    addLog(typeof tenantCfg !== 'undefined' && tenantCfg ? { tenantCfg } : null, { type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    return res.json({ success: true, token });
  }

  res.json({ success: false, error: 'Password akses salah. Silakan coba lagi.' });
});`;

const newRoute = `// ─── App Gatekeeper Security (Supabase Auth) ───────────────────────────────────
app.post('/api/auth/app-login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email dan password wajib diisi.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      console.error('[Login] Supabase error:', error?.message);
      return res.status(401).json({ success: false, error: 'Email atau password salah. Silakan periksa kembali.' });
    }

    const { data: roleData } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).single();
    
    addLog(null, { type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    
    res.json({ 
      success: true, 
      token: data.session.access_token,
      role: roleData?.role || 'school_admin',
      schoolId: roleData?.school_id || process.env.DEFAULT_SCHOOL_ID
    });
  } catch (err) {
    console.error('[Login] Server error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat login.' });
  }
});`;

if (content.includes(oldRoute)) {
  content = content.replace(oldRoute, newRoute);
  fs.writeFileSync(file, content);
  console.log('✅ Route /api/auth/app-login berhasil diperbarui ke Supabase Auth');
} else {
  // Try a simpler match
  const simpleOld = "app.post('/api/auth/app-login', authLimiter, (req, res) => {";
  const simpleNew = "app.post('/api/auth/app-login', authLimiter, async (req, res) => {";
  
  if (content.includes(simpleOld)) {
    // Manual surgical replace of the whole handler
    const start = content.indexOf('// ─── App Gatekeeper Security (Password: SMK3magelang by default)');
    const end = content.indexOf('\napp.post(\'/api/auth/change-app-password\'');
    if (start !== -1 && end !== -1) {
      content = content.slice(0, start) + newRoute + '\n\n' + content.slice(end);
      fs.writeFileSync(file, content);
      console.log('✅ Fixed via surgical slice');
    } else {
      console.error('❌ Could not find boundaries');
    }
  } else {
    console.error('❌ Could not find old route');
  }
}
