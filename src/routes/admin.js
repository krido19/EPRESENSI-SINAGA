'use strict';
const { Router } = require('express');
const router = Router();

const { supabase }              = require('../supabase');
const { addLog }                = require('../logger');
const { doLogin }               = require('../epresensi');
const { getActiveSchools, buildTenantCfg } = require('../scheduler');

// Middleware: hanya super_admin
function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'super_admin') return res.status(403).json({ success: false, error: 'Akses ditolak: hanya Super Admin.' });
  next();
}

// State ref untuk invalidate cache dari luar
let schoolsCacheRef = null;
function setSchoolsCacheRef(ref) { schoolsCacheRef = ref; }

// GET semua sekolah
router.get('/schools', requireSuperAdmin, async (req, res) => {
  const { data, error } = await supabase.from('schools').select('*, school_configs(*), subscriptions(*)').order('created_at', { ascending: false });
  if (error) return res.json({ success: false, error: error.message });
  res.json({ success: true, schools: data });
});

// POST tambah sekolah baru
router.post('/schools', requireSuperAdmin, async (req, res) => {
  const { name, npsn, email, password, plan, epresensi_username, epresensi_password, wa_gateway, fonnte_token, wa_number, unit_code, opd_code, pagi_hour, pagi_minute, siang_hour, siang_minute, pulang_hour, pulang_minute } = req.body;
  if (!name || !email || !password) return res.json({ success: false, error: 'name, email, password wajib diisi.' });

  let final_unit = null, final_opd = null;
  if (epresensi_username && epresensi_password) {
    const loginCheck = await doLogin(epresensi_username, epresensi_password);
    if (!loginCheck.success) return res.json({ success: false, error: 'Gagal verifikasi ePresensi: ' + loginCheck.error });
    if (!loginCheck.profile?.unitCode || !loginCheck.profile?.opdCode) return res.json({ success: false, error: 'Gagal mendeteksi Kode Unit & OPD di ePresensi.' });
    final_unit = loginCheck.profile.unitCode;
    final_opd  = loginCheck.profile.opdCode;
  }

  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (authErr) return res.json({ success: false, error: authErr.message });

  const { data: school, error: schoolErr } = await supabase.from('schools').insert({ name, npsn, email, plan: plan || 'free', epresensi_username, epresensi_password, wa_gateway: wa_gateway || 'fonnte', fonnte_token, wa_number, unit_code: final_unit, opd_code: final_opd }).select().single();
  if (schoolErr) return res.json({ success: false, error: schoolErr.message });

  await supabase.from('school_configs').insert({ school_id: school.id, scheduler_enabled: true, scheduler_siang_enabled: true, pagi_hour: pagi_hour ?? 7, pagi_minute: pagi_minute ?? 30, siang_hour: siang_hour ?? 15, siang_minute: siang_minute ?? 30, pulang_hour: pulang_hour ?? 18, pulang_minute: pulang_minute ?? 0 });
  await supabase.from('user_roles').insert({ user_id: authData.user.id, role: 'school_admin', school_id: school.id });

  res.json({ success: true, school, userId: authData.user.id });
});

// PUT update sekolah
router.put('/schools/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const allowed = ['name','npsn','plan','epresensi_username','epresensi_password','wa_gateway','fonnte_token','wa_number','unit_code','opd_code'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const { data, error } = await supabase.from('schools').update(updates).eq('id', id).select().single();
  if (error) return res.json({ success: false, error: error.message });
  const cfgUpdates = {};
  ['scheduler_enabled','scheduler_siang_enabled','pagi_hour','pagi_minute','siang_hour','siang_minute','pulang_hour','pulang_minute','message_pagi','message_pagi_sudah','message_siang','message_siang_sudah','message_pulang','message_pulang_sudah']
    .forEach(k => { if (req.body[k] !== undefined) cfgUpdates[k] = req.body[k]; });
  if (Object.keys(cfgUpdates).length > 0) await supabase.from('school_configs').update(cfgUpdates).eq('school_id', id);
  res.json({ success: true, school: data });
});

// DELETE hapus sekolah
router.delete('/schools/:id', requireSuperAdmin, async (req, res) => {
  const { error } = await supabase.from('schools').delete().eq('id', req.params.id);
  if (error) return res.json({ success: false, error: error.message });
  res.json({ success: true });
});

// GET stats
router.get('/stats', requireSuperAdmin, async (req, res) => {
  const [{ count: totalSchools }, { count: freeSchools }, { count: proSchools }] = await Promise.all([
    supabase.from('schools').select('*', { count: 'exact', head: true }),
    supabase.from('schools').select('*', { count: 'exact', head: true }).eq('plan', 'free'),
    supabase.from('schools').select('*', { count: 'exact', head: true }).eq('plan', 'pro'),
  ]);
  res.json({ success: true, totalSchools, freeSchools, proSchools });
});

module.exports = router;
