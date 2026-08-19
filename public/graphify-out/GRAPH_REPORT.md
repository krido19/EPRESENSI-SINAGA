# Graph Report - EPRESENSI-SINAGA  (2026-08-19)

## Corpus Check
- 49 files · ~286,638 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 507 nodes · 537 edges · 49 communities (19 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `71a94bcd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- server.js
- dependencies
- escapeHtml
- manifest.json
- ✨ Fitur Utama Aplikasi
- applyTheme
- loadStatus
- sw.js
- rules/graphify.md
- workflows/graphify.md
- deploy_vps.sh
- formatWaHtml
- template_daftar_guru_50673033.md
- fix_auth.js
- fix_login_handler.js
- fix_mastercron.js
- fix_scheduler.js
- migrate_to_supabase.js
- fix_appjs_head.js
- refactor_api.js
- setup_superadmin.js
- setup_user.js
- add_debug.js
- add_run_now.js
- add_superadmin_api.js
- add_superadmin_app.js
- add_superadmin_ui.js
- debug_parser2.js
- debug_parser3.js
- debug_status_codes.js
- fix_dangling.js
- fix_ensure.js
- fix_login.js
- fix_loop.js
- fix_req.js
- fix_server_login.js
- fix_sigs.js
- fix_status_codes.js
- refactor_scheduler.js
- restore_login.js
- restore_phase1.js
- rm_debug.js
- unified_fix.js
- migrate_recipients.js
- loadConfig

## God Nodes (most connected - your core abstractions)
1. `fetch` - 9 edges
2. `loadConfig()` - 9 edges
3. `✨ Fitur Utama Aplikasi` - 9 edges
4. `runSchedulerLogic()` - 8 edges
5. `escapeHtml()` - 7 edges
6. `ensureTenantSession()` - 7 edges
7. `ensureValidSession()` - 7 edges
8. `sendWhatsApp()` - 7 edges
9. `showToast()` - 6 edges
10. `loadColleagues()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `formatWaHtml()` --calls--> `escapeHtml()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 46 → community 3_

## Import Cycles
- None detected.

## Communities (49 total, 30 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.01
Nodes (205): activeDayPopup, addAccountFeedback, addRecipientForm, addRecipientModal, analyticsChartBody, appGatekeeperScreen, AVATAR_GRADIENTS, batchCountBtn (+197 more)

### Community 1 - "server.js"
Cohesion: 0.05
Nodes (56): actionLimiter, addLog(), allowedOrigins, app, AUTH_SECRET, authCache, authLimiter, BAILEYS_AUTH_DIR (+48 more)

### Community 2 - "dependencies"
Cohesion: 0.06
Nodes (30): cheerio, cors, dotenv, express, multer, node-cron, node-fetch, dependencies (+22 more)

### Community 3 - "escapeHtml"
Cohesion: 0.13
Nodes (20): applyColleaguesData(), buildDateStrip(), escapeHtml(), getTeacherAvatar(), loadColleagues(), loadLogs(), loadRecipients(), loadSchoolAccounts() (+12 more)

### Community 4 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 5 - "✨ Fitur Utama Aplikasi"
Cohesion: 0.07
Nodes (28): 1. Unhandled Disconnect & Reconnect Lifecycle Crash, 2. Gateway Dispatcher Conflict ("Gagal kirim: Terjadi kesalahan"), 3. Normalisasi Format Nomor Telepon & JID WhatsApp, 4. Isolasi Kunci Sesi Kriptografi (.gitignore), 5. Pengendalian Noise Log (Pino Silent Logger), 🏗️ Arsitektur Integrasi Baileys, ⚠️ Masalah yang Dihadapi & Solusinya, 🛠️ Panduan Teknis & Troubleshooting: @whiskeysockets/baileys (+20 more)

### Community 13 - "formatWaHtml"
Cohesion: 0.40
Nodes (3): { createClient }, fs, supabase

### Community 15 - "fix_auth.js"
Cohesion: 0.40
Nodes (4): content, endIndex, fs, startIndex

### Community 16 - "fix_login_handler.js"
Cohesion: 0.40
Nodes (4): content, endIdx, fs, startIdx

### Community 17 - "fix_mastercron.js"
Cohesion: 0.40
Nodes (4): c, endIdx, fs, startIdx

### Community 18 - "fix_scheduler.js"
Cohesion: 0.40
Nodes (4): content, fs, setupEndIndex, startIndex

### Community 19 - "migrate_to_supabase.js"
Cohesion: 0.40
Nodes (3): { createClient }, fs, supabase

### Community 20 - "fix_appjs_head.js"
Cohesion: 0.50
Nodes (3): content, fs, gatekeeperFormIdx

### Community 21 - "refactor_api.js"
Cohesion: 0.50
Nodes (3): content, fs, TODO: Fetch from Supabase synchronously? No, express routes should be refactored

### Community 45 - "migrate_recipients.js"
Cohesion: 0.33
Nodes (4): { createClient }, fs, path, supabase

### Community 46 - "loadConfig"
Cohesion: 0.33
Nodes (6): formatWaHtml(), initSelectOptions(), loadConfig(), loadWaStatus(), switchWaGatewayUI(), updateMessagePreviews()

## Knowledge Gaps
- **364 isolated node(s):** `fs`, `content`, `fs`, `content`, `fs` (+359 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `fs`, `content`, `fs` to the rest of the system?**
  _364 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.009302325581395349 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.052083333333333336 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `escapeHtml` be split into smaller, more focused modules?**
  _Cohesion score 0.13157894736842105 - nodes in this community are weakly interconnected._
- **Should `✨ Fitur Utama Aplikasi` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._