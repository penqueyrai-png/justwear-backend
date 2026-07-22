import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { orderId, customerName, phone, address, items, totalAmount } = req.body;

    // ยืนยันตัวตนด้วย Google Auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // 1. บันทึกลงแท็บ Orders
    const orderRow = [
      orderId,
      customerName,
      phone,
      address,
      new Date().toLocaleDateString('th-TH'),
      'รอดำเนินการ',
      items ? items.length : 0,
      totalAmount,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Orders!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [orderRow] },
    });

    // 2. บันทึกลงแท็บ Items (กรณีมีรายการเสื้อ)
    if (items && items.length > 0) {
      const itemRows = items.map((item, index) => [
        orderId,
        customerName,
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

    return res.status(200).json({ success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}