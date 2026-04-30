import { downloadMediaMessage } from '@whiskeysockets/baileys';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import fs from 'fs';

// WAJIB: Memberitahu fluent-ffmpeg di mana lokasi file binary ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller);

export default async function handleStickerCommand(sock, msg) {
    const sender = msg.key.remoteJid;
    
    // Cek apakah pesan adalah gambar atau membalas (reply) gambar
    const isImage = msg.message.imageMessage;
    const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

    if (!isImage && !isQuotedImage) {
        await sock.sendMessage(sender, { text: '❌ Kirim gambar dengan caption !sticker, atau reply gambar dengan !sticker' }, { quoted: msg });
        return;
    }

    try {
        await sock.sendMessage(sender, { text: '⏳ Sedang membuat stiker, mohon tunggu sebentar...' }, { quoted: msg });

        // Tentukan target pesan mana yang mau di-download (pesan saat ini atau yang di-reply)
        const targetMessage = isQuotedImage ? 
            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage } : 
            msg;

        // Download media menggunakan fungsi bawaan Baileys
        const buffer = await downloadMediaMessage(
            targetMessage,
            'buffer',
            {},
            { logger: console } // opsional
        );

        const inputTemp = `./temp_${Date.now()}.jpeg`;
        const outputTemp = `./temp_${Date.now()}.webp`;

        fs.writeFileSync(inputTemp, buffer);

        // Konversi Gambar ke format WebP (Syarat Stiker WA) menggunakan FFmpeg
        ffmpeg(inputTemp)
            .input(inputTemp)
            .on('error', async (err) => {
                console.error('FFmpeg Error:', err);
                if (fs.existsSync(inputTemp)) fs.unlinkSync(inputTemp);
                await sock.sendMessage(sender, { text: '❌ Gagal mengkonversi gambar menjadi stiker.' }, { quoted: msg });
            })
            .on('end', async () => {
                // Kirim stiker
                await sock.sendMessage(sender, { sticker: { url: outputTemp } }, { quoted: msg });
                
                // Bersihkan file sementara
                if (fs.existsSync(inputTemp)) fs.unlinkSync(inputTemp);
                if (fs.existsSync(outputTemp)) fs.unlinkSync(outputTemp);
            })
            .addOutputOptions([
                '-vcodec',
                'libwebp',
                '-vf',
                // Perintah untuk menjaga aspek rasio dan membuat background transparan
                "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse"
            ])
            .toFormat('webp')
            .save(outputTemp);

    } catch (error) {
        console.error('Sticker Error:', error);
        await sock.sendMessage(sender, { text: '❌ Terjadi kesalahan saat memproses gambar.' }, { quoted: msg });
    }
}
