const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

function encrypt(text, password) {
  const cipher = crypto.createCipher("aes-256-cbc", password);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

app.post("/generate", upload.single("file"), async (req, res) => {
  const {
    type,
    text,
    multiLinks,
    wifiSsid,
    wifiEncryption,
    wifiPassword,
    paymentEmail,
    paymentAmount,
    fgColor,
    bgColor,
    outputFormat,
    label,
    encrypt,
  } = req.body;

  let qrData = "";

  if (type === "link") {
    qrData = text || "";
  } else if (type === "multilink") {
    const links = multiLinks?.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    qrData = links.join("\n");
  } else if (type === "text") {
    qrData = text || "";
  } else if (type === "wifi") {
    const enc = wifiEncryption === "NONE" ? "nopass" : wifiEncryption;
    qrData = `WIFI:T:${enc};S:${wifiSsid};P:${wifiPassword || ""};;`;
  } else if (type === "payment") {
    const email = (paymentEmail || "").toLowerCase().replace(/@|\./g, "");
    qrData = `https://www.paypal.me/${email}${paymentAmount ? "/" + paymentAmount : ""}`;
  } else if (type === "file" && req.file) {
    const fullUrl = req.protocol + "://" + req.get("host") + "/uploads/" + req.file.filename;
    qrData = fullUrl;
  }

  if (encrypt) {
    qrData = `https://your-site.com/decrypt?data=${encryptText(qrData, encrypt)}`;
  }

  try {
    const color = {
      dark: fgColor || "#000000",
      light: bgColor || "#FFFFFF",
    };

    if (outputFormat === "svg") {
      const svg = await QRCode.toString(qrData, { type: "svg", color });
      res.set("Content-Type", "image/svg+xml").send(svg);
    } else if (outputFormat === "pdf") {
      const tempPath = path.join(__dirname, "temp.png");
      await QRCode.toFile(tempPath, qrData, { color, width: 300 });

      const doc = new PDFDocument({ size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);
      doc.image(tempPath, 150, 150, { width: 300 });
      if (label) doc.text(label, 150, 470, { align: "center", width: 300 });
      doc.end();
    } else {
      res.set("Content-Type", "image/png");
      await QRCode.toFileStream(res, qrData, { color, width: 300 });
    }
  } catch (err) {
    console.error("QR generation error:", err);
    res.status(500).send("Failed to generate QR");
  }
});

app.get("/uploads/:filename", (req, res) => {
  const file = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).send("File not found");
});

app.listen(port, () => console.log(`QR Generator running on http://localhost:${port}`));

function encryptText(text, password) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}
