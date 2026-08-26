const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

let db;
const STORE_PHONE = '0988785068'; // 📱 เบอร์รับเงิน TrueMoney Wallet

// 1. เชื่อมต่อและตั้งค่าตาราง SQLite
(async () => {
  db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (id INTEGER PRIMARY KEY DEFAULT 1, data TEXT);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, image_url TEXT, price REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS product_stocks (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, content TEXT NOT NULL, status TEXT DEFAULT 'AVAILABLE');
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, balance REAL DEFAULT 0.00, role TEXT DEFAULT 'USER');
    CREATE TABLE IF NOT EXISTS topup_history (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, voucher_code TEXT, amount REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);

  const existing = await db.get("SELECT * FROM site_settings WHERE id = 1");
  if (!existing) {
    const defaultConfig = {
      nav: { avatarUrl: "https://via.placeholder.com/40/ff1744/ffffff?text=PRK", username: "PARKIN PRK", role: "ADMIN" },
      popupStep1: { active: true, bannerUrl: "https://via.placeholder.com/400x200/1c1c24/ff1744?text=PARKIN+PRK", badge: "ประกาศจากร้าน", title: "PARKIN PRK ยินดีต้อนรับ", desc: "เลือกซื้อสินค้าและบริการของร้านได้เลย..." },
      popupStep2: { brandHeader: "PARKIN PRK STORE", avatarUrl: "https://via.placeholder.com/100/1c1c24/ff1744?text=PRK", welcomeTitle: "ยินดีต้อนรับ", welcomeDesc: "บริการดิจิทัลและสินค้าเกม ราคาดี ปลอดภัย", shopBtnText: "เข้าสู่ร้านค้าเลย" },
      heroSection: { subTitle: "PARKIN PRK SHOP", titleMain: "PARKIN", titleAccent: "PRK", desc: "บริการดิจิทัลและสินค้าเกม ราคาดี ปลอดภัย", avatarUrl: "https://via.placeholder.com/70/1c1c24/ff1744?text=PRK" },
      stats: { users: 0, categories: 0, stock: 0, sales: 0.00 }
    };
    await db.run("INSERT INTO site_settings (id, data) VALUES (1, ?)", [JSON.stringify(defaultConfig)]);
  }
})();

// 🔑 API Login (แยก User / Admin)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'nextrashop' && password === 'nextrastore') {
    return res.json({
      success: true,
      message: 'เข้าสู่ระบบแอดมินสำเร็จ!',
      user: { username: 'nextrashop', role: 'ADMIN', avatarUrl: 'https://via.placeholder.com/40/ff1744/ffffff?text=ADMIN' }
    });
  }
  if (username && password) {
    return res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ!',
      user: { username, role: 'USER', avatarUrl: 'https://via.placeholder.com/40/333333/ffffff?text=USER' }
    });
  }
  res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
});

// 🎟️ API เช็คและแลกซอง TrueMoney (ยิงผ่าน sp-api เข้าเบอร์ 0988785068)
app.post('/api/topup/truemoney', async (req, res) => {
  const { voucherLink, username } = req.body;
  if (!voucherLink) return res.status(400).json({ success: false, message: 'กรุณากรอกลิงก์ซองของขวัญ' });

  const match = voucherLink.match(/v=([a-zA-Z0-9]+)/);
  const voucherCode = match ? match[1] : voucherLink;

  // ป้องกันซองซ้ำใน DB ระบบ
  const used = await db.get("SELECT * FROM topup_history WHERE voucher_code = ?", [voucherCode]);
  if (used) return res.status(400).json({ success: false, message: 'ซองนี้ถูกใช้งานในระบบไปแล้ว!' });

  try {
    const apiRes = await axios.get(`https://sp-api.apps.bot-hosting.cloud/api/truemoney`, {
      params: { phone: STORE_PHONE, voucher: voucherCode }
    });

    const result = apiRes.data;

    if (result.status === 'success' || result.status === 200 || result.code === 'SUCCESS') {
      const amount = parseFloat(result.amount || result.data?.amount || 0);

      if (amount > 0) {
        await db.run("INSERT INTO topup_history (username, voucher_code, amount) VALUES (?, ?, ?)", [username, voucherCode, amount]);
        return res.json({ success: true, message: `เติมเงินสำเร็จ! ได้รับเงิน ฿${amount.toFixed(2)} บาท`, amount });
      }
    }
    return res.status(400).json({ success: false, message: result.message || 'ซองนี้ถูกใช้ไปแล้ว หรือลิงก์ซองไม่ถูกต้อง' });

  } catch (err) {
    const errorMsg = err.response?.data?.message || 'ไม่สามารถเชื่อมต่อระบบรับซองได้ในขณะนี้';
    return res.status(500).json({ success: false, message: errorMsg });
  }
});

// 🛒 API Config / สินค้า / สต็อก
app.get('/api/config', async (req, res) => {
  const row = await db.get("SELECT data FROM site_settings WHERE id = 1");
  res.json(JSON.parse(row.data));
});

app.post('/api/admin/update-config', async (req, res) => {
  await db.run("UPDATE site_settings SET data = ? WHERE id = 1", [JSON.stringify(req.body)]);
  res.json({ success: true, message: "บันทึกข้อมูลสำเร็จ!" });
});

app.get('/api/products', async (req, res) => {
  const products = await db.all(`
    SELECT p.*, COUNT(s.id) as stock_count 
    FROM products p 
    LEFT JOIN product_stocks s ON p.id = s.product_id AND s.status = 'AVAILABLE'
    GROUP BY p.id
  `);
  res.json(products);
});

app.post('/api/admin/products', async (req, res) => {
  const { name, image_url, price } = req.body;
  await db.run("INSERT INTO products (name, image_url, price) VALUES (?, ?, ?)", [name, image_url, price]);
  res.json({ success: true, message: "เพิ่มการ์ดสินค้าเรียบร้อย!" });
});

app.post('/api/admin/stocks', async (req, res) => {
  const { product_id, raw_contents } = req.body;
  const lines = raw_contents.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (let content of lines) {
    await db.run("INSERT INTO product_stocks (product_id, content) VALUES (?, ?)", [product_id, content]);
  }
  res.json({ success: true, message: `เติมสต็อกสำเร็จ ${lines.length} ชิ้น!` });
});

app.listen(5000, () => console.log('🚀 Server running on http://localhost:5000'));
