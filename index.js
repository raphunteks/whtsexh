import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';

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
// GANTI NOMOR DI BAWAH INI DENGAN NOMOR HP BOT ANDA!
const phoneNumber = "6285338922586"; // Ganti dengan nomor bot Anda
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
                                     `* !tagall* - Tag semua member grup\n\n` +
                                     `_Bot ini juga dilengkapi fitur Auto Welcome & Leave otomatis._`;
                    await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                    break;

                case 'ping':
                    await sock.sendMessage(sender, { text: '🏓 Pong! Bot aktif dan siap melayani.' }, { quoted: msg });
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
