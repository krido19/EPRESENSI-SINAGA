const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const oldEnsure = `async function ensureValidSession(forceFresh = false, tenantCfg = null) {
  const config = loadConfig(typeof req !== 'undefined' ? req : undefined);`;
const newEnsure = `async function ensureValidSession(forceFresh = false, tenantCfg = null) {
  const config = tenantCfg || loadConfig(undefined);`;
c = c.replace(oldEnsure, newEnsure);

const oldEnsure2 = `async function ensureValidSession(forceFresh = false) {
  const config = loadConfig();`;
const newEnsure2 = `async function ensureValidSession(forceFresh = false, tenantCfg = null) {
  const config = tenantCfg || loadConfig();`;
c = c.replace(oldEnsure2, newEnsure2);

fs.writeFileSync('server.js', c);
console.log('✅ ensureValidSession fixed');
