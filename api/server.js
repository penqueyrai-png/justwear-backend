const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const FormData = require('form-data');

const app = express();

// 1. อนุญาตให้ Frontend ยิง API เข้ามาได้
app.use(cors());
app.use(express.json());

// 2. ตั้งค่า Multer เก็บไฟล์ใน Memory
const upload = multer({ storage: multer.memoryStorage() });

// -------------------------------------------------------------
// [ส่วนที่เพิ่มใหม่] 3. Route หน้าแรก (ไว้เช็กว่า Server หลังบ้านทำงานไหม)
// -------------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Justwear Backend Service is running properly on Vercel!'
  });
});

// -------------------------------------------------------------
// [โค้ดเดิมของคุณ] 4. Route สำหรับส่งสลิปไป Discord
// -------------------------------------------------------------
app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'กรุณาแนบรูปสลิป' });
    }

    const amount = req.body.amount || 'ไม่ได้ระบุยอด';
    const orderId = req.body.orderId || 'ไม่ระบุรหัส';

    // จัดเตรียมข้อมูลส่งหา Discord
    const formData = new FormData();
    formData.append('content', `📩 **มีออเดอร์ใหม่เข้ามา!**\n💵 ยอดเงิน: ${amount}\n🆔 Order ID: ${orderId}`);
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // ยิงข้อมูลเข้า Discord Webhook URL
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
// [ส่วนที่เพิ่มใหม่/สำคัญ] 5. Export สำหรับ Vercel Serverless
// -------------------------------------------------------------
module.exports = app;