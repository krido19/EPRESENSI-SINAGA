const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const newSetupScheduler = `let masterCron = null;

function setupScheduler() {
  if (masterCron) { masterCron.stop(); masterCron = null; }

  masterCron = cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      // Format to Asia/Jakarta HH:mm
      const options = { timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const [hourStr, minuteStr] = formatter.format(now).split(':');
      const currentHour = parseInt(hourStr, 10);
      const currentMinute = parseInt(minuteStr, 10);

      // Find schools where pagi schedule matches
      const { data: pagiSchools } = await supabase
        .from('school_configs')
        .select('school_id, schools(*)')
        .eq('scheduler_enabled', true)
        .eq('pagi_hour', currentHour)
        .eq('pagi_minute', currentMinute);

      // Find schools where pulang schedule matches
      const { data: pulangSchools } = await supabase
        .from('school_configs')
        .select('school_id, schools(*)')
        .eq('scheduler_enabled', true)
        .eq('pulang_hour', currentHour)
        .eq('pulang_minute', currentMinute);

      const processSchools = async (schoolsData, type) => {
        if (!schoolsData || schoolsData.length === 0) return;
        console.log(\`[Scheduler] Executing \${type} for \${schoolsData.length} schools at \${currentHour}:\${currentMinute}\`);
        
        for (const s of schoolsData) {
          const cfg = {
            authMode: 'auto',
            username: s.schools?.epresensi_username || '',
            password: s.schools?.epresensi_password || '',
            waGateway: s.schools?.wa_gateway || 'fonnte',
            fonnteToken: s.schools?.fonnte_token || '',
            schedulerEnabled: s.scheduler_enabled,
            messagePagi: s.message_pagi || '',
            messagePagiSudah: s.message_pagi_sudah || '',
            messagePulang: s.message_pulang || '',
            messagePulangSudah: s.message_pulang_sudah || '',
            namaSekolah: s.schools?.name || 'Sekolah',
            unitCode: s.schools?.unit_code || '',
            opdCode: s.schools?.opd_code || '',
            school_id: s.school_id
          };
          
          if (!cfg.username || !cfg.password) continue;
          
          // Run async without blocking the loop
          runSchedulerLogic(type, cfg).catch(err => console.error(\`[Scheduler] Error for school \${s.school_id}: \`, err));
        }
      };

      await processSchools(pagiSchools, 'pagi');
      await processSchools(pulangSchools, 'pulang');

    } catch (err) {
      console.error('[Scheduler Master] Error:', err);
    }
  });

  console.log('[Scheduler] Master Minute-Cron started.');
}`;

// Replace the old setupScheduler block
const oldSetupRegex = /let cronPagi[\s\S]*?\}[\s\S]*?function setupScheduler\(\) \{[\s\S]*?cronPulang \= null;\s*\}[\s\S]*?\n\}/;
content = content.replace(oldSetupRegex, newSetupScheduler);

// We must also update runSchedulerLogic to accept tenantCfg
content = content.replace(/async function runSchedulerLogic\(type\) \{/g, 'async function runSchedulerLogic(type, tenantCfg = null) {');
content = content.replace(/const cfg = loadConfig\(typeof req !== 'undefined' \? req : undefined\);/g, "const cfg = typeof tenantCfg !== 'undefined' && tenantCfg ? tenantCfg : loadConfig(typeof req !== 'undefined' ? req : undefined);");

// And ensure getColleagues and ensureValidSession accept tenantCfg
content = content.replace(/async function getColleagues\(day\) \{/g, 'async function getColleagues(day, tenantCfg = null) {');
content = content.replace(/async function getTodayLogs\(\) \{/g, 'async function getTodayLogs(tenantCfg = null) {');
content = content.replace(/async function ensureValidSession\(forceFresh = false\) \{/g, 'async function ensureValidSession(forceFresh = false, tenantCfg = null) {');
content = content.replace(/async function fetchData\(pathUrl, method = 'GET', data = null\) \{/g, "async function fetchData(pathUrl, method = 'GET', data = null, tenantCfg = null) {");
content = content.replace(/async function doLogin\(username, password\) \{/g, 'async function doLogin(username, password, tenantCfg = null) {');

// Inside runSchedulerLogic, pass tenantCfg
content = content.replace(/const logsArr = await getTodayLogs\(\);/g, 'const logsArr = await getTodayLogs(tenantCfg);');
content = content.replace(/const colleaguesRes = await getColleagues\(todayStr\);/g, 'const colleaguesRes = await getColleagues(todayStr, tenantCfg);');

// Inside getColleagues, pass tenantCfg
content = content.replace(/const sessionRes = await ensureValidSession\(\);/g, 'const sessionRes = await ensureValidSession(false, tenantCfg);');
content = content.replace(/const res = await fetchData\(url\);/g, 'const res = await fetchData(url, "GET", null, tenantCfg);');

// Inside ensureValidSession, pass tenantCfg
content = content.replace(/const config = loadConfig\(typeof req !== 'undefined' \? req : undefined\);/g, "const config = typeof tenantCfg !== 'undefined' && tenantCfg ? tenantCfg : loadConfig(typeof req !== 'undefined' ? req : undefined);");
content = content.replace(/return await doLogin\(config\.username, config\.password\);/g, 'return await doLogin(config.username, config.password, tenantCfg);');

// Inside fetchData, use config from tenantCfg
content = content.replace(/const sessionRes = await ensureValidSession\(\);/g, 'const sessionRes = await ensureValidSession(false, typeof tenantCfg !== "undefined" ? tenantCfg : null);');

// Inside sendWhatsApp, update addLog calls inside runSchedulerLogic
// This is done via replacing addLog(...) to addLog(null, ...., tenantCfg.school_id)
// We'll just define addLog to accept an optional schoolId parameter

fs.writeFileSync(file, content);
console.log('Scheduler refactored successfully');
