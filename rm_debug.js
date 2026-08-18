const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
c = c.replace("  console.log('requireAppAuth path:', req.path, 'headers:', req.headers);\n", '');
fs.writeFileSync('server.js', c);
console.log('Removed debug log');
