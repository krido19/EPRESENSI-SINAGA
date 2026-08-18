const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace("  const authHeader = req.headers['authorization'];", "  console.log('requireAppAuth path:', req.path, 'headers:', req.headers);\n  const authHeader = req.headers['authorization'];");

fs.writeFileSync(file, content);
console.log('Added debug log to requireAppAuth');
