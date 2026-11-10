const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('node:crypto');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME: process.env.AIRTABLE_TABLE_NAME || 'ManualCoding',
  CODER_A_TOKEN: process.env.CODER_A_TOKEN,
  CODER_B_TOKEN: process.env.CODER_B_TOKEN,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  CODER_A_NAME: process.env.CODER_A_NAME || 'Coder A',
  CODER_B_NAME: process.env.CODER_B_NAME || 'Coder B',
};

const DIMENSIONS = [
  'climate_action',
  'biodiversity_protection',
  'responsible_operations',
  'circular_practices',
  'renewable_energy',
  'community_support',
  'employee_wellbeing',
  'diversity_inclusion',
  'product_responsibility',
  'certification_transparency',
  'other_sustainability',
  'none',
];

const DIMENSION_LABELS = {
  climate_action: '🌡 Climate Action',
  biodiversity_protection: '🌿 Biodiversity Protection',
  responsible_operations: '⚙️ Responsible Management & Operations',
  circular_practices: '♻️ Circular Practices',
  renewable_energy: '⚡ Renewable Energy & Bioeconomy',
  community_support: '🤝 Community Support',
  employee_wellbeing: '💚 Employee Wellbeing',
  diversity_inclusion: '🌈 Diversity & Inclusion',
  product_responsibility: '📦 Product Responsibility',
  certification_transparency: '📋 Certification & Transparency',
  other_sustainability: '❓ General Sustainability Claim',
  none: '✕ None',
};

// ── Airtable helpers ─────────────────────────────────────────────────────────
const AT_BASE = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.AIRTABLE_TABLE_NAME)}`;
const atHeaders = () => ({ Authorization: `Bearer ${CONFIG.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' });

async function fetchAllRecords() {
  let records = [];
  let offset = null;
  do {
    const params = { pageSize: 100 };
    if (offset) params.offset = offset;
    const res = await axios.get(AT_BASE, { headers: atHeaders(), params });
    records = records.concat(res.data.records);
    offset = res.data.offset || null;
  } while (offset);
  return records;
}

async function updateRecord(recordId, fields) {
  await axios.patch(`${AT_BASE}/${recordId}`, { fields }, { headers: atHeaders() });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function matchesConfiguredToken(provided, configured) {
  if (typeof provided !== 'string' || provided.length < 16 || provided.length > 512 ||
      typeof configured !== 'string' || configured.length < 16) return false;
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const configuredHash = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(providedHash, configuredHash);
}

function resolveCoder(token) {
  if (matchesConfiguredToken(token, CONFIG.CODER_A_TOKEN))
    return { id: 'A', name: CONFIG.CODER_A_NAME };
  if (matchesConfiguredToken(token, CONFIG.CODER_B_TOKEN))
    return { id: 'B', name: CONFIG.CODER_B_NAME };
  if (matchesConfiguredToken(token, CONFIG.ADMIN_TOKEN))
    return { id: 'Test', name: 'Guest Tester' };
  return null;
}

function authMiddleware(req, res, next) {
  // Refuse missing credentials and never accept credentials in URLs.
  const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
  const coder = resolveCoder(match ? match[1] : null);
  if (!coder) return res.status(401).json({ error: 'Unauthorized.' });
  req.coder = coder;
  next();
}

// ── API Routes ────────────────────────────────────────────────────────────────

// Get all posts for this coder
app.get('/api/posts', authMiddleware, async (req, res) => {
  try {
    const records = await fetchAllRecords();
    const posts = records.map((r, idx) => {
      const f = r.fields;
      const imgField = f['image'] || f['Image'] || f['images'] || f['Images'] || f['Attachments'] || null;
      const imageUrls = imgField && Array.isArray(imgField) ? imgField.map(a => a.url) : [];

      // Per-coder coding data
      const coderKey = `Coder${req.coder.id}`;
      const parseDims = v => v && typeof v === 'string' ? v.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
      const imgDim    = parseDims(f[`${coderKey}_Image_Dimension`]);
      const capDim    = parseDims(f[`${coderKey}_Caption_Dimension`]);
      const ovDim     = parseDims(f[`${coderKey}_Overall_Dimension`]);
      const note      = f[`${coderKey}_note`] || '';

      const coded = imgDim.length > 0 || capDim.length > 0 || ovDim.length > 0;

      return {
        index: idx,
        recordId: r.id,
        caption: f['Translated Caption'] || f['translated_caption'] || f['Caption'] || f['caption'] || '',
        imageUrls,
        company: f['brandAttribution_strict'] || f['Company'] || f['company'] || f['Username'] || '',
        postDate: f['timestamp'] || f['Post Date'] || f['post_date'] || f['Date'] || '',
        coded,
        imgDim,
        capDim,
        ovDim,
        note,
      };
    });
    res.json({ posts, coderName: req.coder.name, coderId: req.coder.id });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch records from Airtable.' });
  }
});

// Accept only known labels and bounded text before writing to Airtable.
function validDimensions(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= DIMENSIONS.length &&
    value.every(d => typeof d === 'string' && DIMENSIONS.includes(d)) &&
    new Set(value).size === value.length &&
    !(value.includes('none') && value.length !== 1);
}

// Save coding for one post
app.post('/api/save', authMiddleware, async (req, res) => {
  try {
    const { recordId, imgDim, capDim, ovDim, note = '' } = req.body || {};
    if (typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{10,30}$/.test(recordId) ||
        !validDimensions(imgDim) || !validDimensions(capDim) || !validDimensions(ovDim) ||
        typeof note !== 'string' || note.length > 2000) {
      return res.status(400).json({ error: 'Invalid annotation data.' });
    }

    const coderKey = `Coder${req.coder.id}`;
    const fields = {
      [`${coderKey}_Image_Dimension`]:   (imgDim  || []).join(', '),
      [`${coderKey}_Caption_Dimension`]: (capDim  || []).join(', '),
      [`${coderKey}_Overall_Dimension`]: (ovDim   || []).join(', '),
      [`${coderKey}_note`]:              note    || '',
    };

    await updateRecord(recordId, fields);
    res.json({ ok: true });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Airtable save error:', JSON.stringify(detail));
    res.status(500).json({ error: 'Failed to save to Airtable.' });
  }
});

// ── Disagreements endpoint ────────────────────────────────────────────────────
app.get('/api/disagreements', authMiddleware, async (req, res) => {
  try {
    const records = await fetchAllRecords();
    const parseDims = v => v && typeof v === 'string' ? v.split(',').map(x=>x.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
    const hasReal = dims => dims.some(d => d !== 'none' && d !== '');

    const disagreements = [];
    records.forEach((r, idx) => {
      const f = r.fields;
      const aOv = parseDims(f['CoderA_Overall_Dimension']);
      const bOv = parseDims(f['CoderB_Overall_Dimension']);
      if (aOv.length === 0 && bOv.length === 0) return;
      if (hasReal(aOv) === hasReal(bOv)) return;

      const imgField = f['image'] || f['Image'] || f['images'] || f['Images'] || f['Attachments'] || null;
      const imageUrls = imgField && Array.isArray(imgField) ? imgField.map(a => a.url) : [];
      const coderKey = 'Coder' + req.coder.id;

      disagreements.push({
        index: idx,
        recordId: r.id,
        caption: f['Translated Caption'] || f['translated_caption'] || f['Caption'] || f['caption'] || '',
        imageUrls,
        company: f['brandAttribution_strict'] || f['Company'] || f['company'] || f['Username'] || '',
        postDate: f['timestamp'] || f['Post Date'] || f['post_date'] || f['Date'] || '',
        coderA_ov: aOv,
        coderB_ov: bOv,
        imgDim: parseDims(f[coderKey + '_Image_Dimension']),
        capDim: parseDims(f[coderKey + '_Caption_Dimension']),
        ovDim:  parseDims(f[coderKey + '_Overall_Dimension']),
        note:   f[coderKey + '_note'] || '',
      });
    });

    res.json({ disagreements, coderName: req.coder.name, coderId: req.coder.id, total: disagreements.length });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch disagreements.' });
  }
});

// ── Frontend ──────────────────────────────────────────────────────────────────
const DIMENSIONS_JSON = JSON.stringify(DIMENSIONS);
const DIMENSION_LABELS_JSON = JSON.stringify(DIMENSION_LABELS);

app.get('/', (req, res) => {
  if (req.query.token !== undefined) return res.redirect(302, '/');
  res.send(buildHTML());
});

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CSR Coding Tool</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --forest: #1a3a2a;
    --forest-mid: #2d5a3d;
    --forest-light: #4a8a5a;
    --gold: #c9a84c;
    --gold-light: #e8c97a;
    --cream: #f5f0e8;
    --cream-dark: #ede5d4;
    --ink: #1a1a18;
    --muted: #6b6b60;
    --white: #ffffff;
    --danger: #c0392b;
    --success: #27a96c;
    --shadow: 0 4px 24px rgba(26,58,42,0.10);
    --shadow-lg: 0 8px 48px rgba(26,58,42,0.16);
    --radius: 12px;
    --radius-sm: 8px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--forest);
    min-height: 100vh;
    color: var(--ink);
    overflow-x: hidden;
  }

  /* ── Loading / Auth screens ── */
  #authScreen, #loadingScreen {
    position: fixed; inset: 0;
    background: var(--forest);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
    flex-direction: column;
    gap: 20px;
  }
  #authScreen { display: none; }

  .center-card {
    background: var(--cream);
    border-radius: 20px;
    padding: 48px 56px;
    text-align: center;
    max-width: 480px;
    width: 90%;
    box-shadow: var(--shadow-lg);
  }
  .center-card h1 {
    font-family: 'DM Serif Display', serif;
    font-size: 2rem;
    color: var(--forest);
    margin-bottom: 8px;
  }
  .center-card p { color: var(--muted); font-size: 0.95rem; line-height: 1.6; }
  .center-card .error-msg { color: var(--danger); font-size: 0.9rem; margin-top: 12px; }

  .spinner {
    width: 40px; height: 40px;
    border: 3px solid rgba(201,168,76,0.3);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { color: var(--cream); font-size: 0.95rem; letter-spacing: 0.05em; }

  /* ── App Shell ── */
  #app { display: none; flex-direction: column; min-height: 100vh; }

  /* ── Header ── */
  header {
    background: var(--forest);
    border-bottom: 1px solid rgba(201,168,76,0.2);
    padding: 0 32px;
    height: 64px;
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(8px);
  }
  .header-left { display: flex; align-items: center; gap: 16px; }
  .logo {
    font-family: 'DM Serif Display', serif;
    font-size: 1.25rem;
    color: var(--gold);
    letter-spacing: 0.01em;
  }
  .logo span { color: var(--cream); font-size: 0.85rem; font-family: 'DM Sans', sans-serif; font-weight: 300; margin-left: 8px; }
  .coder-badge {
    background: rgba(201,168,76,0.15);
    border: 1px solid rgba(201,168,76,0.35);
    color: var(--gold-light);
    padding: 4px 14px;
    border-radius: 100px;
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.05em;
  }
  .progress-wrap {
    display: flex; align-items: center; gap: 12px;
  }
  .progress-label { color: var(--cream); font-size: 0.8rem; opacity: 0.7; }
  .progress-bar-outer {
    width: 160px; height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-bar-inner {
    height: 100%;
    background: linear-gradient(90deg, var(--forest-light), var(--gold));
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  /* ── Main content ── */
  main {
    flex: 1;
    background: var(--cream);
    display: flex;
    flex-direction: column;
  }

  /* ── Post meta bar ── */
  .post-meta {
    background: var(--forest-mid);
    padding: 10px 32px;
    display: flex; align-items: center; gap: 20px;
  }
  .post-meta-item { color: rgba(245,240,232,0.7); font-size: 0.8rem; }
  .post-meta-item strong { color: var(--gold-light); }
  .coded-badge {
    margin-left: auto;
    background: rgba(39,169,108,0.2);
    border: 1px solid rgba(39,169,108,0.4);
    color: #7de0b0;
    padding: 3px 12px; border-radius: 100px; font-size: 0.75rem;
    display: none;
  }
  .coded-badge.visible { display: inline-flex; align-items: center; gap: 5px; }

  /* ── Two-pane layout ── */
  .panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex: 1;
    min-height: 0;
  }

  /* ── Image pane ── */
  .image-pane {
    background: #0f1f17;
    display: flex; align-items: center; justify-content: center;
    position: relative;
    min-height: 400px;
    overflow: hidden;
  }
  .image-pane img {
    max-width: 100%; max-height: 520px;
    object-fit: contain;
    display: block;
    border-radius: 4px;
  }
  .no-image {
    color: rgba(255,255,255,0.2);
    font-size: 0.9rem;
    text-align: center;
  }
  .image-nav {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px;
  }
  .image-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(255,255,255,0.3);
    cursor: pointer; transition: background 0.2s;
  }
  .image-dot.active { background: var(--gold); }
  .img-arrow {
    position: absolute; top: 50%; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); border: none; color: white;
    width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
    font-size: 1rem; display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s;
  }
  .image-pane:hover .img-arrow { opacity: 1; }
  .img-arrow.left { left: 12px; }
  .img-arrow.right { right: 12px; }

  /* ── Caption pane ── */
  .caption-pane {
    background: var(--cream);
    padding: 32px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 24px;
    border-left: 1px solid var(--cream-dark);
  }
  .caption-pane h2 {
    font-family: 'DM Serif Display', serif;
    font-size: 1.15rem;
    color: var(--forest);
    padding-bottom: 12px;
    border-bottom: 2px solid var(--cream-dark);
  }
  .caption-text {
    font-size: 0.9rem;
    line-height: 1.75;
    color: #2a2a25;
    max-height: 180px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .caption-text::-webkit-scrollbar { width: 4px; }
  .caption-text::-webkit-scrollbar-track { background: var(--cream-dark); border-radius: 2px; }
  .caption-text::-webkit-scrollbar-thumb { background: var(--forest-light); border-radius: 2px; }

  /* ── Question block ── */
  .question-block {
    background: var(--white);
    border-radius: var(--radius);
    padding: 24px;
    box-shadow: 0 2px 12px rgba(26,58,42,0.06);
    border: 1px solid var(--cream-dark);
  }
  .question-block h3 {
    font-family: 'DM Serif Display', serif;
    font-size: 1rem;
    color: var(--forest);
    margin-bottom: 16px;
    line-height: 1.4;
  }
  .classif-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }
  .classif-col {
    display: flex; flex-direction: column; gap: 8px;
  }
  .classif-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 4px;
    border-bottom: 2px solid;
  }
  .classif-label.img-label { border-color: #4a8a5a; color: #2d5a3d; }
  .classif-label.cap-label { border-color: #c9a84c; color: #9a7a2a; }
  .classif-label.ov-label  { border-color: #5a7aa8; color: #2d4a78; }

  .dim-options { display: flex; flex-direction: column; gap: 4px; }
  .dim-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 0.78rem;
    color: var(--ink);
    user-select: none;
    border: 1px solid transparent;
  }
  .dim-item:hover { background: var(--cream); }
  .dim-item input[type=checkbox] { display: none; }
  .dim-check {
    width: 16px; height: 16px; min-width: 16px;
    border-radius: 4px;
    border: 1.5px solid #ccc;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
    font-size: 10px;
    color: white;
  }
  .dim-item.checked .dim-check { background: var(--forest-mid); border-color: var(--forest-mid); }
  .dim-item.checked .dim-check::after { content: '✓'; }
  .dim-item.checked { background: rgba(45,90,61,0.07); border-color: rgba(45,90,61,0.15); }

  /* none item style */
  .dim-item.none-item.checked .dim-check { background: var(--danger); border-color: var(--danger); }
  .dim-item.none-item.checked { background: rgba(192,57,43,0.06); border-color: rgba(192,57,43,0.15); }

  /* ── Note field ── */
  .note-wrap {
    display: flex; flex-direction: column; gap: 8px;
  }
  .note-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  textarea#noteField {
    width: 100%;
    border: 1px solid var(--cream-dark);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.85rem;
    color: var(--ink);
    background: var(--white);
    resize: vertical;
    min-height: 72px;
    transition: border-color 0.2s;
    outline: none;
  }
  textarea#noteField:focus { border-color: var(--forest-mid); }

  /* ── Navigation bar ── */
  .nav-bar {
    background: var(--white);
    border-top: 1px solid var(--cream-dark);
    padding: 16px 32px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px;
  }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 24px;
    border-radius: 100px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    letter-spacing: 0.02em;
  }
  .btn-ghost {
    background: transparent;
    border: 1.5px solid var(--cream-dark);
    color: var(--muted);
  }
  .btn-ghost:hover:not(:disabled) { border-color: var(--forest-mid); color: var(--forest); }
  .btn-primary {
    background: var(--forest);
    color: var(--cream);
  }
  .btn-primary:hover:not(:disabled) { background: var(--forest-mid); transform: translateY(-1px); box-shadow: var(--shadow); }
  .btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none !important; }

  .save-status {
    font-size: 0.8rem;
    color: var(--muted);
    min-width: 120px;
    text-align: center;
    transition: color 0.3s;
  }
  .save-status.saving { color: var(--gold); }
  .save-status.saved  { color: var(--success); }
  .save-status.error  { color: var(--danger); }

  .validation-msg {
    font-size: 0.78rem;
    color: var(--danger);
    text-align: center;
    min-height: 18px;
  }

  /* ── Done screen ── */
  #doneScreen {
    display: none;
    flex: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 20px;
    padding: 48px;
    background: var(--cream);
    text-align: center;
  }
  #doneScreen .done-icon { font-size: 4rem; }
  #doneScreen h2 {
    font-family: 'DM Serif Display', serif;
    font-size: 2rem;
    color: var(--forest);
  }
  #doneScreen p { color: var(--muted); max-width: 400px; line-height: 1.7; }

  /* ── Scrollbar ── */
  .caption-pane::-webkit-scrollbar { width: 5px; }
  .caption-pane::-webkit-scrollbar-track { background: var(--cream-dark); }
  .caption-pane::-webkit-scrollbar-thumb { background: #bbb; border-radius: 2px; }

  .btn-disagree {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 16px; border-radius: 100px;
    background: rgba(201,168,76,0.12);
    border: 1.5px solid rgba(201,168,76,0.4);
    color: var(--gold-light);
    font-family: 'DM Sans', sans-serif;
    font-size: 0.82rem; font-weight: 500;
    cursor: pointer; transition: all 0.2s;
    letter-spacing: 0.03em;
  }
  .btn-disagree:hover { background: rgba(201,168,76,0.22); border-color: var(--gold); }
  .disagree-count {
    background: var(--gold); color: var(--forest);
    border-radius: 100px; padding: 1px 8px;
    font-size: 0.75rem; font-weight: 700;
    display: none;
  }
  .disagree-count.visible { display: inline; }

  /* ── Disagreements overlay ── */
  #disagreeOverlay {
    display: none; position: fixed; inset: 0; z-index: 200;
    background: var(--forest);
    flex-direction: column;
  }
  #disagreeOverlay.open { display: flex; }
  .disagree-header {
    background: var(--forest);
    border-bottom: 1px solid rgba(201,168,76,0.2);
    padding: 0 32px; height: 64px;
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0;
  }
  .disagree-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--gold); }
  .disagree-subtitle { color: rgba(245,240,232,0.6); font-size: 0.85rem; margin-top: 2px; }
  .btn-close-disagree {
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
    color: var(--cream); padding: 8px 20px; border-radius: 100px;
    font-family: 'DM Sans', sans-serif; font-size: 0.85rem; cursor: pointer;
    transition: all 0.2s;
  }
  .btn-close-disagree:hover { background: rgba(255,255,255,0.15); }
  .disagree-body {
    flex: 1; background: var(--cream); display: flex; flex-direction: column; overflow: hidden;
  }
  .disagree-meta {
    background: var(--forest-mid); padding: 10px 32px;
    display: flex; align-items: center; gap: 20px; flex-shrink: 0;
  }
  .disagree-panes {
    display: grid; grid-template-columns: 1fr 1fr; flex: 1; min-height: 0; overflow: hidden;
  }
  .disagree-caption-pane {
    background: var(--cream); padding: 24px 28px;
    overflow-y: auto; display: flex; flex-direction: column; gap: 18px;
    border-left: 1px solid var(--cream-dark);
  }
  /* Compared answers banner */
  .compared-banner {
    background: var(--white); border-radius: var(--radius);
    border: 1px solid var(--cream-dark);
    padding: 14px 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  }
  .compared-col h4 { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; margin-bottom: 6px; }
  .compared-col.coder-a h4 { color: var(--forest); }
  .compared-col.coder-b h4 { color: #2d4a78; }
  .dim-pill {
    display: inline-block; padding: 3px 10px; border-radius: 100px;
    font-size: 0.75rem; font-weight: 500; margin: 2px 2px 2px 0;
  }
  .dim-pill.has-dim { background: rgba(45,90,61,0.12); color: var(--forest); border: 1px solid rgba(45,90,61,0.2); }
  .dim-pill.no-dim  { background: rgba(192,57,43,0.08); color: var(--danger); border: 1px solid rgba(192,57,43,0.15); }
  .disagree-nav {
    background: var(--white); border-top: 1px solid var(--cream-dark);
    padding: 14px 32px; display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0;
  }
  #dEmptyState {
    flex: 1; display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 16px; text-align: center; padding: 40px;
    background: var(--cream);
  }
  #dEmptyState .done-icon { font-size: 3rem; }
  #dEmptyState h3 { font-family: 'DM Serif Display', serif; font-size: 1.6rem; color: var(--forest); }
  #dEmptyState p { color: var(--muted); max-width: 360px; line-height: 1.7; }

  @media (max-width: 900px) {
    .panes { grid-template-columns: 1fr; }
    .classif-grid { grid-template-columns: 1fr; }
    header { padding: 0 16px; }
    .caption-pane { padding: 20px; }
    .nav-bar { padding: 12px 16px; flex-wrap: wrap; }
    .progress-wrap { display: none; }
  }
</style>
</head>
<body>

<!-- Loading -->
<div id="loadingScreen">
  <div class="spinner"></div>
  <div class="loading-text">Loading posts…</div>
</div>

<!-- Auth error -->
<div id="authScreen">
  <div class="center-card">
    <h1>🌲 CSR Coder</h1>
    <p>Enter the private access token supplied by your research team. It is kept only in this browser tab's memory.</p>
    <form id="loginForm" onsubmit="authenticate(event)" style="display:grid;gap:12px;margin-top:20px;text-align:left;">
      <label for="accessToken">Access token</label>
      <input id="accessToken" type="password" autocomplete="off" required placeholder="Access token"
        style="width:100%;padding:12px;border:1px solid #ccc;border-radius:6px;" />
      <button type="submit" class="btn btn-primary">Unlock coding interface</button>
    </form>
    <p class="error-msg" id="authError"></p>
  </div>
</div>

<!-- Disagreements Overlay -->
<div id="disagreeOverlay">
  <div class="disagree-header">
    <div>
      <div class="disagree-title">⚡ Disagreement Review</div>
      <div class="disagree-subtitle" id="dSubtitle">Loading…</div>
    </div>
    <button class="btn-close-disagree" onclick="closeDisagreements()">← Back to Coding</button>
  </div>

  <!-- Empty state -->
  <div id="dEmptyState" style="display:none">
    <div class="done-icon">🤝</div>
    <h3>No Disagreements</h3>
    <p>Both coders agree on all coded posts, or neither coder has coded the Overall dimension yet for any post.</p>
  </div>

  <!-- Active review body -->
  <div class="disagree-body" id="dBody">
    <div class="disagree-meta">
      <div class="post-meta-item">Post <strong id="dMetaIndex">—</strong></div>
      <div class="post-meta-item">Company: <strong id="dMetaCompany">—</strong></div>
      <div class="post-meta-item">Date: <strong id="dMetaDate">—</strong></div>
      <div class="post-meta-item">Disagreement <strong id="dDisagreeNum">—</strong></div>
    </div>

    <div class="disagree-panes">
      <!-- Image pane (reuse styles) -->
      <div class="image-pane" id="dImagePane">
        <button class="img-arrow left" id="dImgPrev" onclick="dChangeImg(-1)">&#8249;</button>
        <div id="dImageContainer"><div class="no-image">No image</div></div>
        <button class="img-arrow right" id="dImgNext" onclick="dChangeImg(1)">&#8250;</button>
        <div class="image-nav" id="dImageDots"></div>
      </div>

      <!-- Right pane -->
      <div class="disagree-caption-pane">
        <!-- Both coders comparison -->
        <div class="compared-banner">
          <div class="compared-col coder-a">
            <h4>Coder A — Overall</h4>
            <div id="dCoderADims"></div>
          </div>
          <div class="compared-col coder-b">
            <h4>Coder B — Overall</h4>
            <div id="dCoderBDims"></div>
          </div>
        </div>

        <div>
          <h2 style="font-family:'DM Serif Display',serif;font-size:1.1rem;color:var(--forest);padding-bottom:10px;border-bottom:2px solid var(--cream-dark)">📝 Caption</h2>
          <p class="caption-text" id="dCaptionText">—</p>
        </div>

        <div class="question-block">
          <h3 style="font-family:'DM Serif Display',serif;font-size:0.95rem;color:var(--forest);margin-bottom:14px">
            Update your coding for this post:
            <small style="font-weight:300;font-size:0.82rem;color:var(--muted);display:block;margin-top:4px">Changes save when you click Next or resolve.</small>
          </h3>
          <div class="classif-grid">
            <div class="classif-col">
              <div class="classif-label img-label">🖼 Image Only</div>
              <div class="dim-options" id="dImgDims"></div>
            </div>
            <div class="classif-col">
              <div class="classif-label cap-label">💬 Caption Only</div>
              <div class="dim-options" id="dCapDims"></div>
            </div>
            <div class="classif-col">
              <div class="classif-label ov-label">📊 Image + Caption</div>
              <div class="dim-options" id="dOvDims"></div>
            </div>
          </div>
        </div>

        <div class="note-wrap">
          <div class="note-label">📌 Note (optional)</div>
          <textarea id="dNoteField" style="width:100%;border:1px solid var(--cream-dark);border-radius:8px;padding:10px 14px;font-family:'DM Sans',sans-serif;font-size:0.85rem;resize:vertical;min-height:60px;outline:none;" placeholder="Any notes about this disagreement…"></textarea>
        </div>
      </div>
    </div>

    <div class="disagree-nav">
      <button class="btn btn-ghost" id="dBtnBack" onclick="dNavigate(-1)" disabled>← Previous</button>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div class="validation-msg" id="dValidationMsg"></div>
        <div class="save-status" id="dSaveStatus"></div>
      </div>
      <button class="btn btn-primary" id="dBtnNext" onclick="dNavigate(1)">Save & Next →</button>
    </div>
  </div>
</div>

<!-- Main App -->
<div id="app">
  <!-- Header -->
  <header>
    <div class="header-left">
      <div class="logo">CSR Coder <span>Swedish Forestry Study</span></div>
      <div class="coder-badge" id="coderBadge"></div>
    </div>
    <button class="btn-disagree" id="btnDisagree" onclick="openDisagreements()">⚡ Disagreements <span id="disagreeCount" class="disagree-count"></span></button>
    <div class="progress-wrap">
      <span class="progress-label" id="progressLabel">0 / 0 coded</span>
      <div class="progress-bar-outer">
        <div class="progress-bar-inner" id="progressBar" style="width:0%"></div>
      </div>
    </div>
  </header>

  <!-- Post meta -->
  <div class="post-meta">
    <div class="post-meta-item">Post <strong id="metaIndex">—</strong></div>
    <div class="post-meta-item">Company: <strong id="metaCompany">—</strong></div>
    <div class="post-meta-item">Date: <strong id="metaDate">—</strong></div>
    <div class="coded-badge" id="codedBadge">✓ Coded</div>
  </div>

  <!-- Two-pane -->
  <div class="panes">
    <!-- Image -->
    <div class="image-pane" id="imagePaneEl">
      <button class="img-arrow left" id="imgPrev" onclick="changeImg(-1)">‹</button>
      <div id="imageContainer">
        <div class="no-image">No image available</div>
      </div>
      <button class="img-arrow right" id="imgNext" onclick="changeImg(1)">›</button>
      <div class="image-nav" id="imageDots"></div>
    </div>

    <!-- Caption + Classifications -->
    <div class="caption-pane">
      <div>
        <h2>📝 Translated Caption</h2>
        <p class="caption-text" id="captionText">—</p>
      </div>

      <div class="question-block">
        <h3>Does this post communicate <strong>CSR / Sustainability</strong>?<br>
          <small style="font-weight:300;font-size:0.85rem;color:var(--muted)">Select all applicable dimensions for each channel below.</small>
        </h3>

        <div class="classif-grid">
          <!-- Image Only -->
          <div class="classif-col">
            <div class="classif-label img-label">🖼 Image Only</div>
            <div class="dim-options" id="imgDims"></div>
          </div>
          <!-- Caption Only -->
          <div class="classif-col">
            <div class="classif-label cap-label">💬 Caption Only</div>
            <div class="dim-options" id="capDims"></div>
          </div>
          <!-- Both -->
          <div class="classif-col">
            <div class="classif-label ov-label">📊 Image + Caption</div>
            <div class="dim-options" id="ovDims"></div>
          </div>
        </div>
      </div>

      <!-- Note -->
      <div class="note-wrap">
        <div class="note-label">📌 Note (optional)</div>
        <textarea id="noteField" placeholder="Any observations about this post…"></textarea>
      </div>
    </div>
  </div>

  <!-- Done screen (inside app, replaces panes) -->
  <div id="doneScreen">
    <div class="done-icon">🌲</div>
    <h2>All Done!</h2>
    <p>You've coded all <strong id="doneTotal"></strong> posts. Thank you for your contribution to this research.</p>
  </div>

  <!-- Nav bar -->
  <div class="nav-bar">
    <button class="btn btn-ghost" id="btnBack" onclick="navigate(-1)" disabled>← Back</button>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div class="validation-msg" id="validationMsg"></div>
      <div class="save-status" id="saveStatus"></div>
    </div>
    <button class="btn btn-primary" id="btnNext" onclick="navigate(1)">Save & Next →</button>
  </div>
</div>

<script>
let TOKEN = '';
const DIMENSIONS = ${DIMENSIONS_JSON};
const DIMENSION_LABELS = ${DIMENSION_LABELS_JSON};

let posts = [];
let currentIdx = 0;
let coderName = '';
let coderId = '';

// Per-post draft state
let draft = { imgDim: [], capDim: [], ovDim: [], note: '' };
let currentImgIdx = 0;

// ── Init ──────────────────────────────────────────────────────────────────────
async function authenticate(event) {
  event.preventDefault();
  const input = document.getElementById('accessToken');
  TOKEN = input.value.trim();
  input.value = '';
  if (!TOKEN) { showAuth('Access token required.'); return; }
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'flex';
  await init();
}

async function init() {
  if (!TOKEN) { showAuth('Enter your access token to continue.'); return; }

  try {
    const res = await fetch('/api/posts', { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (res.status === 401) {
      const d = await res.json();
      TOKEN = '';
      showAuth(d.error || 'Invalid token.');
      return;
    }
    const data = await res.json();
    posts = data.posts;
    coderName = data.coderName;
    coderId = data.coderId;

    document.getElementById('coderBadge').textContent = coderName;
    buildDimLists();
    buildDDisagreeDimLists();

    // Resume from first uncoded post
    const firstUncoded = posts.findIndex(p => !p.coded);
    currentIdx = firstUncoded === -1 ? posts.length - 1 : firstUncoded;

    document.getElementById('loadingScreen').style.display = 'none';

    if (posts.length === 0) {
      showAuth('No posts found in the table.');
      return;
    }

    document.getElementById('app').style.display = 'flex';
    renderPost(currentIdx);
  } catch (err) {
    showAuth('Could not load posts. Check your token or server connection.');
  }
}

function showAuth(msg) {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('authError').textContent = msg;
}

// ── Build dimension checkboxes ────────────────────────────────────────────────
function buildDimLists() {
  ['imgDims', 'capDims', 'ovDims'].forEach(containerId => {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    DIMENSIONS.forEach(dim => {
      const item = document.createElement('label');
      item.className = 'dim-item' + (dim === 'none' ? ' none-item' : '');
      item.dataset.dim = dim;
      item.innerHTML = \`
        <input type="checkbox" value="\${dim}" />
        <span class="dim-check"></span>
        <span>\${DIMENSION_LABELS[dim]}</span>
      \`;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        toggleDim(containerId, dim);
      });
      el.appendChild(item);
    });
  });
}

function toggleDim(containerId, dim) {
  const key = containerId === 'imgDims' ? 'imgDim' : containerId === 'capDims' ? 'capDim' : 'ovDim';
  let arr = draft[key];

  if (dim === 'none') {
    // Selecting "none" clears all others
    draft[key] = arr.includes('none') ? [] : ['none'];
  } else {
    // Selecting a real dimension clears "none"
    if (arr.includes(dim)) {
      draft[key] = arr.filter(d => d !== dim);
    } else {
      draft[key] = arr.filter(d => d !== 'none').concat(dim);
    }
  }
  updateDimUI(containerId, draft[key]);
  document.getElementById('validationMsg').textContent = '';
}

function updateDimUI(containerId, selected) {
  const el = document.getElementById(containerId);
  el.querySelectorAll('.dim-item').forEach(item => {
    const dim = item.dataset.dim;
    item.classList.toggle('checked', selected.includes(dim));
  });
}

// ── Render post ────────────────────────────────────────────────────────────────
function renderPost(idx) {
  if (idx >= posts.length) {
    showDoneScreen();
    return;
  }

  const post = posts[idx];
  currentImgIdx = 0;

  // Meta
  document.getElementById('metaIndex').textContent = (idx + 1) + ' of ' + posts.length;
  document.getElementById('metaCompany').textContent = post.company || '—';
  const _d = post.postDate ? new Date(post.postDate) : null;
  document.getElementById('metaDate').textContent = _d && !isNaN(_d) ? _d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : (post.postDate || '—');

  const codedBadge = document.getElementById('codedBadge');
  codedBadge.classList.toggle('visible', post.coded);

  // Caption
  document.getElementById('captionText').textContent = post.caption || '(No caption)';

  // Image
  renderImages(post.imageUrls);

  // Load existing coding or reset
  draft = {
    imgDim: Array.isArray(post.imgDim) ? [...post.imgDim] : [],
    capDim: Array.isArray(post.capDim) ? [...post.capDim] : [],
    ovDim:  Array.isArray(post.ovDim)  ? [...post.ovDim]  : [],
    note: post.note || '',
  };
  updateDimUI('imgDims', draft.imgDim);
  updateDimUI('capDims', draft.capDim);
  updateDimUI('ovDims',  draft.ovDim);
  document.getElementById('noteField').value = draft.note;
  document.getElementById('validationMsg').textContent = '';
  document.getElementById('saveStatus').textContent = '';

  // Buttons
  document.getElementById('btnBack').disabled = idx === 0;
  document.getElementById('btnNext').textContent = idx === posts.length - 1 ? 'Save & Finish ✓' : 'Save & Next →';

  updateProgress();
}

function renderImages(urls) {
  const container = document.getElementById('imageContainer');
  const dots = document.getElementById('imageDots');

  if (!urls || urls.length === 0) {
    container.innerHTML = '<div class="no-image">No image available</div>';
    dots.innerHTML = '';
    return;
  }

  container.innerHTML = \`<img id="mainImg" src="\${urls[0]}" alt="Post image" />\`;
  document.getElementById('imgPrev').style.display = urls.length > 1 ? 'flex' : 'none';
  document.getElementById('imgNext').style.display = urls.length > 1 ? 'flex' : 'none';

  dots.innerHTML = '';
  urls.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'image-dot' + (i === 0 ? ' active' : '');
    dot.onclick = () => goToImg(i);
    dots.appendChild(dot);
  });
}

function changeImg(dir) {
  const urls = posts[currentIdx].imageUrls;
  if (!urls || urls.length === 0) return;
  currentImgIdx = (currentImgIdx + dir + urls.length) % urls.length;
  goToImg(currentImgIdx);
}

function goToImg(i) {
  const urls = posts[currentIdx].imageUrls;
  currentImgIdx = i;
  const img = document.getElementById('mainImg');
  if (img) img.src = urls[i];
  document.querySelectorAll('.image-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
}

// ── Progress ──────────────────────────────────────────────────────────────────
function updateProgress() {
  const coded = posts.filter(p => p.coded).length;
  const pct = posts.length ? (coded / posts.length) * 100 : 0;
  document.getElementById('progressLabel').textContent = coded + ' / ' + posts.length + ' coded';
  document.getElementById('progressBar').style.width = pct + '%';
}

// ── Navigate ──────────────────────────────────────────────────────────────────
async function navigate(dir) {
  if (dir === 1) {
    // Validate: all three classifications must have at least one selection
    if (draft.imgDim.length === 0 || draft.capDim.length === 0 || draft.ovDim.length === 0) {
      document.getElementById('validationMsg').textContent =
        '⚠ Please select at least one dimension (or "None") for all three classification columns.';
      return;
    }
    await saveCurrentPost();
  }

  const newIdx = currentIdx + dir;
  if (newIdx < 0 || newIdx > posts.length) return;
  currentIdx = newIdx;
  renderPost(currentIdx);
  window.scrollTo(0, 0);
}

async function saveCurrentPost() {
  const post = posts[currentIdx];
  draft.note = document.getElementById('noteField').value;

  const statusEl = document.getElementById('saveStatus');
  statusEl.className = 'save-status saving';
  statusEl.textContent = 'Saving…';

  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({
        recordId: post.recordId,
        imgDim: draft.imgDim,
        capDim: draft.capDim,
        ovDim:  draft.ovDim,
        note:   draft.note,
      }),
    });

    if (!res.ok) throw new Error('Save failed');

    // Update local state
    posts[currentIdx].coded  = true;
    posts[currentIdx].imgDim = [...draft.imgDim];
    posts[currentIdx].capDim = [...draft.capDim];
    posts[currentIdx].ovDim  = [...draft.ovDim];
    posts[currentIdx].note   = draft.note;

    document.getElementById('codedBadge').classList.add('visible');
    statusEl.className = 'save-status saved';
    statusEl.textContent = '✓ Saved to Airtable';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);

    updateProgress();
  } catch (err) {
    statusEl.className = 'save-status error';
    statusEl.textContent = '✗ Save failed — try again';
    throw err;
  }
}

function showDoneScreen() {
  document.querySelector('.panes').style.display = 'none';
  document.querySelector('.post-meta').style.display = 'none';
  document.getElementById('doneScreen').style.display = 'flex';
  document.getElementById('doneTotal').textContent = posts.length;
  document.querySelector('.nav-bar').style.display = 'none';
}


// ── Disagreements ─────────────────────────────────────────────────────────────
let disagPosts = [];
let disagIdx   = 0;
let dDraft     = { imgDim:[], capDim:[], ovDim:[], note:'' };
let dImgIdx    = 0;

async function openDisagreements() {
  document.getElementById('disagreeOverlay').classList.add('open');
  document.getElementById('dSubtitle').textContent = 'Loading…';
  document.getElementById('dBody').style.display = 'flex';
  document.getElementById('dBody').style.flexDirection = 'column';
  document.getElementById('dEmptyState').style.display = 'none';

  try {
    const res = await fetch('/api/disagreements', { headers: { Authorization: 'Bearer ' + TOKEN } });
    const data = await res.json();
    disagPosts = data.disagreements || [];

    if (disagPosts.length === 0) {
      document.getElementById('dBody').style.display = 'none';
      document.getElementById('dEmptyState').style.display = 'flex';
      document.getElementById('dSubtitle').textContent = 'No disagreements found';
      return;
    }

    disagIdx = 0;
    document.getElementById('dSubtitle').textContent = disagPosts.length + ' disagreement(s) to review';
    updateDisagreeCount(disagPosts.length);
    dRenderPost(0);
  } catch(e) {
    document.getElementById('dSubtitle').textContent = 'Failed to load disagreements';
  }
}

function closeDisagreements() {
  document.getElementById('disagreeOverlay').classList.remove('open');
}

function updateDisagreeCount(n) {
  const el = document.getElementById('disagreeCount');
  if (n > 0) { el.textContent = n; el.classList.add('visible'); }
  else { el.classList.remove('visible'); }
}

function dRenderPost(idx) {
  const post = disagPosts[idx];
  dImgIdx = 0;

  // Meta
  document.getElementById('dMetaIndex').textContent = 'Post #' + (post.index + 1);
  document.getElementById('dMetaCompany').textContent = post.company || '—';
  document.getElementById('dDisagreeNum').textContent = (idx+1) + ' of ' + disagPosts.length;
  const _d = post.postDate ? new Date(post.postDate) : null;
  document.getElementById('dMetaDate').textContent = _d && !isNaN(_d)
    ? _d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
    : (post.postDate || '—');

  // Caption
  document.getElementById('dCaptionText').textContent = post.caption || '(No caption)';

  // Images
  dRenderImages(post.imageUrls);

  // Compared answers
  function renderPills(dims, containerId) {
    const el = document.getElementById(containerId);
    if (!dims || dims.length === 0) {
      el.innerHTML = '<span class="dim-pill no-dim">None / Not coded</span>';
      return;
    }
    el.innerHTML = dims.map(d => {
      const isNone = d === 'none';
      const label = DIMENSION_LABELS[d] || d;
      return '<span class="dim-pill ' + (isNone ? 'no-dim' : 'has-dim') + '">' + label + '</span>';
    }).join('');
  }
  renderPills(post.coderA_ov, 'dCoderADims');
  renderPills(post.coderB_ov, 'dCoderBDims');

  // Load this coder's draft
  dDraft = {
    imgDim: Array.isArray(post.imgDim) ? [...post.imgDim] : [],
    capDim: Array.isArray(post.capDim) ? [...post.capDim] : [],
    ovDim:  Array.isArray(post.ovDim)  ? [...post.ovDim]  : [],
    note: post.note || '',
  };
  dUpdateAllDimUI();
  document.getElementById('dNoteField').value = dDraft.note;
  document.getElementById('dValidationMsg').textContent = '';
  document.getElementById('dSaveStatus').textContent = '';

  // Nav buttons
  document.getElementById('dBtnBack').disabled = idx === 0;
  document.getElementById('dBtnNext').textContent = idx === disagPosts.length - 1 ? 'Save & Finish ✓' : 'Save & Next →';
}

function dRenderImages(urls) {
  const container = document.getElementById('dImageContainer');
  const dots = document.getElementById('dImageDots');
  if (!urls || urls.length === 0) {
    container.innerHTML = '<div class="no-image">No image</div>';
    dots.innerHTML = ''; return;
  }
  container.innerHTML = '<img id="dMainImg" src="' + urls[0] + '" style="max-width:100%;max-height:500px;object-fit:contain;display:block;border-radius:4px;" />';
  document.getElementById('dImgPrev').style.display = urls.length > 1 ? 'flex' : 'none';
  document.getElementById('dImgNext').style.display = urls.length > 1 ? 'flex' : 'none';
  dots.innerHTML = urls.map((_,i) =>
    '<div class="image-dot' + (i===0?' active':'') + '" onclick="dGoToImg(' + i + ')"></div>'
  ).join('');
}

function dChangeImg(dir) {
  const urls = disagPosts[disagIdx].imageUrls;
  if (!urls || urls.length === 0) return;
  dImgIdx = (dImgIdx + dir + urls.length) % urls.length;
  dGoToImg(dImgIdx);
}

function dGoToImg(i) {
  const urls = disagPosts[disagIdx].imageUrls;
  dImgIdx = i;
  const img = document.getElementById('dMainImg');
  if (img) img.src = urls[i];
  document.querySelectorAll('#dImageDots .image-dot').forEach((d,idx) => d.classList.toggle('active', idx===i));
}

// Build dim lists for disagree panel (only once)
function buildDDisagreeDimLists() {
  ['dImgDims','dCapDims','dOvDims'].forEach(containerId => {
    const el = document.getElementById(containerId);
    if (!el || el.children.length > 0) return;
    DIMENSIONS.forEach(dim => {
      const item = document.createElement('label');
      item.className = 'dim-item' + (dim === 'none' ? ' none-item' : '');
      item.dataset.dim = dim;
      item.innerHTML =
        '<input type="checkbox" value="' + dim + '" />' +
        '<span class="dim-check"></span>' +
        '<span>' + DIMENSION_LABELS[dim] + '</span>';
      item.addEventListener('click', e => { e.preventDefault(); dToggleDim(containerId, dim); });
      el.appendChild(item);
    });
  });
}

function dToggleDim(containerId, dim) {
  const key = containerId==='dImgDims' ? 'imgDim' : containerId==='dCapDims' ? 'capDim' : 'ovDim';
  let arr = dDraft[key];
  if (dim === 'none') {
    dDraft[key] = arr.includes('none') ? [] : ['none'];
  } else {
    dDraft[key] = arr.includes(dim) ? arr.filter(d=>d!==dim) : arr.filter(d=>d!=='none').concat(dim);
  }
  dUpdateDimUI(containerId, dDraft[key]);
  document.getElementById('dValidationMsg').textContent = '';
}

function dUpdateDimUI(containerId, selected) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('.dim-item').forEach(item => {
    item.classList.toggle('checked', selected.includes(item.dataset.dim));
  });
}

function dUpdateAllDimUI() {
  dUpdateDimUI('dImgDims', dDraft.imgDim);
  dUpdateDimUI('dCapDims', dDraft.capDim);
  dUpdateDimUI('dOvDims',  dDraft.ovDim);
}

async function dNavigate(dir) {
  if (dir === 1) {
    if (dDraft.imgDim.length===0 || dDraft.capDim.length===0 || dDraft.ovDim.length===0) {
      document.getElementById('dValidationMsg').textContent =
        '⚠ Please select at least one dimension (or None) for all three columns.';
      return;
    }
    await dSavePost();
  }
  const newIdx = disagIdx + dir;
  if (newIdx < 0 || newIdx >= disagPosts.length) return;
  disagIdx = newIdx;
  dRenderPost(disagIdx);
}

async function dSavePost() {
  const post = disagPosts[disagIdx];
  dDraft.note = document.getElementById('dNoteField').value;
  const statusEl = document.getElementById('dSaveStatus');
  statusEl.className = 'save-status saving';
  statusEl.textContent = 'Saving…';

  try {
    const res = await fetch('/api/save', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization: 'Bearer ' + TOKEN},
      body: JSON.stringify({
        recordId: post.recordId,
        imgDim: dDraft.imgDim,
        capDim: dDraft.capDim,
        ovDim:  dDraft.ovDim,
        note:   dDraft.note,
      })
    });
    if (!res.ok) throw new Error('Save failed');

    // Update local state
    disagPosts[disagIdx].imgDim = [...dDraft.imgDim];
    disagPosts[disagIdx].capDim = [...dDraft.capDim];
    disagPosts[disagIdx].ovDim  = [...dDraft.ovDim];
    disagPosts[disagIdx].note   = dDraft.note;

    // Check if this resolves the disagreement
    const myOv = dDraft.ovDim;
    const otherOv = TOKEN === '' ? disagPosts[disagIdx].coderB_ov : disagPosts[disagIdx].coderA_ov;
    const hasReal = dims => dims.some(d => d !== 'none' && d !== '');
    if (hasReal(myOv) === hasReal(otherOv)) {
      // Resolved! Remove from list
      disagPosts.splice(disagIdx, 1);
      updateDisagreeCount(disagPosts.length);
      document.getElementById('dSubtitle').textContent = disagPosts.length + ' disagreement(s) to review';

      if (disagPosts.length === 0) {
        document.getElementById('dBody').style.display = 'none';
        document.getElementById('dEmptyState').style.display = 'flex';
        return;
      }
      disagIdx = Math.min(disagIdx, disagPosts.length - 1);
      dRenderPost(disagIdx);
      statusEl.className = 'save-status saved';
      statusEl.textContent = '✓ Resolved!';
      return;
    }

    statusEl.className = 'save-status saved';
    statusEl.textContent = '✓ Saved';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch(err) {
    document.getElementById('dSaveStatus').className = 'save-status error';
    document.getElementById('dSaveStatus').textContent = '✗ Save failed';
    throw err;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>`;
}

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('CSR Coder running on port ' + PORT));
}
module.exports = { app, resolveCoder, validDimensions };
