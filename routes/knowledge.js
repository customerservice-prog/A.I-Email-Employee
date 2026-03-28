const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  uploadKBFile,
  listKBFilesForTenant,
  getKnowledgeFilePreview,
  toPublicKbFile,
} = require('../services/knowledge');
const { requireDatabase } = require('../middleware/database');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.pdf', '.csv', '.txt', '.md'].includes(ext)) {
      return cb(new Error('Only PDF, CSV, TXT, and MD files are allowed'));
    }
    const mime = String(file.mimetype || '').toLowerCase();
    const mimeOk =
      !mime ||
      mime === 'application/pdf' ||
      mime.startsWith('text/') ||
      mime === 'application/csv' ||
      mime === 'application/octet-stream';
    if (!mimeOk) {
      return cb(new Error('Disallowed Content-Type for this extension'));
    }
    cb(null, true);
  },
});

router.post('/upload', requireDatabase, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 'upload_error' },
        requestId: res.locals.requestId,
      });
    }
    next();
  });
}, async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { message: 'file field is required', code: 'validation' },
        requestId,
      });
    }
    const row = await uploadKBFile(req.file, tenantId);
    return res.status(201).json({
      success: true,
      data: { file: toPublicKbFile(row) },
      requestId,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { message: err.message || 'Upload failed', code: 'upload_failed' },
      requestId,
    });
  }
});

router.get('/files', requireDatabase, async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const files = await listKBFilesForTenant(tenantId);
    return res.json({
      success: true,
      data: { files: files.map(toPublicKbFile) },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to list knowledge files', code: 'kb_list_error' },
      requestId,
    });
  }
});

router.get('/files/:fileId/preview', requireDatabase, async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const fileId = parseInt(req.params.fileId, 10);
    if (Number.isNaN(fileId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid file id', code: 'validation' },
        requestId,
      });
    }
    const preview = await getKnowledgeFilePreview(tenantId, fileId);
    if (!preview) {
      return res.status(404).json({
        success: false,
        error: { message: 'File not found', code: 'not_found' },
        requestId,
      });
    }
    return res.json({ success: true, data: preview, requestId });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load preview', code: 'preview_error' },
      requestId,
    });
  }
});

module.exports = router;
