const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const superAdminRoute = `
// ─── Super Admin Routes ────────────────────────────────────────────────────────
app.get('/api/superadmin/schools', requireAppAuth, async (req, res) => {
  if (req.user_role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Akses ditolak. Anda bukan Super Admin.' });
  }
  
  // Ambil semua sekolah dan config-nya
  const { data: schools, error } = await supabase
    .from('schools')
    .select('*, school_configs(*)');
    
  if (error) {
    return res.json({ success: false, error: error.message });
  }

  // Count guru for each school
  for (let school of schools) {
    const { count } = await supabase
      .from('recipients')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', school.id)
      .eq('aktif', true);
    school.guru_count = count || 0;
  }

  res.json({ success: true, schools });
});

app.get('/api/superadmin/stats', requireAppAuth, async (req, res) => {
  if (req.user_role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Akses ditolak.' });
  }
  
  const { count: schoolCount } = await supabase.from('schools').select('*', { count: 'exact', head: true });
  const { count: userCount } = await supabase.from('user_roles').select('*', { count: 'exact', head: true });
  const { count: guruCount } = await supabase.from('recipients').select('*', { count: 'exact', head: true }).eq('aktif', true);
  const { count: logCount } = await supabase.from('activity_logs').select('*', { count: 'exact', head: true });

  res.json({
    success: true,
    stats: {
      total_schools: schoolCount,
      total_users: userCount,
      total_guru: guruCount,
      total_logs: logCount
    }
  });
});
`;

if (!content.includes('/api/superadmin/schools')) {
  const marker = '// ─── API Routes ──────────────────────────────────────────────────────────────';
  content = content.replace(marker, marker + '\\n' + superAdminRoute);
  fs.writeFileSync(file, content);
  console.log('Added superadmin routes');
} else {
  console.log('Routes already exist');
}
