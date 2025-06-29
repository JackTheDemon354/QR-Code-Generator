const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const cryptoJS = require('crypto-js');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

function encryptData(data, password) {
  if (!password || password.trim() === '') return data;
  return cryptoJS.AES.encrypt(data, password).toString();
}

function generateWiFiString(ssid, encryption, password) {
  if (!ssid) return '';
  const enc = encryption.toUpperCase() === 'NONE' ? 'nopass' : encryption.toUpperCase();
  return `WIFI:T:${enc};S:${ssid};P:${password || ''};;`;
}

app.post('/generate', upload.single('fileUpload'), async (req, res) => {
  try {
    const {
      type,
      text,
      multiLinksText,
      wifiSsid,
      wifiEncryption,
      wifiPassword,
      paymentEmail,
      paymentAmount,
      label,
      fgColor = '#000000',
      bgColor = '#ffffff',
      outputFormat = 'png',
      encryptionPassword,
    } = req.body;

    let qrData = '';

    switch (type) {
      case 'link':
        qrData = text || ' ';
        break;

      case 'multilinks':
        if (multiLinksText) {
          const lines = multiLinksText
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
          qrData = JSON.stringify(lines);
        } else {
          qrData = '[]';
        }
        break;

      case 'text':
        qrData = text || ' ';
        break;

      case 'wifi':
        qrData = generateWiFiString(wifiSsid, wifiEncryption, wifiPassword);
        break;

      case 'payment':
        if (!paymentEmail) {
          qrData = ' ';
        } else {
          const emailClean = paymentEmail.toLowerCase().replace(/@|\./g, '');
          const amt = paymentAmount && !isNaN(paymentAmount) && paymentAmount > 0 ? paymentAmount : '';
          qrData = `https://www.paypal.me/${emailClean}${amt ? '/' + amt : ''}`;
        }
        break;

      case 'file':
        if (!req.file) {
          return res.status(400).send('No file uploaded.');
        }
        // Encode file buffer to base64 string with MIME type
        const base64Data = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;
        qrData = `data:${mimeType};base64,${base64Data}`;
        break;

      default:
        qrData = ' ';
    }

    // Encrypt data if password given
    if (encryptionPassword && encryptionPassword.trim() !== '') {
      qrData = encryptData(qrData, encryptionPassword);
    }

    const qrOptions = {
      color: {
        dark: fgColor,
        light: bgColor
      },
      width: 300,
      margin: 1
    };

    if (outputFormat === 'png' || outputFormat === 'svg') {
      let qrCodeData;

      if (outputFormat === 'png') {
        qrCodeData = await QRCode.toDataURL(qrData, qrOptions);
      } else {
        qrCodeData = await QRCode.toString(qrData, { type: 'svg', color: qrOptions.color });
      }

      if (outputFormat === 'png') {
        const base64Data = qrCodeData.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64
