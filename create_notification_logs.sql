-- ============================================================
-- Tabel: notification_logs
-- Tujuan: Menyimpan riwayat pengiriman WA notifikasi absensi
-- Jalankan di: Supabase Dashboard -> SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id   uuid        REFERENCES public.schools(id) ON DELETE SET NULL,
  type        text        NOT NULL DEFAULT 'manual', -- 'pagi' | 'siang' | 'pulang' | 'manual'
  nama        text        NOT NULL DEFAULT '',
  nomor       text        NOT NULL DEFAULT '',
  status      text        NOT NULL,                  -- 'sent' | 'failed'
  error_msg   text,
  gateway     text        DEFAULT 'baileys',         -- 'baileys' | 'fonnte'
  message     text,                                  -- isi pesan (maks 500 karakter)
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- Index untuk query cepat per sekolah + tanggal
CREATE INDEX IF NOT EXISTS idx_notif_logs_school_date
  ON public.notification_logs (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_logs_status
  ON public.notification_logs (status, created_at DESC);

-- Row Level Security
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Service role bisa semua operasi (untuk server Node.js)
CREATE POLICY "service_role_all" ON public.notification_logs
  FOR ALL USING (true) WITH CHECK (true);

-- User biasa hanya bisa baca log sekolahnya sendiri (opsional)
-- CREATE POLICY "school_read_own" ON public.notification_logs
--   FOR SELECT USING (school_id = (SELECT school_id FROM user_roles WHERE user_id = auth.uid()));

COMMENT ON TABLE public.notification_logs IS
  'Riwayat pengiriman notifikasi WA presensi — persistent, tidak hilang saat server restart';

-- Cek hasil
SELECT COUNT(*) as total_logs FROM public.notification_logs;
