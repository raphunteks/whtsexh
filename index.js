import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';

// Import Commands (Sistem Modular Sederhana)
import handleAiCommand from './src/commands/ai.js';
import handleStickerCommand from './src/commands/sticker.js';

const logger = pino({ level: 'silent' }); // Ubah ke 'info' atau 'debug' untuk melihat log detail

async function connectToWhatsApp() {
    console.log('🔄 Memulai koneksi ke WhatsApp...');
    
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`📡 Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false, // Kita akan tangani QR secara manual
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
    });

    // Event: Koneksi Update (QR Code & Reconnect Logic)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan QR Code ini untuk login:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena:', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('❌ Sesi telah logout. Silakan hapus folder "session" dan scan QR kembali.');
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
            
            // Abaikan pesan dari status atau dari bot itu sendiri
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            // Ekstrak teks dari berbagai jenis pesan
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';

            const prefix = '!';
            if (!text.startsWith(prefix)) return;

            // Parsing Command & Argumen
            const args = text.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const sender = msg.key.remoteJid;

            console.log(`[COMMAND] ${command} dari ${sender}`);

            // ================= COMMAND HANDLER =================
            switch (command) {
                case 'menu':
                case 'help':
                    const menuText = `*🤖 BOT MENU 🤖*\n\n` +
                                     `* !menu / !help* - Menampilkan menu ini\n` +
                                     `* !ai <teks>* - Tanya AI (Gemini/OpenAI)\n` +
                                     `* !sticker* - Balas gambar atau kirim gambar dengan caption\n` +
                                     `* !ping* - Cek status bot\n` +
                                     `* !tagall* - (Admin Only) Tag semua member grup\n`;
                    await sock.sendMessage(sender, { text: menuText }, { quoted: msg });
                    break;

                case 'ping':
                    await sock.sendMessage(sender, { text: '🏓 Pong! Bot aktif dan berjalan dengan baik.' }, { quoted: msg });
                    break;

                case 'ai':
                    await handleAiCommand(sock, msg, args);
                    break;

                case 'sticker':
                case 's':
                    await handleStickerCommand(sock, msg);
                    break;

                case 'tagall':
                    // Hanya bisa di grup
                    if (!sender.endsWith('@g.us')) {
                        await sock.sendMessage(sender, { text: '❌ Perintah ini hanya bisa digunakan di dalam grup!' }, { quoted: msg });
                        return;
                    }
                    const groupMetadata = await sock.groupMetadata(sender);
                    const participants = groupMetadata.participants.map(p => p.id);
                    let mentionText = `*📢 PERHATIAN SEMUA 📢*\n\n`;
                    participants.forEach(p => mentionText += `👉 @${p.split('@')[0]}\n`);
                    await sock.sendMessage(sender, { text: mentionText, mentions: participants }, { quoted: msg });
                    break;
                    
                // !tiktok dan !ig bisa ditambahkan modulnya dengan konsep serupa
            }
        } catch (error) {
            console.error('Error saat memproses pesan:', error);
        }
    });
}

connectToWhatsApp();