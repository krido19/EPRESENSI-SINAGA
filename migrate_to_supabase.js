require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log("Starting migration to Supabase...");

  // 1. Create Default School
  let config = {};
  if (fs.existsSync('config.json')) {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  }

  const schoolData = {
    name: config.namaSekolah || 'SMKN 3 Magelang',
    npsn: '20307612', // Ganti jika salah, ini sebagai contoh NPSN
    email: 'admin@smkn3magelang.sch.id', // Dummy email
    plan: 'free',
    epresensi_username: config.username || '',
    epresensi_password: config.password || '', // Akan dienkripsi nanti di phase selanjutnya
    wa_gateway: config.waGateway || 'fonnte',
    fonnte_token: config.fonnteToken || ''
  };

  console.log("Inserting school...");
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .insert(schoolData)
    .select()
    .single();

  if (schoolErr) {
    if (schoolErr.code === '23505') {
       console.log("School already exists, fetching its ID...");
       const { data: existing } = await supabase.from('schools').select('*').eq('npsn', schoolData.npsn).single();
       if(existing) {
           school = existing;
       } else {
           console.error("Error fetching existing school", schoolErr);
           process.exit(1);
       }
    } else {
      console.error("Error inserting school:", schoolErr);
      process.exit(1);
    }
  }

  const schoolId = school.id;
  console.log(`School inserted! ID: ${schoolId}`);

  // Save schoolId to .env for local transition
  fs.appendFileSync('.env', `\nDEFAULT_SCHOOL_ID=${schoolId}\n`);

  // 2. Insert School Configs
  console.log("Inserting school config...");
  const configData = {
    school_id: schoolId,
    scheduler_enabled: config.schedulerEnabled !== false,
    pagi_hour: config.pagiHour ?? 7,
    pagi_minute: config.pagiMinute ?? 30,
    pulang_hour: config.pulangHour ?? 18,
    pulang_minute: config.pulangMinute ?? 0,
    message_pagi: config.messagePagi || '',
    message_pagi_sudah: config.messagePagiSudah || '',
    message_pulang: config.messagePulang || '',
    message_pulang_sudah: config.messagePulangSudah || ''
  };

  const { error: configErr } = await supabase
    .from('school_configs')
    .insert(configData);

  if (configErr) {
    console.error("Error inserting config:", configErr);
  } else {
    console.log("Config inserted!");
  }

  // 3. Insert Recipients
  console.log("Inserting recipients...");
  if (fs.existsSync('recipients.json')) {
    const recipients = JSON.parse(fs.readFileSync('recipients.json', 'utf8'));
    if (recipients.length > 0) {
      const recipientData = recipients.map(r => ({
        school_id: schoolId,
        nama: r.nama,
        nomor: r.nomor,
        aktif: true
      }));

      const { error: recErr } = await supabase
        .from('recipients')
        .insert(recipientData);
      
      if (recErr) {
        console.error("Error inserting recipients:", recErr);
      } else {
        console.log(`Inserted ${recipientData.length} recipients!`);
      }
    }
  }

  // 4. Insert Logs (Optional, skip if too large, but let's do last 50)
  if (fs.existsSync('logs.json')) {
    const logs = JSON.parse(fs.readFileSync('logs.json', 'utf8'));
    const recentLogs = logs.slice(0, 50).map(l => ({
      school_id: schoolId,
      type: l.type,
      message: l.message,
      targets: l.targets ? JSON.stringify(l.targets) : null,
      created_at: new Date(l.timestamp).toISOString()
    }));

    if (recentLogs.length > 0) {
      const { error: logErr } = await supabase.from('activity_logs').insert(recentLogs);
      if (logErr) console.error("Error inserting logs:", logErr);
      else console.log(`Inserted ${recentLogs.length} recent logs!`);
    }
  }

  console.log("Migration complete! You can safely delete JSON files once server.js is updated.");
}

runMigration();
