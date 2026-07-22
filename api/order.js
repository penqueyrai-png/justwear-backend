const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  // 1. ปลดล็อก CORS ให้ Frontend เรียกใช้งานได้ทุกโดเมน
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // รองรับ Preflight Request จากเบราว์เซอร์
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { orderId, customerName, phone, address, items, totalAmount, slipUrl } = req.body || {};

    // แปลง items เผื่อกรณีส่งมาจาก Form เป็น String
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);

    // จัดการวันที่และเวลาเป็นโซนไทย (Asia/Bangkok)
    const thaiDate = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    // ==========================================
    // 🟢 1. บันทึกลง GOOGLE SHEETS
    // ==========================================
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

    // บันทึกลงแท็บ Items (กรณีมีรายการเสื้อ)
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

    // ==========================================
    // 🟣 2. ส่งแจ้งเตือนเข้า DISCORD WEBHOOK
    // ==========================================
    if (process.env.DISCORD_WEBHOOK_URL) {
      const itemListText = parsedItems.length > 0
        ? parsedItems.map((item, i) => `${i + 1}. ไซส์: ${item.size || '-'} | สี: ${item.color || '-'} | สกรีนชื่อ: ${item.screenName || '-'} | เบอร์: ${item.screenNumber || '-'}`).join('\n')
        : 'ไม่มีรายการสินค้า';

      const discordEmbed = {
        title: `🛍️ ออเดอร์ใหม่: ${orderId || 'ไม่ระบุรหัส'}`,
        color: 0x5865F2, // สีม่วง Discord
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

      // แนบรูปสลิปหากมี URL
      if (slipUrl) {
        discordEmbed.image = { url: slipUrl };
      }

      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [discordEmbed] })
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'บันทึกข้อมูลลง Google Sheet และแจ้งเตือน Discord เรียบร้อยแล้ว' 
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' 
    });
  }
};