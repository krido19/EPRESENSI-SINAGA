const fs = require('fs');
require('dotenv').config();

async function main() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch(e) { cfg = {}; }
  
  const cookie = cfg.cookie;
  if (!cookie) { console.log('No cookie in config.json'); return; }

  const BASE_URL = 'https://presensi.bkd.jatengprov.go.id';
  const HEADERS_BASE = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    'Connection': 'keep-alive'
  };

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  
  const formData = new URLSearchParams({
    opd: cfg.opdCode || 'F200000000',
    unit: cfg.unitCode || 'F208007700',
    rl: '88', bulan: month, tahun: year, nip: ''
  });

  const r = await fetch(`${BASE_URL}/v3/data_v4/kerja_cari`, {
    method: 'POST',
    headers: { ...HEADERS_BASE, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });
  
  const html = await r.text();
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  
  // Find correct table (most rows)
  const tables = $('table');
  let targetTable = null;
  let maxRows = 0;
  tables.each((i, t) => {
    const rows = $(t).find('tr').length;
    if (rows > maxRows) { maxRows = rows; targetTable = $(t); }
  });
  
  console.log('Table rows:', maxRows);
  
  // Get row 2 (first data row)
  const rows = targetTable.find('tr');
  const row2 = rows.eq(1);
  const rowHtml = row2.html() || '';
  
  console.log('Row 2 HTML length:', rowHtml.length);
  
  // Check if status inputs are in the row HTML
  const nip = '199601042025211042';
  const statusInputId = `${year}${month}_${nip}-s_17`;
  console.log('Looking for statusInputId:', statusInputId);
  console.log('Found in rowHtml:', rowHtml.includes(statusInputId));
  
  // Search for any input in rowHtml
  const inputsInRow = rowHtml.match(/id="[^"]+"/g);
  console.log('Total inputs in row:', inputsInRow ? inputsInRow.length : 0);
  if (inputsInRow) {
    console.log('First 5 input IDs in row:', inputsInRow.slice(0, 5));
  }
  
  // Check: maybe status inputs are in tbody, not in individual row?
  const allInputs = html.match(/id="202608_[^"]+"/g);
  console.log('\nTotal status inputs in entire HTML:', allInputs ? allInputs.length : 0);
  if (allInputs) console.log('Sample:', allInputs.slice(0, 3));
}
main().catch(console.error);
