$server = Get-Content 'server.js' -Raw -Encoding UTF8
$server = $server -replace "messagePagiSudah: cfg\.messagePagiSudah \|\| '',\s*messagePulang: cfg\.messagePulang \|\| '',\s*messagePulangSudah: cfg\.messagePulangSudah \|\| '',", "messagePagiSudah: cfg.messagePagiSudah || '',
      messageSiang: cfg.messageSiang || '',
      messageSiangSudah: cfg.messageSiangSudah || '',
      messagePulang: cfg.messagePulang || '',
      messagePulangSudah: cfg.messagePulangSudah || '',"
$server = $server -replace "'messagePagi','messagePagiSudah','messagePulang','messagePulangSudah','testModeSudahAbsen'", "'messagePagi','messagePagiSudah','messageSiang','messageSiangSudah','messagePulang','messagePulangSudah','testModeSudahAbsen'"
Set-Content 'server.js' -Value $server -Encoding UTF8

$app = Get-Content 'public/app.js' -Raw -Encoding UTF8
$app = $app -replace "const cfgMessagePagiSudah         = document\.getElementById\('cfgMessagePagiSudah'\);", "const cfgMessagePagiSudah         = document.getElementById('cfgMessagePagiSudah');
const cfgMessageSiang             = document.getElementById('cfgMessageSiang');
const cfgMessageSiangSudah        = document.getElementById('cfgMessageSiangSudah');"
$app = $app -replace "const whatsappPreviewPagiSudah    = document\.getElementById\('whatsappPreviewPagiSudah'\);", "const whatsappPreviewPagiSudah    = document.getElementById('whatsappPreviewPagiSudah');
const whatsappPreviewSiang        = document.getElementById('whatsappPreviewSiang');
const whatsappPreviewSiangSudah   = document.getElementById('whatsappPreviewSiangSudah');"
$app = $app -replace "if \(cfgMessagePagiSudah && config\.messagePagiSudah\) cfgMessagePagiSudah\.value = config\.messagePagiSudah;", "if (cfgMessagePagiSudah && config.messagePagiSudah) cfgMessagePagiSudah.value = config.messagePagiSudah;
    if (cfgMessageSiang && config.messageSiang) cfgMessageSiang.value = config.messageSiang;
    if (cfgMessageSiangSudah && config.messageSiangSudah) cfgMessageSiangSudah.value = config.messageSiangSudah;"
$app = $app -replace "whatsappPreviewPagiSudah\.innerHTML = formatWaHtml\(cfgMessagePagiSudah\.value\);\n  }", "whatsappPreviewPagiSudah.innerHTML = formatWaHtml(cfgMessagePagiSudah.value);
  }
  if (cfgMessageSiang && whatsappPreviewSiang) {
    whatsappPreviewSiang.innerHTML = formatWaHtml(cfgMessageSiang.value);
  }
  if (cfgMessageSiangSudah && whatsappPreviewSiangSudah) {
    whatsappPreviewSiangSudah.innerHTML = formatWaHtml(cfgMessageSiangSudah.value);
  }"
$app = $app -replace "if \(cfgMessagePagiSudah\) cfgMessagePagiSudah\.addEventListener\('input', updateMessagePreviews\);", "if (cfgMessagePagiSudah) cfgMessagePagiSudah.addEventListener('input', updateMessagePreviews);
if (cfgMessageSiang) cfgMessageSiang.addEventListener('input', updateMessagePreviews);
if (cfgMessageSiangSudah) cfgMessageSiangSudah.addEventListener('input', updateMessagePreviews);"
$app = $app -replace "messagePagiSudah: cfgMessagePagiSudah\?\.value \|\| '',", "messagePagiSudah: cfgMessagePagiSudah?.value || '',
          messageSiang: cfgMessageSiang?.value || '',
          messageSiangSudah: cfgMessageSiangSudah?.value || '',"
Set-Content 'public/app.js' -Value $app -Encoding UTF8
