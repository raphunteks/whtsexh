import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import process from 'process';
import os from 'os'; // Modul OS ditambahkan untuk membaca spesifikasi server

// Import Commands (Sistem Modular Sederhana)
import handleAiCommand from './src/commands/ai.js';
import handleStickerCommand from './src/commands/sticker.js';

// Matikan log bawaan Baileys agar terminal Railway tidak spam error MAC
const logger = pino({ level: 'silent' }); 

// ==========================================
// ANTI-CRASH HANDLER (Mencegah bot mati karena Bad MAC)
// ==========================================
process.on('uncaughtException', function (err) {
    let e = String(err);
    if (e.includes('conflict')) return;
    if (e.includes('Socket connection timeout')) return;
    if (e.includes('not-authorized')) return;
    if (e.includes('already-exists')) return;
    if (e.includes('rate-overlimit')) return;
    if (e.includes('Connection Closed')) return;
    if (e.includes('Timed Out')) return;
    if (e.includes('Value not found')) return;
    if (e.includes('Bad MAC')) return console.log('Terjadi Error Bad MAC (Abaikan saja)');
    console.log('Caught exception: ', err);
});

process.on('unhandledRejection', function (reason, p) {
    let e = String(reason);
    if (e.includes('conflict')) return;
    if (e.includes('Socket connection timeout')) return;
    if (e.includes('not-authorized')) return;
    if (e.includes('already-exists')) return;
    if (e.includes('rate-overlimit')) return;
    if (e.includes('Connection Closed')) return;
    if (e.includes('Timed Out')) return;
    if (e.includes('Value not found')) return;
    if (e.includes('Bad MAC')) return console.log('Terjadi Error Bad MAC (Abaikan saja)');
    console.log('Unhandled Rejection at: Promise ', p, ' reason: ', reason);
});
// ==========================================

// ==========================================
// PENGATURAN PAIRING CODE
// ==========================================
// NOMOR HP BOT ANDA SUDAH DIPERBARUI DI SINI
const phoneNumber = "6285338922586"; 
const usePairingCode = true;
// ==========================================

async function connectToWhatsApp() {
    console.log('🔄 Memulai koneksi ke WhatsApp...');
    
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`📡 Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            // Optimasi key store untuk mencegah Bad MAC berulang
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        // Gunakan Ubuntu untuk Railway agar lebih stabil saat pairing
        browser: Browsers.ubuntu('Chrome'), 
        generateHighQualityLinkPreview: true,
        // Menonaktifkan sync history penuh yang sering menyebabkan MAC error di awal
        syncFullHistory: false,
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            return { conversation: 'Bot is running' };
        }
    });

    // MEMINTA PAIRING CODE JIKA BELUM LOGIN
    if (usePairingCode && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n====================================================`);
                console.log(`🔑 KODE PAIRING ANDA: ${code}`);
                console.log(`====================================================`);
                console.log(`Cara Login:`);
                console.log(`1. Buka WhatsApp di HP Anda (Nomor Bot).`);
                console.log(`2. Ketuk ikon titik tiga (Opsi lainnya) > Perangkat Tertaut.`);
                console.log(`3. Ketuk 'Tautkan Perangkat'.`);
                console.log(`4. Pilih 'Tautkan dengan nomor telepon saja'.`);
                console.log(`5. Masukkan kode 8 digit di atas.`);
                console.log(`====================================================\n`);
            } catch (err) {
                console.error('Gagal meminta kode pairing:', err);
            }
        }, 3000);
    }

    // Event: Koneksi Update
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena:', lastDisconnect.error?.message || lastDisconnect.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('❌ Sesi telah logout. Silakan hapus folder "session" dan restart.');
            }
        } else if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung ke WhatsApp!');
        }
    });

    // Event: Menyimpan Kredensial Sesi
    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // EVENT: WELCOME & LEAVE MESSAGE
    // ==========================================
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        
        try {
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;

            for (const participant of participants) {
                let ppUrl;
                try {
                    ppUrl = await sock.profilePictureUrl(participant, 'image');
                } catch {
                    ppUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/1200px-Default_pfp.svg.png';
                }

                if (action === 'add') {
                    const welcomeText = `Halo @${participant.split('@')[0]}! 👋\n\nSelamat datang di grup *${groupName}*.\nJangan lupa perkenalkan diri dan baca deskripsi grup ya!`;
                    
                    await sock.sendMessage(id, { 
                        image: { url: ppUrl }, 
                        caption: welcomeText, 
                        mentions: [participant] 
                    });
                    console.log(`[GROUP] Member baru bergabung: ${participant} di grup ${groupName}`);

                } else if (action === 'remove') {
                    const leaveText = `Selamat tinggal @${participant.split('@')[0]} 👋\n\nSemoga sukses selalu di luar sana.`;
                    
                    await sock.sendMessage(id, { 
                        image: { url: ppUrl }, 
                        caption: leaveText, 
                        mentions: [participant] 
                    });
                    console.log(`[GROUP] Member keluar: ${participant} dari grup ${groupName}`);
                }
            }
        } catch (error) {
            console.error('Error pada Welcome/Leave handler:', error);
        }
    });

    // ==========================================
    // EVENT: COMMAND HANDLER (PESAN MASUK)
    // ==========================================
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';

            const prefix = '!';
            if (!text.startsWith(prefix)) return;

            const args = text.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const sender = msg.key.remoteJid;

            console.log(`[COMMAND] ${command} dari ${sender}`);

            switch (command) {
                case 'menu':
                case 'help':
                    const menuText = `*🤖 BOT MENU 🤖*\n\n` +
                                     `* !menu* - Menampilkan menu ini\n` +
                                     `* !ai <teks>* - Tanya AI\n` +
                                     `* !sticker* - Buat stiker\n` +
                                     `* !ping* - Cek status bot\n` +
                                     `* !runtime* - Cek info sistem & server\n` +
                                     `* !tagall* - Tag semua member grup\n\n` +
                                     `_Bot ini juga dilengkapi fitur Auto Welcome & Leave otomatis._`;
                    await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                    break;

                case 'ping':
                    // Hitung kecepatan respon (Ping)
                    const messageTime = msg.messageTimestamp * 1000;
                    const pingSpeed = Date.now() - messageTime;
                    
                    // Hitung total Uptime Bot (sudah berapa lama bot menyala)
                    const uptime = process.uptime();
                    const days = Math.floor(uptime / 86400);
                    const hours = Math.floor((uptime % 86400) / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    const uptimeString = `${days > 0 ? `${days} hari, ` : ''}${hours} jam, ${minutes} menit, ${seconds} detik`;

                    const pingReply = `🏓 *Pong!*\n\n` +
                                      `⚡ *Kecepatan:* ${pingSpeed} ms\n` +
                                      `⏱️ *Bot Aktif:* ${uptimeString}`;

                    await sock.sendMessage(sender, { text: pingReply }, { quoted: msg });
                    break;

                case 'runtime':
                    // 1. Kalkulasi Uptime ke format HH:MM:SS
                    const uptimeSec = process.uptime();
                    const rHours = Math.floor(uptimeSec / 3600).toString().padStart(2, '0');
                    const rMinutes = Math.floor((uptimeSec % 3600) / 60).toString().padStart(2, '0');
                    const rSeconds = Math.floor(uptimeSec % 60).toString().padStart(2, '0');
                    const formattedUptime = `${rHours}:${rMinutes}:${rSeconds}`;

                    // 2. Kalkulasi Start Time (Unix Timestamp)
                    const startTimestamp = Math.floor((Date.now() - (uptimeSec * 1000)) / 1000);

                    // 3. Ambil data Penggunaan RAM Node.js
                    const memUsage = process.memoryUsage();
                    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
                    const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

                    // 4. Ambil Spesifikasi Hardware Server (VPS)
                    const osType = os.type();
                    const osRelease = os.release();
                    const osPlatform = os.platform();
                    const osArch = os.arch();
                    const cpus = os.cpus();
                    const cpuModel = cpus[0].model.trim();
                    const cpuSpeed = cpus[0].speed;
                    const totalRamGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
                    const freeRamGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);

                    // 5. Hitung jumlah Grup
                    let groupCount = 0;
                    try {
                        const groups = await sock.groupFetchAllParticipating();
                        groupCount = Object.keys(groups).length;
                    } catch (e) {
                        groupCount = 'Error/Tidak diketahui';
                    }

                    // Format Pesan
                    const runtimeReply = `⏱️ *Runtime Bot*\n` +
                                         `* Uptime        : ${formattedUptime} (sejak <t:${startTimestamp}:R>)\n` +
                                         `* Start Time    : <t:${startTimestamp}:F>\n` +
                                         `* Grup        : ${groupCount}\n` +
                                         `* Node.js       : ${process.version}\n` +
                                         `* Memory (RSS)  : ${rssMB} MB\n` +
                                         `* Heap Used     : ${heapMB} MB\n\n` +
                                         `🖥️ *Spesifikasi Core VPS*\n` +
                                         `* OS            : ${osType} ${osRelease} (${osPlatform}/${osArch})\n` +
                                         `* CPU           : ${cpuModel}\n` +
                                         `* CPU Cores     : ${cpus.length} cores @ ${cpuSpeed} MHz\n` +
                                         `* RAM (Total)   : ${totalRamGB} GB\n` +
                                         `* RAM (Free)    : ${freeRamGB} GB`;

                    await sock.sendMessage(sender, { text: runtimeReply }, { quoted: msg });
                    break;

                case 'ai':
                    await handleAiCommand(sock, msg, args);
                    break;

                case 'sticker':
                case 's':
                    await handleStickerCommand(sock, msg);
                    break;

                case 'tagall':
                    if (!sender.endsWith('@g.us')) return;
                    const groupMetadata = await sock.groupMetadata(sender);
                    const tagParticipants = groupMetadata.participants.map(p => p.id);
                    let mentionText = `*📢 PERHATIAN SEMUA 📢*\n\n`;
                    tagParticipants.forEach(p => mentionText += `👉 @${p.split('@')[0]}\n`);
                    await sock.sendMessage(sender, { text: mentionText, mentions: tagParticipants }, { quoted: msg });
                    break;
            }
        } catch (error) {
            console.error('Error saat memproses pesan:', error);
        }
    });
}

connectToWhatsApp();
