const fs = require('fs');
// Replicate what server does to fetch and check HTML
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Load config from file
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch(e) { cfg = {}; }
  
  const cookie = cfg.cookie;
  if (!cookie) { console.log('No cookie in config.json'); return; }

  const BASE_URL = 'https://presensi.bkd.jatengprov.go.id';
  const HEADERS_BASE = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive'
  };

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  
  const formData = new URLSearchParams({
    opd: cfg.opdCode || 'F200000000',
    unit: cfg.unitCode || 'F208007700',
    rl: '88',
    bulan: month,
    tahun: year,
    nip: ''
  });

  console.log('Fetching with unit:', cfg.unitCode, 'opd:', cfg.opdCode);
  
  const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
    method: 'POST',
    headers: { ...HEADERS_BASE, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });
  
  const html = await r.text();
  
  // Search for hidden input pattern
  const inputMatches = html.match(/id="(\d{6}_\d+-s_\d+)"[^>]*value="([^"]+)"/g);
  if (inputMatches) {
    console.log('Found status inputs (first 10):');
    inputMatches.slice(0, 10).forEach(m => console.log(' ', m));
  } else {
    console.log('NO status inputs found! Searching for any input with id containing NIP...');
    // Try broader search
    const broadMatch = html.match(/id="[^"]*\d{18}[^"]*"/g);
    if (broadMatch) {
      console.log('Found NIP-related IDs (first 5):');
      broadMatch.slice(0, 5).forEach(m => console.log(' ', m));
    } else {
      console.log('No NIP inputs found. Saving first 5000 chars to debug_html.txt');
      // Find the first table
      const tableStart = html.indexOf('<table');
      if (tableStart >= 0) {
        fs.writeFileSync('debug_html.txt', html.substring(tableStart, tableStart + 5000));
        console.log('Saved table HTML to debug_html.txt');
      }
    }
  }
}
main().catch(console.error);
