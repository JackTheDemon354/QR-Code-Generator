const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } }); // max 5MB

const PORT = process.env.PORT || 3000;

// Serve static frontend files (adjust if your index.html is elsewhere)
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

// Route: Generate QR code image (POST from frontend form)
app.post('/generate', upload.single('file'), async (req, res) => {
  try {
    const {
      type,
      text,
      wifiSsid,
      wifiEncryption,
      wifiPassword,
      paymentEmail,
      paymentAmount,
      label,
      encrypt,
    } = req.body;

    // Build QR data string depending on type
    let qrData = '';

    switch (type) {
      case 'link':
        qrData = text || ' ';
        break;

      case 'text':
        qrData = text || ' ';
        break;

      case 'wifi':
        const enc = wifiEncryption === 'NONE' ? 'nopass' : wifiEncryption.toUpperCase();
        qrData = `WIFI:T:${enc};S:${wifiSsid || ''};P:${wifiPassword || ''};;`;
        break;

      case 'payment':
        // Format PayPal.me URL in AUD
        let amt = paymentAmount && !isNaN(paymentAmount) && paymentAmount > 0 ? paymentAmount : '';
        const emailSanitized = (paymentEmail || '').toLowerCase().replace(/@|\./g, '');
        qrData = `https://www.paypal.me/${emailSanitized}${amt ? '/' + amt : ''}`;
        break;

      case 'multiLinks':
        // Expecting 'links' input as comma separated URLs from frontend form (or JSON string)
        let linksRaw = req.body.links || '';
        // Clean links: split by commas, trim, filter empty
        let links = Array.isArray(linksRaw) ? linksRaw : linksRaw.split(',').map(s => s.trim()).filter(Boolean);
        // Build JSON object
        const obj = {
          type: "multiLinks",
          links: links
        };
        // Encode JSON as base64 and build URL to multilinks page
        const jsonStr = JSON.stringify(obj);
        const b64 = Buffer.from(jsonStr).toString('base64');
        qrData = `${req.protocol}://${req.get('host')}/multilinks?data=${encodeURIComponent(b64)}`;
        break;

      case 'file':
        if (!req.file) return res.status(400).send('No file uploaded.');
        // For simplicity, we'll embed a data URL if file <5MB and type image or text
        // (Better: upload file somewhere and generate a URL)
        const mime = req.file.mimetype;
        if (!mime.startsWith('image/') && !mime.startsWith('text/')) {
          return res.status(400).send('Unsupported file type.');
        }
        const base64File = req.file.buffer.toString('base64');
        qrData = `data:${mime};base64,${base64File}`;
        break;

      default:
        qrData = ' ';
        break;
    }

    // Encrypt if needed (AES)
    const CryptoJS = require('crypto-js');
    if (encrypt && encrypt.trim()) {
      qrData = CryptoJS.AES.encrypt(qrData, encrypt.trim()).toString();
    }

    // Generate QR code image as PNG buffer
    const qrImageBuffer = await QRCode.toBuffer(qrData, {
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.set('Content-Type', 'image/png');
    res.send(qrImageBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Route: Multi-links page to display clickable links
app.get('/multilinks', (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).send('Missing data parameter.');

  try {
    const jsonStr = Buffer.from(data, 'base64').toString('utf8');
    const obj = JSON.parse(jsonStr);

    if (obj.type !== 'multiLinks' || !Array.isArray(obj.links)) {
      return res.status(400).send('Invalid multiLinks data');
    }

    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Multiple Links</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
          h1 { text-align: center; }
          ul { list-style: none; padding-left: 0; }
          li { margin: 10px 0; }
          a { text-decoration: none; color: #0077cc; font-size: 1.2em; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Multiple Links</h1>
        <ul>
    `;

    obj.links.forEach(link => {
      html += `<li><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></li>`;
    });

    html += `
        </ul>
      </body>
      </html>
    `;

    res.send(html);
  } catch (e) {
    res.status(400).send('Invalid data parameter');
  }
});

// Serve index.html from /public (you will put your HTML here)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
