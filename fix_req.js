const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/loadConfig\(req\)/g, "loadConfig(typeof req !== 'undefined' ? req : undefined)");
content = content.replace(/saveConfig\(req, /g, "saveConfig(typeof req !== 'undefined' ? req : undefined, ");
content = content.replace(/loadRecipients\(req\)/g, "loadRecipients(typeof req !== 'undefined' ? req : undefined)");
content = content.replace(/saveRecipients\(req, /g, "saveRecipients(typeof req !== 'undefined' ? req : undefined, ");
content = content.replace(/addLog\(req, /g, "addLog(typeof req !== 'undefined' ? req : undefined, ");
content = content.replace(/loadLogs\(req\)/g, "loadLogs(typeof req !== 'undefined' ? req : undefined)");

fs.writeFileSync(file, content);
console.log('Fixed req reference error');
