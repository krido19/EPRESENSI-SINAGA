const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /for \(const t of targets\) \{\s*const msg = template\.replace\(\/\\{nama\\}\/gi, t\.nama\);\s*const sendRes = await sendWhatsApp\(cfg\.fonnteToken, t\.nomor, msg\);\s*const successCount = results\.filter\(r => r\.success\)\.length;/g;

const replacement = `for (const t of targets) {
    const msg = template.replace(/\\{nama\\}/gi, t.nama);
    const sendRes = await sendWhatsApp(cfg.fonnteToken, t.nomor, msg);
    results.push({ nama: t.nama, nomor: t.nomor, success: sendRes.success });
    await new Promise(r => setTimeout(r, 1000));
  }
  const successCount = results.filter(r => r.success).length;`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log('Fixed loop successfully');
} else {
  console.log('Could not find loop with regex');
}
