const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

function generateWiFiString({ ssid, password, encryption }) {
  if (!ssid) return '';
  // Format: WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;;
  const enc = encryption.toUpperCase() === 'NONE' ? 'nopass' : encryption.toUpperCase();
  return `WIFI:T:${enc};S:${ssid};P:${password || ''};;`;
}

app.post('/generate', upload.single('logo'), async (req, res) => {
  const { type, text, fgColor, bgColor, label, wifiSsid, wifiPassword, wifiEncryption, paymentEmail, paymentAmount } = req.body;
  const logoPath = req.file ? req.file.path : null;

  let qrData = '';

  switch (type) {
    case 'link':
      qrData = text || '';
      break;
    case 'text':
      qrData = text || '';
      break;
    case 'wifi':
      qrData = generateWiFiString({
        ssid: wifiSsid,
        password: wifiPassword,
        encryption: wifiEncryption || 'WPA'
      });
      break;
    case 'payment':
      // Using PayPal.me link for payment
      // If amount provided, append it
      if (!paymentEmail) {
        return res.status(400).send('Payment email required');
      }
      const baseEmail = paymentEmail.toLowerCase();
      let amt = '';
      if (paymentAmount && !isNaN(paymentAmount)) {
        amt = paymentAmount;
      }
      // PayPal.me url
      qrData = `https://www.paypal.me/${baseEmail.replace(/@|\./g,'')}${amt ? '/' + amt : ''}`;
      break;
    default:
      qrData = text || '';
  }

  const size = 400;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  try {
    const qrBuffer = await QRCode.toBuffer(qrData, {
      color: {
        dark: fgColor || '#000000',
        light: bgColor || '#FFFFFF',
      },
      width: size,
    });

    const qrImage = await loadImage(qrBuffer);
    ctx.drawImage(qrImage, 0, 0, size, size);

    // Draw logo if uploaded
    if (logoPath) {
      const logo = await loadImage(logoPath);
      const logoSize = size / 4;
      const x = (size - logoSize) / 2;
      const y = (size - logoSize) / 2;
      ctx.drawImage(logo, x, y, logoSize, logoSize);
      fs.unlinkSync(logoPath); // remove uploaded image
    }

    const outputName = `qr-${Date.now()}.png`;
    const outPath = path.join(__dirname, outputName);
    const out = fs.createWriteStream(outPath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);

    out.on('finish', () => {
      res.send(`
        <h1>✅ Your QR Code</h1>
        ${label ? `<h3>${label}</h3>` : ''}
        <img src="/${outputName}" style="width:300px"><br><br>
        <a href="/${outputName}" download>⬇️ Download PNG</a><br><br>
        <a href="/">🔙 Go Back</a>
      `);
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to generate QR code');
  }
});

app.use(express.static('.'));

app.listen(PORT, () => {
  console.log(`QR Generator app running at http://localhost:${PORT}`);
});
