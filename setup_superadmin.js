require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setupSuperAdmin() {
  const email = 'superadmin@epresensi.com';
  const password = 'SuperAdminPassword123!';

  console.log('Creating Super Admin in Supabase Auth...');
  
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true
  });

  if (authErr && !authErr.message.includes('already exists')) {
    console.error('Error creating super admin:', authErr);
    process.exit(1);
  }

  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === email);
  
  if (!user) {
    console.error('Could not find super admin user.');
    process.exit(1);
  }

  console.log('Super Admin User ID:', user.id);

  // Assign super_admin role
  const { data: existingRole } = await supabase.from('user_roles').select('*').eq('user_id', user.id).single();
  
  if (!existingRole) {
    const { error: roleErr } = await supabase.from('user_roles').insert({
      user_id: user.id,
      role: 'super_admin'
    });
    if (roleErr) console.error('Error creating role:', roleErr);
    else console.log('Super Admin role assigned successfully!');
  } else {
    if (existingRole.role !== 'super_admin') {
      await supabase.from('user_roles').update({ role: 'super_admin' }).eq('user_id', user.id);
      console.log('Updated existing role to super_admin.');
    } else {
      console.log('Role already assigned.');
    }
  }

  console.log(`\n==========================================`);
  console.log(`✅ Super Admin Setup Complete!`);
  console.log(`Email   : ${email}`);
  console.log(`Password: ${password}`);
  console.log(`==========================================\n`);
}

setupSuperAdmin();
