const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add Supabase Client
const importBlock = `const express = require('express');`;
const newImportBlock = `const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const express = require('express');`;

if (!content.includes('createClient')) {
  content = content.replace(importBlock, newImportBlock);
}

// 2. Add requireAppAuth
const verifyAuthTokenRegex = /\/\/ 4\. API Authentication Guard Middleware[\s\S]*?function requireAppAuth\(req, res, next\) \{[\s\S]*?next\(\);\n\}/;
const newAuthGuard = `// 4. API Authentication Guard Middleware (Supabase JWT)
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
content = content.replace(verifyAuthTokenRegex, newAuthGuard);

// 3. Remove `generateAuthToken` and `verifyAuthToken` usages
content = content.replace(/function generateAuthToken[\s\S]*?return token;\n\}/, '');
content = content.replace(/function verifyAuthToken[\s\S]*?return isValid;\n\}/, '');

fs.writeFileSync(file, content);
console.log('Restored Phase 1');
