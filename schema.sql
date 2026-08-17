-- ==============================================================================
-- ePresensi SaaS Multi-Tenant Schema
-- Jalankan seluruh script ini di Supabase SQL Editor
-- ==============================================================================

-- Aktifkan ekstensi UUID (biasanya sudah aktif otomatis di Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabel Utama Sekolah (Tenant)
CREATE TABLE public.schools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  npsn TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free',
  plan_expires_at TIMESTAMPTZ,
  epresensi_username TEXT,
  epresensi_password TEXT,
  wa_gateway TEXT DEFAULT 'fonnte',
  fonnte_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Konfigurasi Jadwal & Pesan (Per Sekolah)
CREATE TABLE public.school_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  scheduler_enabled BOOLEAN DEFAULT true,
  pagi_hour INT DEFAULT 7,
  pagi_minute INT DEFAULT 30,
  pulang_hour INT DEFAULT 18,
  pulang_minute INT DEFAULT 0,
  message_pagi TEXT,
  message_pagi_sudah TEXT,
  message_pulang TEXT,
  message_pulang_sudah TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabel Daftar Penerima WA (Guru Per Sekolah)
CREATE TABLE public.recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  nomor TEXT NOT NULL,
  aktif BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabel Riwayat Aktivitas / Log
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  type TEXT,
  message TEXT,
  targets JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel Role Pengguna (Untuk Super Admin & School Admin)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL, -- Merujuk ke auth.users() secara konseptual
  role TEXT NOT NULL DEFAULT 'school_admin', -- 'super_admin' | 'school_admin'
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE, -- Null jika super_admin
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabel Riwayat Langganan (Billing)
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  midtrans_order_id TEXT UNIQUE,
  status TEXT,
  amount INT,
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- Row Level Security (RLS) - Opsional namun disarankan
-- Untuk tahap awal backend Node.js (menggunakan Service Role Key), RLS bisa dilewati,
-- namun kita set untuk keamanan masa depan.
-- ==============================================================================
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Karena backend menggunakan service_role_key, otomatis bypass RLS.
