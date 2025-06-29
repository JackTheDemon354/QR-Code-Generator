// server.js
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Setup multer for file uploads, max 5MB
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  storage: multer.memoryStorage(),
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // Serve your index.html and assets from /public

// AES Encryption helper
function encrypt(text, password) {
  if (!password) return text;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data, password) {
  const [ivHex, encryptedHex] = data.split(':');
  if (!ivHex || !encryptedHex) return null;
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');
  const key = crypto.scryptSync(password, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}

function prepareData(type, body) {
  switch (type) {
    case 'link':
      return body.text || '';
    case 'multi':
      if (!body.multiLinks) return '';
      // Join multiple URLs separated by newline
      return body.multiLinks.split('\n').map(s => s.trim()).filter(s => s).join('\n');
    case 'text':
      return body.text || '';
    case 'wifi':
      // Format: WIFI:T:WPA;S:ssid;P:password;;
      const enc = (body.wifiEncryption === 'NONE' ? 'nopass' : body.wifiEncryption) || 'WPA';
      const ssid = body.wifiSsid || '';
      const pass = body.wifiPassword || '';
      if (!ssid) return '';
      return `WIFI:T:${enc};S:${ssid};P:${pass};;`;
    case 'payment':
      const email = (body.paymentEmail || '').trim();
      const amount = (body.paymentAmount || '').trim();
      if (!email) return '';
      return amount ? `paypal:${email}?amount=${amount}` : `paypal:${email}`;
    case 'file':
      // file data handled separately
      return null;
    default:
      return '';
  }
}

app.post('/generate', upload.fields([{ name: 'file' }, { name: 'logo' }]), async (req, res) => {
  try {
    const type = req.body.type || 'link';
    let dataToEncode = prepareData(type, req.body);

    // Handle file upload if type is 'file'
    if (type === 'file') {
      if (!req.files || !req.files.file || !req.files.file[0]) {
        return res.status(400).send('No file uploaded');
      }
      // Convert file to base64 data URL
      const file = req.files.file[0];
      const mimeType = file.mimetype;
      const base64Data = file.buffer.toString('base64');
      dataToEncode = `data:${mimeType};base64,${base64Data}`;
    }

    if (!dataToEncode) return res.status(400).send('No data to encode');

    // Encrypt if needed
    const encryptPass = req.body.encrypt || '';
    if (encryptPass) {
      dataToEncode = encrypt(dataToEncode, encryptPass);
    }

    const fgColor = req.body.fgColor || '#000000';
    const bgColor = req.body.bgColor || '#ffffff';
    const label = req.body.label || '';
    const outputFormat = (req.body.outputFormat || 'png').toLowerCase();

    // Generate QR code as buffer or SVG string
    let qrBuffer;
    if (outputFormat === 'svg') {
      qrBuffer = await QRCode.toString(dataToEncode, { type: 'svg', color: { dark: fgColor, light: bgColor } });
    } else {
      qrBuffer = await QRCode.toBuffer(dataToEncode, { type: 'png', color: { dark: fgColor, light: bgColor }, errorCorrectionLevel: 'H', margin: 2, width: 300 });
    }

    // If label or logo is needed, draw on canvas or generate PDF accordingly
    if (outputFormat === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([300, 360]);
      const pngImage = await pdfDoc.embedPng(qrBuffer);

      page.drawImage(pngImage, {
        x: 0,
        y: 60,
        width: 300,
        height: 300,
      });

      if (label) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        page.drawText(label, {
          x: 150,
          y: 30,
          size: 18,
          font,
          color: rgb(0, 0, 0),
          xScale: 1,
          yScale: 1,
          maxWidth: 280,
          align: 'center',
          // PDF-lib doesn't support textAlign, center manually:
        });
      }

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="qr-code.pdf"');
      return res.send(Buffer.from(pdfBytes));
    }

    if (outputFormat === 'svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', 'attachment; filename="qr-code.svg"');
      return res.send(qrBuffer);
    }

    // PNG path (including logo and label on a canvas server-side would require extra libs, so send plain PNG)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="qr-code.png"');
    return res.send(qrBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Serve your index.html and static files from /public
// Place the above index.html inside a folder named 'public' next to this server.js

app.listen(port, () => {
  console.log(`QR Code generator server running on http://localhost:${port}`);
});
