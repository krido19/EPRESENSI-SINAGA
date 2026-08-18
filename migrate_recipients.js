/**
 * migrate_recipients.js
 * Migrasi data penerima WA dari recipients.json lokal ke tabel Supabase.
 * Jalankan: node migrate_recipients.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("[ERROR] SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ada di .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const recipientsFile = path.join(__dirname, "recipients.json");
  if (!fs.existsSync(recipientsFile)) {
    console.error("[ERROR] recipients.json tidak ditemukan.");
    process.exit(1);
  }
  const localData = JSON.parse(fs.readFileSync(recipientsFile, "utf8"));
  console.log(`[INFO] Ditemukan ${localData.length} penerima di recipients.json`);

  let schoolId = process.argv[2] || null;
  if (!schoolId) {
    const configFile = path.join(__dirname, "config.json");
    if (fs.existsSync(configFile)) {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
      schoolId = cfg.schoolId || null;
    }
  }

  if (!schoolId || schoolId === "local") {
    const { data: schools, error } = await supabase.from("schools").select("id, name").order("name");
    if (error || !schools || schools.length === 0) {
      console.error("[ERROR] Tidak bisa ambil daftar sekolah:", error && error.message);
      console.error("[INFO] Jalankan: node migrate_recipients.js <school_id>");
      process.exit(1);
    }
    console.log("\n[INFO] Daftar sekolah yang tersedia:");
    schools.forEach((s, i) => console.log(`  ${i+1}. ${s.name}  ->  id: ${s.id}`));
    console.log("\n[INFO] Jalankan ulang: node migrate_recipients.js <school_id>\n");
    process.exit(0);
  }

  console.log(`[INFO] Menggunakan school_id: ${schoolId}`);
  let berhasil = 0, dilewati = 0, gagal = 0;

  for (const r of localData) {
    const clean = String(r.nomor || "").replace(/[^0-9]/g, "");
    if (!clean || !r.nama) {
      console.warn(`[SKIP] Data tidak lengkap: ${JSON.stringify(r)}`);
      dilewati++;
      continue;
    }
    const { data: existing } = await supabase.from("recipients").select("id").eq("nomor", clean).eq("school_id", schoolId).limit(1);
    if (existing && existing.length > 0) {
      console.log(`[SKIP] Sudah ada: ${r.nama} (${clean})`);
      dilewati++;
      continue;
    }
    const { error } = await supabase.from("recipients").insert({ nama: r.nama.trim(), nomor: clean, aktif: r.aktif !== false, school_id: schoolId });
    if (error) {
      console.error(`[GAGAL] ${r.nama} (${clean}): ${error.message}`);
      gagal++;
    } else {
      console.log(`[OK] Ditambahkan: ${r.nama} (${clean})`);
      berhasil++;
    }
  }

  console.log(`\n================================`);
  console.log(`OK Berhasil  : ${berhasil}`);
  console.log(`-- Dilewati  : ${dilewati} (sudah ada)`);
  console.log(`XX Gagal     : ${gagal}`);
  console.log(`================================`);
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
