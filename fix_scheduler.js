const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

const startIndex = content.indexOf('let cronPagi = null;');
const setupEndIndex = content.indexOf('// ─── API Routes ──────────────────────────────────────────────────────────────');

if (startIndex !== -1 && setupEndIndex !== -1) {
  const newSetupScheduler = `// ─── Scheduler (Stateless Multi-Tenant Minute-Cron) ──────────────
let masterCron = null;

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
}

`;
  
  // Replace the old block with new one
  const oldBlock = content.substring(startIndex, setupEndIndex);
  content = content.replace(oldBlock, newSetupScheduler);
  fs.writeFileSync(file, content);
  console.log('Replaced setupScheduler successfully.');
} else {
  console.log('Could not find boundaries.');
}
