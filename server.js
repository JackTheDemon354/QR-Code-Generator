const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const CryptoJS = require('crypto-js');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Helper: Encrypt data
function encryptIfNeeded(text, password) {
  if (!password) return text;
  return CryptoJS.AES.encrypt(text, password).toString();
}

// Helper: Decrypt data
function decryptIfNeeded(encryptedText, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, password);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return null;
  }
}

// GET root
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// GET decryption page
app.get('/decrypt', (req, res) => {
  res.send(`
    <html><body>
    <h2>Decrypt QR Data</h2>
    <form method="POST" action="/decrypt">
      <input type="hidden" name="data" value="${req.query.data || ''}" />
      <label>Password: <input type="text" name="password" /></label>
      <button type="submit">🔓 Decrypt</button>
    </form>
    </body></html>
  `);
});

// POST decryption
app.post('/decrypt', (req, res) => {
  const { data, password } = req.body;
  const decrypted = decryptIfNeeded(data, password);
  if (decrypted) {
    res.send(`<h3>✅ Decrypted:</h3><pre>${decrypted}</pre>`);
  } else {
    res.send('<h3>❌ Failed to decrypt. Wrong password?</h3>');
  }
});

// POST: Generate QR
app.post('/generate', upload.single('file'), async (req, res) => {
  const type = req.body.type;
  const label = req.body.label || '';
  const format = req.body.outputFormat || 'png';
  const fgColor = req.body.fgColor || '#000000';
  const bgColor = req.body.bgColor || '#ffffff';
  const password = req.body.encrypt || '';
  let data = '';

  // Build QR content
  switch (type) {
    case 'link':
    case 'text':
      data = req.body.text || ' ';
      break;
    case 'wifi':
      const ssid = req.body.wifiSsid;
      const enc = req.body.wifiEncryption;
      const pwd = req.body.wifiPassword || '';
      const encType = enc === 'NONE' ? 'nopass' : enc;
      data = `WIFI:T:${encType};S:${ssid};P:${pwd};;`;
      break;
    case 'payment':
      const email = (req.body.paymentEmail || '').toLowerCase();
      let amount = parseFloat(req.body.paymentAmount || 0);
      const cleanEmail = email.replace(/@|\./g, '');
      data = `https://www.paypal.me/${cleanEmail}${amount ? '/' + amount : ''}`;
      break;
    case 'file':
      if (!req.file) return res.status(400).send('No file uploaded.');
      const filePath = req.file.path;
      const fileLink = `${req.protocol}://${req.get('host')}/${filePath}`;
      data = fileLink;
      break;
    default:
      data = ' ';
  }

  // Encrypt data if password is set
  const finalData = encryptIfNeeded(data, password);

  try {
    if (format === 'pdf') {
      const doc = new PDFDocument();
      const filename = `qr-${Date.now()}.pdf`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/pdf');

      const tempPath = `temp-${Date.now()}.png`;
      await QRCode.toFile(tempPath, finalData, {
        color: { dark: fgColor, light: bgColor },
        width: 300
      });

      doc.image(tempPath, 100, 100, { width: 200 });
      if (label) {
        doc.fontSize(16).text(label, { align: 'center', baseline: 'bottom' });
      }

      doc.pipe(res);
      doc.end();

      setTimeout(() => {
        fs.unlinkSync(tempPath);
      }, 5000);
    } else if (format === 'svg') {
      const svg = await QRCode.toString(finalData, {
        type: 'svg',
        color: { dark: fgColor, light: bgColor },
        width: 300
      });
      res.setHeader('Content-Disposition', 'attachment; filename="qr.svg"');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } else {
      const buffer = await QRCode.toBuffer(finalData, {
        color: { dark: fgColor, light: bgColor },
        width: 300
      });
      res.setHeader('Content-Disposition', 'attachment; filename="qr.png"');
      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    }
  } catch (err) {
    console.error('QR error:', err);
    res.status(500).send('Error generating QR code.');
  }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server
app.listen(port, () => {
  console.log(`✅ QR Code Generator running at http://localhost:${port}`);
});
