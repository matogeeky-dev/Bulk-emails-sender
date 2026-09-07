const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const unzipper = require('unzipper');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ZIPS_DIR = path.join(DATA_DIR, 'image-zips');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 500MB - generous, but keeps ephemeral disk usage bounded
const MAX_FILES = 3000;

if (!fs.existsSync(ZIPS_DIR)) fs.mkdirSync(ZIPS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: ZIPS_DIR,
    filename: (req, file, cb) => cb(null, `upload-${crypto.randomUUID()}.zip`)
  }),
  limits: { fileSize: MAX_ZIP_BYTES }
});

router.post('/', upload.single('zip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No zip file uploaded (field name must be "zip")' });

  const uploadId = crypto.randomUUID();
  const extractDir = path.join(ZIPS_DIR, uploadId);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    const filenames = [];
    await fs
      .createReadStream(req.file.path)
      .pipe(unzipper.Parse())
      .on('entry', function (entry) {
        const ext = path.extname(entry.path).toLowerCase();
        const baseName = path.basename(entry.path);
        const isImage = entry.type === 'File' && IMAGE_EXTENSIONS.has(ext) && !baseName.startsWith('.');
        if (isImage && filenames.length < MAX_FILES) {
          filenames.push(baseName);
          entry.pipe(fs.createWriteStream(path.join(extractDir, baseName)));
        } else {
          entry.autodrain();
        }
      })
      .promise();

    fs.unlink(req.file.path, () => {}); // done with the raw zip, keep only extracted images

    if (!filenames.length) {
      fs.rm(extractDir, { recursive: true, force: true }, () => {});
      return res.status(400).json({ error: 'No image files found in that zip' });
    }
    if (filenames.length >= MAX_FILES) {
      return res.status(400).json({
        error: `Zip contains more than the ${MAX_FILES}-image limit. Split it into smaller batches.`
      });
    }

    res.status(201).json({ uploadId, fileCount: filenames.length, filenames });
  } catch (err) {
    console.error('[image-zips] extraction failed:', err.message || err);
    fs.unlink(req.file.path, () => {});
    fs.rm(extractDir, { recursive: true, force: true }, () => {});
    res.status(500).json({ error: 'Could not read that zip file: ' + String(err.message || err) });
  }
});

module.exports = router;
