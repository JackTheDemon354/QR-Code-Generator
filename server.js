const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const crypto = require('crypto-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup Multer for file uploads (limit 5MB)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Utility: delete file after use
function deleteFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) console.error('Failed to delete:', filePath, err);
  });
}

// Generate PayPal.me URL with AUD currency (amount optional)
function generatePayPalUrl(email, amount) {
  // PayPal.me URLs don't support currency param; amount is in the default currency of the recipient.
  // To explicitly request AUD, you could build a PayPal payment URL (but PayPal.me does not allow currency param)
  // We'll just create a standard PayPal.me link with amount.
  const sanitized = email.replace(/@|\./g, '');
  if (amount && amount > 0) {
    return `https://www.paypal.me/${sanitized}/${amount}`;
  }
  return `https://www.paypal.me/${sanitized}`;
}

function generateWiFiString(ssid, encryption, password) {
  if (!ssid) return '';
  const enc = encryption.toUpperCase() === 'NONE' ? 'nopass' : encryption.toUpperCase();
  return `WIFI:T:${enc};S:${ssid};P:${password || ''};;`;
}

// POST /generate
app.post('/generate', upload.single('file'), async (req, res) => {
  try {
    let qrText = '';
    const type = req.body.type || 'link';
    const label = req.body.label || '';
    const fgColor = req.body.fgColor || '#000000';
    const bgColor = req.body.bgColor || '#ffffff';
    const outputFormat = req.body.outputFormat || 'png';
    const encryptPass = (req.body.encrypt || '').trim();

    switch (type) {
      case 'link':
        qrText = req.body.text || ' ';
        break;
      case 'text':
        qrText = req.body.text || ' ';
        break;
      case 'wifi':
        qrText = generateWiFiString(req.body.wifiSsid, req.body.wifiEncryption, req.body.wifiPassword);
        break;
      case 'payment':
        qrText = generatePayPalUrl(req.body.paymentEmail || '', req.body.paymentAmount);
        break;
      case 'file':
        if (!req.file) {
          return res.status(400).send('No file uploaded for file QR.');
        }
        // Create a public link for file
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        qrText = fileUrl;
        break;
      default:
        qrText = ' ';
    }

    // Encrypt if needed
    if (encryptPass) {
      qrText = crypto.AES.encrypt(qrText, encryptPass).toString();
    }

    // Generate QR code in requested format
    if (outputFormat === 'png') {
      const qrBuffer = await QRCode.toBuffer(qrText, {
        color: { dark: fgColor, light: bgColor },
        width: 300,
      });

      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `attachment; filename="qrcode.png"`);

      return res.send(qrBuffer);
    }

    if (outputFormat === 'svg') {
      const svgString = await QRCode.toString(qrText, {
        type: 'svg',
        color: { dark: fgColor, light: bgColor },
        width: 300,
      });

      res.set('Content-Type', 'image/svg+xml');
      res.set('Content-Disposition', `attachment; filename="qrcode.svg"`);

      return res.send(svgString);
    }

    if (outputFormat === 'pdf') {
      const doc = new PDFDocument({ size: [320, 400] });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="qrcode.pdf"');

      const qrDataUrl = await QRCode.toDataURL(qrText, {
        color: { dark: fgColor, light: bgColor },
        width: 300,
      });

      doc.image(Buffer.from(qrDataUrl.split(',')[1], 'base64'), 10, 10, { width: 300 });

      if (label) {
        doc.fontSize(14).text(label, 10, 320, { width: 300, align: 'center' });
      }

      doc.end();
      doc.pipe(res);
      return;
    }

    res.status(400).send('Unsupported format requested.');

  } catch (error) {
    console.error('Error generating QR:', error);
    res.status(500).send('Server error');
  } finally {
    // Clean up uploaded file if any
    if (req.file) {
      deleteFile(req.file.path);
    }
  }
});

// Serve uploaded files publicly (for file QR)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
