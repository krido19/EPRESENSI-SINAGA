const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `// Send Now
app.post('/api/send-now', async (req, res) => {`;

const newStr = `// Manual Scheduler Trigger
app.post('/api/scheduler/run-now', async (req, res) => {
  try {
    const { type } = req.body;
    const cfg = typeof tenantCfg !== 'undefined' && tenantCfg ? tenantCfg : loadConfig(typeof req !== 'undefined' ? req : undefined);
    const result = await runSchedulerLogic(type || 'pagi', cfg);
    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Send Now
app.post('/api/send-now', async (req, res) => {`;

content = content.replace(targetStr, newStr);

fs.writeFileSync(file, content);
console.log('Added run-now endpoint');
