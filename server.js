const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');
const PDFDocument = require('pdfkit');

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
  const enc = encryption.toUpperCase() === 'NONE' ? 'nopass' : encryption.toUpperCase();
  return `WIFI:T:${enc};S:${ssid};P:${password || ''};;`;
}

app.post('/generate', upload.single('logo'), async (req, res) => {
  const {
    type,
    text,
    fgColor,
    bgColor,
    label,
    wifiSsid,
    wifiPassword,
    wifiEncryption,
    paymentEmail,
    paymentAmount,
    outputFormat = 'png',
  } = req.body;
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
        encryption: wifiEncryption || 'WPA',
      });
      break;
    case 'payment':
      if (!paymentEmail) {
        return res.status(400).send('Payment email required');
      }
      const baseEmail = paymentEmail.toLowerCase();
      let amt = '';
      if (paymentAmount && !isNaN(paymentAmount)) {
        amt = paymentAmount;
      }
      qrData = `https://www.paypal.me/${baseEmail.replace(/@|\\./g, '')}${amt ? '/' + amt : ''}`;
      break;
    default:
      qrData = text || '';
  }

  if (outputFormat === 'svg') {
    // Generate SVG with logo embedded if present
    try {
      // Generate base QR SVG
      const svgString = await QRCode.toString(qrData, {
        type: 'svg',
        color: { dark: fgColor || '#000000', light: bgColor || '#FFFFFF' },
        margin: 1,
        width: 400,
      });

      // If no logo, send plain SVG
      if (!logoPath) {
        res.type('image/svg+xml');
        return res.send(svgString);
      }

      // Embed logo by loading SVG and inserting image in center is complex; as workaround,
      // we create PNG with logo and convert to PDF or PNG instead. Here just send SVG without logo.
      // For full logo embedding in SVG, you’d need SVG manipulation (not trivial).

      res.type('image/svg+xml');
      return res.send(svgString);
    } catch (e) {
      console.error(e);
      return res.status(500).send('Failed to generate SVG QR code');
    }
  } else if (outputFormat === 'pdf') {
    try {
      // Generate PNG buffer first to embed in PDF
      const pngBuffer = await QRCode.toBuffer(qrData, {
        color: { dark: fgColor || '#000000', light: bgColor || '#FFFFFF' },
        width: 400,
      });

      // Load logo image if any
      let logoImg = null;
      if (logoPath) {
        logoImg = await loadImage(logoPath);
        fs.unlinkSync(logoPath);
      }

      // Create canvas with QR and logo
      const canvas = createCanvas(400, 400);
      const ctx = canvas.getContext('2d');
      const qrImg = await loadImage(pngBuffer);
      ctx.drawImage(qrImg, 0, 0, 400, 400);

      if (logoImg) {
        const size = 100;
        const x = (400 - size) / 2;
        const y = (400 - size) / 2;
        ctx.drawImage(logoImg, x, y, size, size);
      }

      // Create PDF and embed canvas PNG data
      const pdfDoc = new PDFDocument({ size: [400, 500], margin: 20 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="qr-${Date.now()}.pdf"`);

      pdfDoc.pipe(res);

      const imgBuffer = canvas.toBuffer();

      pdfDoc.image(imgBuffer, 0, 0, { width: 400 });
      if (label) {
        pdfDoc.fontSize(20).text(label, 0, 420, { align: 'center', width: 400 });
      }
      pdfDoc.end();
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to generate PDF');
    }
  } else {
    // PNG output with canvas and logo
    try {
      const size = 400;
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');

      const qrBuffer = await QRCode.toBuffer(qrData, {
        color: { dark: fgColor || '#000000', light: bgColor || '#FFFFFF' },
        width: size,
      });
      const qrImage = await loadImage(qrBuffer);
      ctx.drawImage(qrImage, 0, 0, size, size);

      if (logoPath) {
        const logo = await loadImage(logoPath);
        const logoSize = size / 4;
        const x = (size - logoSize) / 2;
        const y = (size - logoSize) / 2;
        ctx.drawImage(logo, x, y, logoSize, logoSize);
        fs.unlinkSync(logoPath);
      }

      if (label) {
        ctx.font = '28px Arial';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText(label, size / 2, size - 30);
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
      res.status(500).send('Failed to generate PNG QR code');
    }
  }
});

app.use(express.static('.'));

app.listen(PORT, () => {
  console.log(`QR Generator app running at http://localhost:${PORT}`);
});
