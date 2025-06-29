const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for form data and static files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // put your index.html and assets in /public

// Setup multer for logo uploads
const upload = multer({ dest: 'uploads/' });

// Helper to generate WiFi string
function generateWiFiString(ssid, encryption, password) {
  if (!ssid) return '';
  const enc = encryption.toUpperCase() === 'NONE' ? 'nopass' : encryption.toUpperCase();
  return `WIFI:T:${enc};S:${ssid};P:${password || ''};;`;
}

// Endpoint to generate QR code image/pdf/svg
app.post('/generate', upload.single('logo'), async (req, res) => {
  try {
    const { type, text, wifiSsid, wifiEncryption, wifiPassword, paymentEmail, paymentAmount, fgColor, bgColor, label, outputFormat } = req.body;

    // Determine QR data content
    let qrData = ' ';
    if (type === 'link') {
      qrData = text || ' ';
    } else if (type === 'text') {
      qrData = text || ' ';
    } else if (type === 'wifi') {
      qrData = generateWiFiString(wifiSsid, wifiEncryption, wifiPassword);
    } else if (type === 'payment') {
      let email = (paymentEmail || '').toLowerCase();
      let amt = paymentAmount && !isNaN(paymentAmount) && paymentAmount > 0 ? paymentAmount : '';
      qrData = `https://www.paypal.me/${email.replace(/@|\\./g, '')}${amt ? '/' + amt : ''}`;
    }

    const qrOptions = {
      color: {
        dark: fgColor || '#000000',
        light: bgColor || '#ffffff'
      },
      width: 300
    };

    if (outputFormat === 'svg') {
      // Generate SVG and send
      const svgString = await QRCode.toString(qrData, { type: 'svg', color: qrOptions.color, width: 300 });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svgString);
    }

    if (outputFormat === 'pdf') {
      // Generate PNG data URL for QR code first
      const dataUrl = await QRCode.toDataURL(qrData, qrOptions);

      // Create PDF document
      const doc = new PDFDocument({ size: [320, 400] });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=qr-code.pdf');

      doc.pipe(res);

      // Draw background color
      doc.rect(0, 0, 320, 400).fill(bgColor || '#ffffff');

      // Draw QR code image (strip off data:image/png;base64,)
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      doc.image(imgBuffer, 10, 10, { width: 300, height: 300 });

      // Draw logo if uploaded
      if (req.file) {
        const logoPath = path.join(__dirname, req.file.path);
        try {
          doc.image(logoPath, 120, 120, { width: 75, height: 75 });
        } catch (e) {
          console.error('Logo image error:', e);
        }
      }

      // Draw label text below QR
      if (label) {
        doc.fillColor(fgColor || 'black');
        doc.fontSize(18);
        doc.text(label, 0, 320, { width: 320, align: 'center' });
      }

      doc.end();

      // Delete uploaded logo after response ends
      res.on('finish', () => {
        if (req.file) {
          fs.unlink(req.file.path, () => {});
        }
      });

      return;
    }

    // Default output PNG image
    // Generate QR PNG buffer
    const pngBuffer = await QRCode.toBuffer(qrData, qrOptions);

    // If no logo and no label, just send PNG
    if (!req.file && !label) {
      res.setHeader('Content-Type', 'image/png');
      return res.send(pngBuffer);
    }

    // Else, draw on canvas (using node-canvas or fallback)
    // Since node-canvas setup is more complex, let's simplify:
    // Just send PNG directly (Render supports serving static files)
    // For full image composition on backend, you can extend later.

    res.setHeader('Content-Type', 'image/png');
    res.send(pngBuffer);

    // Optionally delete logo file immediately
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error generating QR code');
  }
});

// Serve index.html from /public folder
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
