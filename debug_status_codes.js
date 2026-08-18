const fs = require('fs');
require('dotenv').config();

async function main() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch(e) { cfg = {}; }
  const cookie = cfg.cookie;

  const BASE_URL = 'https://presensi.bkd.jatengprov.go.id';
  const HEADERS_BASE = { 'User-Agent': 'Mozilla/5.0', 'Connection': 'keep-alive' };

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  
  const formData = new URLSearchParams({ opd: cfg.opdCode, unit: cfg.unitCode, rl: '88', bulan: month, tahun: year, nip: '' });

  const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
    method: 'POST',
    headers: { ...HEADERS_BASE, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });
  
  const html = await r.text();
  
  // Collect ALL unique status values from all hidden inputs
  const valueRegex = /id="202608_\d{18}-s_\d{2}"[^>]*value="([^"]+)"/g;
  const values = {};
  let m;
  while ((m = valueRegex.exec(html)) !== null) {
    values[m[1]] = (values[m[1]] || 0) + 1;
  }
  
  console.log('All unique status codes found in HTML:');
  Object.entries(values).sort((a,b) => b[1]-a[1]).forEach(([code, count]) => {
    console.log(`  "${code}" → ${count} occurrences`);
  });
}
main().catch(console.error);
