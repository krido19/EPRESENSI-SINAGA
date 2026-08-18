const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const oldCode = `        if (['H', 'T', 'TAM', 'TAP', 'HB'].includes(code)) {
          curStatus = 'Hadir';
          curIsHadir = true;
          totalHadir++;
        } else if (code === 'CS' || code === 'S') {
          curStatus = 'Sakit';
          totalSakit++;
        } else if (code.startsWith('C') || code === 'I' || code === 'DL' || code === 'TL') {
          if (code === 'DL') curStatus = 'Dinas Luar';
          else if (code === 'TL') curStatus = 'Tugas Luar';
          else if (code === 'I') curStatus = 'Izin';
          else curStatus = 'Cuti';
          totalIzin++;
        } else if (code === 'OFF') {
          curStatus = 'Libur (OFF)';
        } else if (code === 'A' || code === 'HAPUS') {
          // Alpha / Belum Absen
          curStatus = 'Belum Absen';
          // Only count as Belum Absen if it's past or today
          if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) {
            totalBelum++;
          }
        }`;

const newCode = `        // H=Hadir, T=Terlambat, TAM/TAP=Tanpa Alasan, HB=Hadir Belum Pulang, HBN=Hadir Belum (Not notified)
        if (['H', 'T', 'TAM', 'TAP', 'HB', 'HBN'].includes(code)) {
          curStatus = code === 'HBN' ? 'Hadir (Belum Pulang)' : (code === 'T' || code === 'TAM' || code === 'TAP' ? 'Terlambat' : 'Hadir');
          curIsHadir = true;
          totalHadir++;
        } else if (code === 'CS' || code === 'S') {
          curStatus = 'Sakit';
          totalSakit++;
        } else if (code === 'CT' || code === 'CB' || code === 'I' || code === 'DL' || code === 'TL' || code.startsWith('C')) {
          if (code === 'DL') curStatus = 'Dinas Luar';
          else if (code === 'TL') curStatus = 'Tugas Luar';
          else if (code === 'I') curStatus = 'Izin';
          else if (code === 'CT') curStatus = 'Cuti Tahunan';
          else if (code === 'CB') curStatus = 'Cuti Besar';
          else curStatus = 'Cuti';
          totalIzin++;
        } else if (code === 'OFF') {
          curStatus = 'Libur (OFF)';
        } else if (code === 'A' || code === 'HAPUS') {
          // Alpha / Belum Absen
          curStatus = 'Belum Absen';
          if (parseInt(year) < now.getFullYear() || parseInt(month) < (now.getMonth() + 1) || (parseInt(month) === (now.getMonth() + 1) && d <= now.getDate())) {
            totalBelum++;
          }
        } else {
          // Unknown status code — log and keep as Belum Absen for safety
          console.warn(\`[Parser] Unknown status code: "\${code}" for NIP \${nip} on \${curDateISO}\`);
        }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('server.js', content);
  console.log('✅ Status codes updated successfully');
} else {
  // Try CRLF version
  const oldCodeCRLF = oldCode.replace(/\n/g, '\r\n');
  if (content.includes(oldCodeCRLF)) {
    content = content.replace(oldCodeCRLF, newCode);
    fs.writeFileSync('server.js', content);
    console.log('✅ Status codes updated (CRLF) successfully');
  } else {
    console.error('❌ Could not find target code to replace');
    // Find line 831
    const lines = content.split('\n');
    console.log('Lines 829-835:');
    lines.slice(828, 835).forEach((l, i) => console.log((829+i) + ': ' + JSON.stringify(l)));
  }
}
