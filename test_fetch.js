const fs = require('fs');
const fetch = require('node-fetch');
const https = require('https');
const BASE_URL = 'https://epresensi.jatengprov.go.id';
const agent = new https.Agent({ rejectUnauthorized: false });
const cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const HEADERS_BASE = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*' };

async function run() {
  console.log('Testing with OPD:', cfg.opdCode, 'Unit:', cfg.unitCode);
  const cookie = cfg.cookie;
  if (!cookie) {
      console.log("NO COOKIE IN config.json");
      return;
  }
  
  const wib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const targetDay = String(wib.getDate()).padStart(2, '0');
  const targetMonth = String(wib.getMonth() + 1).padStart(2, '0');
  const targetYear = wib.getFullYear();
  
  const url = BASE_URL + '/v3/rekapitulasi/unit_kerja/hari/' + cfg.opdCode + '/' + cfg.unitCode + '/' + targetYear + '-' + targetMonth + '-' + targetDay;
  console.log('Fetching URL:', url);
  
  const res = await fetch(url, { headers: { ...HEADERS_BASE, Cookie: cookie }, agent });
  console.log('Status:', res.status);
  
  const html = await res.text();
  const hasTable = html.includes('table-unit') || html.includes('<table class="table');
  console.log('Has table-unit?', hasTable);
  
  if (html.includes('name="password"')) {
      console.log('REDIRECTED TO LOGIN!');
  } else if (!hasTable) {
      console.log('HTML Snippet:');
      console.log(html.substring(0, 800));
  }
}
run().catch(console.error);
