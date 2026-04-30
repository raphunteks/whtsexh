import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';

// Import Commands (Sistem Modular Sederhana)
import handleAiCommand from './src/commands/ai.js';
import handleStickerCommand from './src/commands/sticker.js';

const logger = pino({ level: 'silent' }); 

// ==========================================
// PENGATURAN PAIRING CODE
// ==========================================
// GANTI NOMOR DI BAWAH INI DENGAN NOMOR HP BOT ANDA!
// Gunakan format internasional tanpa tanda '+' (contoh untuk Indonesia: 628...)
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
        printQRInTerminal: !usePairingCode, // Matikan QR bawaan jika pakai pairing code
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        // WA Web versi terbaru mensyaratkan browser info yang spesifik untuk pairing code
        browser: Browsers.macOS('Chrome'), 
        generateHighQualityLinkPreview: true,
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
                console.log(`4. Pilih 'Tautkan dengan nomor telepon saja' (di bawah layar scan QR).`);
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
            console.log('Koneksi terputus karena:', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            
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

    // Event: Menerima Pesan Baru
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
                                     `* !tagall* - Tag semua member grup\n`;
                    await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                    break;

                case 'ping':
                    await sock.sendMessage(sender, { text: '🏓 Pong!' }, { quoted: msg });
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
                    const participants = groupMetadata.participants.map(p => p.id);
                    let mentionText = `*📢 PERHATIAN SEMUA 📢*\n\n`;
                    participants.forEach(p => mentionText += `👉 @${p.split('@')[0]}\n`);
                    await sock.sendMessage(sender, { text: mentionText, mentions: participants }, { quoted: msg });
                    break;
            }
        } catch (error) {
            console.error('Error saat memproses pesan:', error);
        }
    });
}

connectToWhatsApp();
