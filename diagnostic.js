const fs = require('fs');
const https = require('https');
const fetch = require('node-fetch');

const CONFIG_FILE = './config.json';
const BASE_URL = 'https://epresensi.jatengprov.go.id';
const agent = new https.Agent({ rejectUnauthorized: false });
const HEADERS_BASE = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*' };

async function runDiagnostic() {
  console.log("Menjalankan diagnostic ePresensi...");
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const cookie = cfg.cookie;
  if (!cookie) {
      console.log("Error: Cookie tidak ditemukan di config.json. Harap login dulu.");
      return;
  }
  
  const wib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const targetDay = String(wib.getDate()).padStart(2, '0');
  const targetMonth = String(wib.getMonth() + 1).padStart(2, '0');
  const targetYear = wib.getFullYear();
  
  const url = `${BASE_URL}/v3/rekapitulasi/unit_kerja/hari/${cfg.opdCode}/${cfg.unitCode}/${targetYear}-${targetMonth}-${targetDay}`;
  console.log(`Mencoba akses: ${url}`);
  
  try {
      const res = await fetch(url, { headers: { ...HEADERS_BASE, Cookie: cookie }, agent });
      console.log("Status HTTP:", res.status);
      const html = await res.text();
      fs.writeFileSync('./debug_epresensi.html', html, 'utf8');
      console.log("HTML berhasil disimpan ke debug_epresensi.html");
      
      if (html.includes('table-unit') || html.includes('<table')) {
          console.log("INFO: Tabel berhasil ditemukan di dalam HTML!");
      } else {
          console.log("ERROR: Tabel TIDAK DITEMUKAN di dalam HTML.");
          const titleMatch = html.match(/<title>(.*?)<\/title>/i);
          if (titleMatch) console.log("Judul Halaman:", titleMatch[1]);
          console.log("Snippet HTML (500 karakter pertama):");
          console.log(html.substring(0, 500).trim());
      }
  } catch(e) {
      console.log("Gagal melakukan request:", e.message);
  }
}

runDiagnostic();
