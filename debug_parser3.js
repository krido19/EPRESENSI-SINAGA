const fs = require('fs');
require('dotenv').config();

async function main() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch(e) { cfg = {}; }
  
  const cookie = cfg.cookie;
  if (!cookie) { console.log('No cookie'); return; }

  const BASE_URL = 'https://presensi.bkd.jatengprov.go.id';
  const HEADERS_BASE = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Connection': 'keep-alive'
  };

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const day = now.getDate();
  const dStr = String(day).padStart(2, '0');
  
  const formData = new URLSearchParams({
    opd: cfg.opdCode, unit: cfg.unitCode, rl: '88', bulan: month, tahun: year, nip: ''
  });

  const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
    method: 'POST',
    headers: { ...HEADERS_BASE, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });
  
  const html = await r.text();
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  
  const tables = $('table');
  let targetTable = null; let maxRows = 0;
  tables.each((i, t) => {
    const rows = $(t).find('tr').length;
    if (rows > maxRows) { maxRows = rows; targetTable = $(t); }
  });
  
  const row2 = targetTable.find('tr').eq(1);
  const rowHtml = row2.html() || '';
  
  const nip = '199601042025211042';
  const statusInputId = `${year}${month}_${nip}-s_${dStr}`;
  console.log('Testing regex for:', statusInputId);
  
  // Test the exact regex from server.js
  const statusRegex = new RegExp(`id=["']${statusInputId}["'][^>]*value=["']([^"']+)["']`, 'i');
  const statusMatch = rowHtml.match(statusRegex);
  console.log('Regex match:', statusMatch ? statusMatch[1] : 'NO MATCH');
  
  // Find the raw HTML around the target id
  const idx = rowHtml.indexOf(statusInputId);
  if (idx >= 0) {
    const snippet = rowHtml.substring(idx - 5, idx + 150);
    console.log('\nRaw HTML snippet around the id:');
    console.log(snippet);
    console.log('\n--- Testing single-line regex on this snippet ---');
    const testMatch = snippet.match(/id=["']202608_199601042025211042-s_17["'][^>]*value=["']([^"']+)["']/i);
    console.log('Match result:', testMatch ? testMatch[1] : 'NO MATCH');
  }
}
main().catch(console.error);
