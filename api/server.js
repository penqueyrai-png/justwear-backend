const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const FormData = require('form-data');
const { google } = require('googleapis');

const app = express();

// -------------------------------------------------------------
// 1. Middlewares
// -------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log ตรวจสอบ Request ที่เข้ามาจริงใน Vercel Dashboard
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  next();
});

// ตั้งค่า Multer เก็บไฟล์สลิปใน Memory Buffer
const upload = multer({ storage: multer.memoryStorage() });

// -------------------------------------------------------------
// 2. Route เช็กสถานะ Server
// -------------------------------------------------------------
app.get(['/', '/api'], (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Justwear Backend Service is running properly on Vercel!'
  });
});

// -------------------------------------------------------------
// 3. Route บันทึกออเดอร์ (Google Sheets + Discord Webhook)
// -------------------------------------------------------------
app.post(['/api/order', '/order'], async (req, res) => {
  try {
    const { orderId, customerName, phone, address, items, totalAmount, slipUrl } = req.body || {};
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
    const thaiDate = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    // --- 🟢 3.1 บันทึกลง GOOGLE SHEETS ---
    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_SHEET_ID) {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;

      // บันทึกลงแท็บ Orders
      const orderRow = [
        orderId || `ORD-${Date.now()}`,
        customerName || '-',
        phone || '-',
        address || '-',
        thaiDate,
        'รอดำเนินการ',
        parsedItems.length,
        totalAmount || 0,
        slipUrl || '-'
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Orders!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [orderRow] },
      });

      // บันทึกลงแท็บ Items (ถ้ามีรายการสินค้า)
      if (parsedItems.length > 0) {
        const itemRows = parsedItems.map((item, index) => [
          orderId || '-',
          customerName || '-',
          index + 1,
          item.screenName || '-',
          item.screenNumber || '-',
          item.size || '-',
          item.color || '-',
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Items!A:G',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: itemRows },
        });
      }
    }

    // --- 🟣 3.2 ส่งแจ้งเตือนเข้า DISCORD WEBHOOK ---
    if (process.env.DISCORD_WEBHOOK_URL) {
      const itemListText = parsedItems.length > 0
        ? parsedItems.map((item, i) => `${i + 1}. ไซส์: ${item.size || '-'} | สี: ${item.color || '-'} | สกรีนชื่อ: ${item.screenName || '-'} | เบอร์: ${item.screenNumber || '-'}`).join('\n')
        : 'ไม่มีรายการสินค้า';

      const discordEmbed = {
        title: `🛍️ ออเดอร์ใหม่: ${orderId || 'ไม่ระบุรหัส'}`,
        color: 0x5865F2,
        fields: [
          { name: '👤 ชื่อลูกค้า', value: customerName || '-', inline: true },
          { name: '📞 เบอร์โทร', value: phone || '-', inline: true },
          { name: '📍 ที่อยู่จัดส่ง', value: address || '-' },
          { name: '💰 ยอดรวมทั้งหมด', value: `${totalAmount || 0} บาท`, inline: true },
          { name: '📦 จำนวน', value: `${parsedItems.length} รายการ`, inline: true },
          { name: '👕 รายการเสื้อ', value: itemListText }
        ],
        footer: { text: `สั่งซื้อเมื่อ: ${thaiDate} | Justwear LKB` }
      };

      if (slipUrl) {
        discordEmbed.image = { url: slipUrl };
      }

      await axios.post(process.env.DISCORD_WEBHOOK_URL, { embeds: [discordEmbed] });
    }

    return res.status(200).json({
      success: true,
      message: 'บันทึกข้อมูลลง Google Sheet และแจ้งเตือน Discord เรียบร้อยแล้ว'
    });

  } catch (error) {
    console.error('API Order Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
    });
  }
});

// -------------------------------------------------------------
// 4. Route ส่งสลิปไป Discord (Multer File Upload)
// -------------------------------------------------------------
app.post(['/api/verify-slip', '/verify-slip'], upload.single('slip'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'กรุณาแนบรูปสลิป' });
    }

    const amount = req.body.amount || 'ไม่ได้ระบุยอด';
    const orderId = req.body.orderId || 'ไม่ระบุรหัส';

    const formData = new FormData();
    formData.append('content', `📩 **มีออเดอร์ใหม่เข้ามา!**\n💵 ยอดเงิน: ${amount}\n🆔 Order ID: ${orderId}`);
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    await axios.post(process.env.DISCORD_WEBHOOK_URL, formData, {
      headers: formData.getHeaders()
    });

    return res.json({ success: true, message: 'ส่งข้อมูลเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('Error sending to Discord:', error);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งข้อมูล' });
  }
});

// -------------------------------------------------------------
// 5. Catch-all 404 Handler (ตอบกลับแบบ JSON เมื่อไม่พบ Path)
// -------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.url} - Endpoint not found`
  });
});

// -------------------------------------------------------------
// 6. Export ให้ Vercel Serverless Function
// -------------------------------------------------------------
module.exports = app;