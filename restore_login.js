const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const oldLogin = `app.post('/api/auth/app-login', authLimiter, (req, res) => {
  const { password } = req.body;
  const cfg = loadConfig();
  const validPass = cfg.appPassword || process.env.APP_PASSWORD || 'SMK3magelang';

  if (password === validPass) {
    const token = generateAuthToken(validPass);
    addLog({ type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    return res.json({ success: true, token });
  }

  res.json({ success: false, error: 'Password akses salah. Silakan coba lagi.' });
});`;

const newLogin = `app.post('/api/auth/app-login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.json({ success: false, error: 'Email dan password wajib diisi.' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    return res.json({ success: false, error: 'Login gagal: Email atau password salah.' });
  }

  const { data: roleData } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).single();
  const role = roleData?.role || 'school_admin';
  const schoolId = roleData?.school_id || process.env.DEFAULT_SCHOOL_ID;

  addLog(typeof tenantCfg !== 'undefined' && tenantCfg ? { tenantCfg } : null, { type: 'info', message: \`🔓 Berhasil masuk ke dashboard aplikasi (\${email}).\` });
  
  res.json({ success: true, token: data.session.access_token, role, schoolId });
});`;

if (content.includes(oldLogin)) {
  content = content.replace(oldLogin, newLogin);
}

fs.writeFileSync(file, content);
console.log('Restored login');
