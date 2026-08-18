const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace("  res.json(result);\n});\n\n// Send Notification Specifically", "// Send Notification Specifically");

fs.writeFileSync(file, content);
console.log('Removed dangling code');
