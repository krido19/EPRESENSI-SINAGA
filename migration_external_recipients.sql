-- ============================================================
-- Migration: Tambah Penerima Eksternal (Beda Sekolah)
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- 1. Tambah kolom ke tabel recipients
ALTER TABLE recipients
  ADD COLUMN IF NOT EXISTS is_external  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sekolah_asal TEXT    DEFAULT NULL;

-- 2. Tambah kolom template pesan eksternal ke school_configs
ALTER TABLE school_configs
  ADD COLUMN IF NOT EXISTS message_external_pagi   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS message_external_siang  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS message_external_pulang TEXT DEFAULT NULL;

-- 3. Buat index agar filter is_external cepat
CREATE INDEX IF NOT EXISTS idx_recipients_is_external
  ON recipients (school_id, is_external, aktif);

-- Selesai. Cek hasilnya:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'recipients'
  AND column_name IN ('is_external', 'sekolah_asal')
ORDER BY column_name;
