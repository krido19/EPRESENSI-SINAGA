-- ─── Migration: Tambahkan kolom jadwal Jumat ke tabel school_configs ──────────
-- Jalankan di Supabase Dashboard → SQL Editor

ALTER TABLE school_configs
  ADD COLUMN IF NOT EXISTS jumat_pulang_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS jumat_pulang_hour     smallint NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS jumat_pulang_minute   smallint NOT NULL DEFAULT 0;

-- Verifikasi hasilnya:
-- SELECT school_id, jumat_pulang_enabled, jumat_pulang_hour, jumat_pulang_minute FROM school_configs;
