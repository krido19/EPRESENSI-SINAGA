# Graph Report - EPRESENSI-SINAGA  (2026-08-24)

## Corpus Check
- 18 files · ~52,392 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 434 nodes · 496 edges · 18 communities (10 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `23ab419f`
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
- loadConfig

## God Nodes (most connected - your core abstractions)
1. `📅 Panduan Cron Job & WhatsApp Gateway — ePresensi Sinaga` - 20 edges
2. `📱 Baileys — WhatsApp Web Gateway Self-Hosted` - 11 edges
3. `fetch` - 9 edges
4. `loadConfig()` - 9 edges
5. `✨ Fitur Utama Aplikasi` - 9 edges
6. `runSchedulerLogic()` - 8 edges
7. `escapeHtml()` - 7 edges
8. `ensureTenantSession()` - 7 edges
9. `ensureValidSession()` - 7 edges
10. `sendWhatsApp()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `formatWaHtml()` --calls--> `escapeHtml()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 46 → community 3_

## Import Cycles
- None detected.

## Communities (18 total, 8 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.01
Nodes (205): activeDayPopup, addAccountFeedback, addRecipientForm, addRecipientModal, analyticsChartBody, appGatekeeperScreen, AVATAR_GRADIENTS, batchCountBtn (+197 more)

### Community 1 - "server.js"
Cohesion: 0.05
Nodes (56): actionLimiter, addLog(), allowedOrigins, app, AUTH_SECRET, authCache, authLimiter, BAILEYS_AUTH_DIR (+48 more)

### Community 2 - "dependencies"
Cohesion: 0.06
Nodes (34): cheerio, cors, dotenv, express, multer, @ngrok/ngrok, node-cron, node-fetch (+26 more)

### Community 3 - "escapeHtml"
Cohesion: 0.13
Nodes (20): applyColleaguesData(), buildDateStrip(), escapeHtml(), getTeacherAvatar(), loadColleagues(), loadLogs(), loadRecipients(), loadSchoolAccounts() (+12 more)

### Community 4 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 5 - "✨ Fitur Utama Aplikasi"
Cohesion: 0.06
Nodes (29): 1. Unhandled Disconnect & Reconnect Lifecycle Crash, 2. Gateway Dispatcher Conflict ("Gagal kirim: Terjadi kesalahan"), 3. Normalisasi Format Nomor Telepon & JID WhatsApp, 4. Isolasi Kunci Sesi Kriptografi (.gitignore), 5. Pengendalian Noise Log (Pino Silent Logger), 🏗️ Arsitektur Integrasi Baileys, ⚠️ Masalah yang Dihadapi & Solusinya, 🛠️ Panduan Teknis & Troubleshooting: @whiskeysockets/baileys (+21 more)

### Community 13 - "formatWaHtml"
Cohesion: 0.08
Nodes (24): 1. Master Cron — Setiap 1 Menit, 2. Cache Sekolah — Supabase (5 Menit), 3. Logic Pengiriman — `runSchedulerLogic(type, cfg)`, 🏗️ Arsitektur Cron Job, 🔧 Cara Kerja Detail, ➕ Cara Menambah Cron Job Baru, 📋 Checklist Membuat Cron Baru, 📦 Dependensi yang Digunakan (+16 more)

### Community 15 - "fix_auth.js"
Cohesion: 0.18
Nodes (11): Apa itu Baileys?, 🏗️ Arsitektur Baileys di Project Ini, 🔄 Auto-Reconnect & Lifecycle, 📱 Baileys — WhatsApp Web Gateway Self-Hosted, 📋 Checklist Setup Baileys di Project Baru, 🗂️ File Session Baileys, ⚡ Inisialisasi Baileys saat Server Start, 🔢 Normalisasi Format Nomor Telepon (+3 more)

### Community 46 - "loadConfig"
Cohesion: 0.33
Nodes (6): formatWaHtml(), initSelectOptions(), loadConfig(), loadWaStatus(), switchWaGatewayUI(), updateMessagePreviews()

## Knowledge Gaps
- **325 isolated node(s):** `deploy_vps.sh script`, `ngrok`, `name`, `version`, `description` (+320 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `📅 Panduan Cron Job & WhatsApp Gateway — ePresensi Sinaga` connect `formatWaHtml` to `fix_auth.js`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `deploy_vps.sh script`, `ngrok`, `name` to the rest of the system?**
  _325 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.009302325581395349 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.052083333333333336 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `escapeHtml` be split into smaller, more focused modules?**
  _Cohesion score 0.13157894736842105 - nodes in this community are weakly interconnected._
- **Should `✨ Fitur Utama Aplikasi` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._