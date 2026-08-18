const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. runSchedulerLogic
content = content.replace(
  "async function runSchedulerLogic(type = 'pagi') {",
  "async function runSchedulerLogic(type = 'pagi', tenantCfg = null) {"
);

content = content.replace(
  "const session = await ensureValidSession();",
  "const session = await ensureValidSession(false, tenantCfg);"
);

// 2. ensureValidSession
content = content.replace(
  "async function ensureValidSession(forceFresh = false) {",
  "async function ensureValidSession(forceFresh = false, tenantCfg = null) {"
);

content = content.replace(
  "return await doLogin(config.username, config.password);",
  "return await doLogin(config.username, config.password, tenantCfg);"
);

// 3. doLogin
content = content.replace(
  "async function doLogin(username, password) {",
  "async function doLogin(username, password, tenantCfg = null) {"
);

// 4. getColleagues / fetchColleaguesAttendance
// wait, runSchedulerLogic uses fetchColleaguesAttendance directly!
content = content.replace(
  "async function fetchColleaguesAttendance(cookieStr, day, year, month, noCache = false) {",
  "async function fetchColleaguesAttendance(cookieStr, day, year, month, noCache = false, tenantCfg = null) {"
);

// wait, fetchColleaguesAttendance calls loadConfig() internally? Let's check
// We will replace loadConfig calls inside fetchColleaguesAttendance using our generic string.
// Let's just pass tenantCfg down.

// 5. getTodayLogs
// wait, runSchedulerLogic calls getTodayLogs?
content = content.replace(
  "async function getTodayLogs() {",
  "async function getTodayLogs(tenantCfg = null) {"
);

// In runSchedulerLogic, replace the loadRecipients call to use supabase directly because loadRecipients is global!
// wait, runSchedulerLogic calls sendToAllRecipients? No, it has its own logic.
// wait, runSchedulerLogic calls `const recipients = loadRecipients().filter(r => r.aktif !== false);`
// Let's find it.
const recipientsRegex = /const recipients = loadRecipients\(\w*\)\.filter\(r => r\.aktif !== false\);/g;
const loadRecipientsReplacement = `
  let recipients = [];
  if (tenantCfg && tenantCfg.school_id) {
    const { data } = await supabase.from('recipients').select('*').eq('school_id', tenantCfg.school_id).eq('aktif', true);
    recipients = data || [];
  } else {
    recipients = loadRecipients().filter(r => r.aktif !== false);
  }
`;
content = content.replace(recipientsRegex, loadRecipientsReplacement);


// addLog inside runSchedulerLogic
content = content.replace(
  /addLog\(\{/g,
  "addLog(typeof tenantCfg !== 'undefined' && tenantCfg ? { tenantCfg } : null, {"
);

fs.writeFileSync(file, content);
console.log('Fixed signatures successfully.');
