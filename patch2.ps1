$server = Get-Content 'server.js' -Raw -Encoding UTF8
$server = $server -replace "app\.get\('/api/status', \(req, res\) => {", "app.get('/api/status', requireAppAuth, async (req, res) => {"
$server = $server -replace "recipientCount: 0,", "recipientCount: (await (async () => {
      let q = supabase.from('recipients').select('*', { count: 'exact', head: true }).eq('aktif', true);
      if (req.userRole !== 'super_admin') q = q.eq('school_id', req.schoolId);
      const { count } = await q;
      return count || 0;
    })()),"
Set-Content 'server.js' -Value $server -Encoding UTF8
