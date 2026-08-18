const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// Use string split or replace with careful regex
const startIndex = content.indexOf('// 4. API Authentication Guard Middleware');
const endIndexStr = '// 5. Global API Gateway Protection';
const endIndex = content.indexOf(endIndexStr);

if (startIndex !== -1 && endIndex !== -1) {
  const newAuthCode = `// 4. API Authentication Guard Middleware (Supabase JWT)
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
}

`;

  const part1 = content.slice(0, startIndex);
  const part2 = content.slice(endIndex);
  
  content = part1 + newAuthCode + part2;
  fs.writeFileSync(file, content);
  console.log('Fixed requireAppAuth');
} else {
  console.log('Could not find markers');
}
