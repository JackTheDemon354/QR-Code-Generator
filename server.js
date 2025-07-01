const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload setup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Encryption
function encrypt(text, password) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data, password) {
  const [ivHex, encryptedHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const key = crypto.scryptSync(password, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// Main QR Generator
app.post('/generate', upload.single('file'), async (req, res) => {
  let text = req.body.text || '';
  const { type, wifiSsid, wifiEncryption, wifiPassword, multiLinks, paymentTo, paymentAmount, label, fgColor, bgColor, encrypt: password, outputFormat } = req.body;

  // Handle types
  if (type === 'wifi') {
    text = `WIFI:T:${wifiEncryption};S:${wifiSsid};P:${wifiPassword || ''};;`;
  } else if (type === 'multilink') {
    text = multiLinks;
  } else if (type === 'payment') {
    const email = (paymentTo || '').toLowerCase().replace(/[@.]/g, '');
    const amt = parseFloat(paymentAmount || 0);
    text = `https://www.paypal.me/${email}${amt > 0 ? '/' + amt : ''}`;
  } else if (type === 'file' && req.file) {
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    text = fileUrl;
  }

  // Optional encryption
  if (password) {
    text = encrypt(text, password);
  }

  // Generate QR
  const qrOpts = {
    color: { dark: fgColor || '#000000', light: bgColor || '#ffffff' },
    type: outputFormat === 'svg' ? 'svg' : 'png',
    width: 300
  };

  if (outputFormat === 'pdf') {
    const doc = new PDFDocument();
    const filename = `qr-${Date.now()}.pdf`;
    const filePath = path.join(__dirname, 'public', filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    const dataURL = await QRCode.toDataURL(text, qrOpts);
    const img = dataURL.replace(/^data:image\/png;base64,/, '');
    doc.image(Buffer.from(img, 'base64'), 100, 100, { width: 200 });
    if (label) doc.text(label, { align: 'center' });
    doc.end();
    stream.on('finish', () => res.download(filePath));
  } else {
    const qr = await QRCode.toBuffer(text, qrOpts);
    const fileExt = outputFormat === 'svg' ? 'svg' : 'png';
    const filename = `qr-${Date.now()}.${fileExt}`;
    const filePath = path.join(__dirname, 'public', filename);
    fs.writeFileSync(filePath, qr);
    res.download(filePath);
  }
});

// Decrypt Link Generator
app.post('/generate-decrypt-link', (req, res) => {
  const { text, password } = req.body;
  if (!text || !password) return res.json({ error: 'Missing input' });

  const encoded = encodeURIComponent(Buffer.from(text).toString('base64'));
  const link = `${req.protocol}://${req.get('host')}/decrypt?data=${encoded}`;
  res.json({ link });
});

// Decrypt Page
app.get('/decrypt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'decrypt.html'));
});

app.post('/decrypt', express.urlencoded({ extended: true }), (req, res) => {
  const { encryptedData, password } = req.body;
  try {
    const decoded = Buffer.from(encryptedData, 'base64').toString('utf8');
    const result = decrypt(decoded, password);
    res.send(`<p><b>Decrypted:</b> ${result}</p><a href="/decrypt">Back</a>`);
  } catch (err) {
    res.send('<p><b>Wrong password or data!</b></p><a href="/decrypt">Try again</a>');
  }
});

// Serve uploads
app.use('/uploads', express.static(uploadsDir));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
