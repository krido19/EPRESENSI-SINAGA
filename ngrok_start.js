const ngrok = require('@ngrok/ngrok');

async function startNgrok() {
  try {
    const listener = await ngrok.forward({
      addr: 3000,
      authtoken: '3I6tP8WShH5ZyVSxy9XurbH6npc_82L6rCiASSt7B1VRQKXnm',
      domain: 'broker-morale-harmony.ngrok-free.dev',
    });
    console.log(`[Ngrok] ✅ Tunnel established at: ${listener.url()}`);
    
    // Auto-Healing: Cek tunnel setiap 30 detik
    let failCount = 0;
    setInterval(async () => {
      try {
        const res = await fetch(listener.url() + '/health', { 
          headers: { 'ngrok-skip-browser-warning': 'true' },
          signal: AbortSignal.timeout(10000) // Timeout 10 detik
        });
        if (res.ok) failCount = 0; // Sehat
        else throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        failCount++;
        console.warn(`[Ngrok] ⚠️ Gagal ping tunnel (${failCount}/3): ${err.message}`);
        
        if (failCount >= 3) {
          console.error(`[Ngrok] ❌ Tunnel terdeteksi putus (mati lampu / internet putus). PM2 akan merestart otomatis!`);
          process.exit(1); // Memaksa mati agar PM2 langsung me-restart-nya
        }
      }
    }, 30000); // Tiap 30 detik

  } catch (error) {
    console.error(`[Ngrok] ❌ Error starting tunnel:`, error.message);
    process.exit(1);
  }
}

startNgrok();

