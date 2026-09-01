const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { saveAttachment } = require('../lib/db');

// Base64 inflates a file by ~33%, so 8MB raw stays comfortably under
// Mongo's 16MB-per-document cap on the attachments collection.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

router.post('/', async (req, res) => {
  try {
    const { filename, contentType, dataBase64 } = req.body;
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: 'filename and dataBase64 are required' });
    }
    const approxBytes = Math.floor((dataBase64.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({
        error: `File too large (${(approxBytes / 1024 / 1024).toFixed(1)}MB) — 8MB max per file`
      });
    }
    const id = crypto.randomUUID();
    await saveAttachment(id, {
      filename,
      contentType: contentType || 'application/octet-stream',
      size: approxBytes,
      dataBase64
    });
    res.status(201).json({ id, filename, contentType: contentType || 'application/octet-stream', size: approxBytes });
  } catch (err) {
    console.error('[attachments] upload failed:', err.message || err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
