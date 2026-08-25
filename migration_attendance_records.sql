-- ==============================================================================
-- Migration: Tambah tabel attendance_records untuk rekap mingguan
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  nip TEXT NOT NULL,
  nama TEXT NOT NULL,
  tanggal DATE NOT NULL,
  status TEXT,
  jam_masuk TEXT,
  jam_pulang TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, nip, tanggal)
);

-- RLS (Row Level Security) - Opsional, backend Node.js menggunakan service_role
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- Beri komentar agar admin lain paham fungsinya
COMMENT ON TABLE public.attendance_records IS 'Tabel untuk menyimpan data arsip absensi harian (diambil setiap jam 22:00) sebagai bahan baku Rekap Mingguan.';
