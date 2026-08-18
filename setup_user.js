require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setupUser() {
  const email = 'admin@smkn3magelang.sch.id';
  const password = 'Password123!';
  const schoolId = process.env.DEFAULT_SCHOOL_ID;

  console.log('Creating user in Supabase Auth...');
  
  // Create user in Supabase Auth
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true
  });

  if (authErr) {
    if (authErr.message.includes('already exists')) {
      console.log('User already exists in Auth. Looking up user ID...');
    } else {
      console.error('Error creating user:', authErr);
      process.exit(1);
    }
  }

  // Get user ID
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === email);
  
  if (!user) {
    console.error('Could not find user after creation.');
    process.exit(1);
  }

  console.log('User ID:', user.id);

  // Check if role exists
  const { data: existingRole } = await supabase.from('user_roles').select('*').eq('user_id', user.id).single();
  
  if (!existingRole) {
    console.log('Assigning role to school...');
    const { error: roleErr } = await supabase.from('user_roles').insert({
      user_id: user.id,
      role: 'school_admin',
      school_id: schoolId
    });
    
    if (roleErr) console.error('Error creating role:', roleErr);
    else console.log('Role assigned successfully!');
  } else {
    console.log('Role already assigned.');
  }

  console.log(`\n==========================================`);
  console.log(`✅ User Setup Complete!`);
  console.log(`Email   : ${email}`);
  console.log(`Password: ${password}`);
  console.log(`==========================================\n`);
}

setupUser();
