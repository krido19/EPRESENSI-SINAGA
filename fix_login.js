const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const oldLoginRoute = /\/\/ ─── App Gatekeeper Security \(Password: SMK3magelang by default\) ───────────────\napp\.post\('\/api\/auth\/app-login', authLimiter, \(req, res\) => \{[\s\S]*?res\.json\(\{ success: false, error: 'Password akses salah\. Silakan coba lagi\.' \}\);\n\}\);/;

const newLoginRoute = `// ─── App Gatekeeper Security (Supabase Auth) ───────────────────────────────────
app.post('/api/auth/app-login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email dan password wajib diisi.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      return res.status(401).json({ success: false, error: 'Kredensial tidak valid. Silakan periksa kembali email dan password Anda.' });
    }

    const { data: roleData } = await supabase.from('user_roles').select('*').eq('user_id', data.user.id).single();
    
    // Fallback for school config if needed
    const cfg = loadConfig(typeof req !== 'undefined' ? req : undefined);

    addLog(typeof req.tenantCfg !== 'undefined' && req.tenantCfg ? { tenantCfg: req.tenantCfg } : null, { type: 'info', message: '🔓 Berhasil masuk ke dashboard aplikasi.' });
    
    res.json({ 
      success: true, 
      token: data.session.access_token,
      role: roleData?.role || 'school_admin',
      schoolId: roleData?.school_id || process.env.DEFAULT_SCHOOL_ID
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat login.' });
  }
});`;

content = content.replace(oldLoginRoute, newLoginRoute);
fs.writeFileSync(file, content);
console.log('Fixed app-login');
