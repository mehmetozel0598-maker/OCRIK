import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const { PDFLib, fontkit, JSZip, Tesseract, OcrCore, TocLinks } = window;
const $ = id => document.getElementById(id);

// ---------- Genel durum ----------
let cancelled = false;
let wakeLock = null;
let state = null; // { mode:'ocr'|'link', model, toc, ... }
let fontBytes = null;
// Service worker: yalnızca bu klasörün kapsamında
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}

// ---------- Sekmeler ----------
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  $('tab-ocr').classList.toggle('hidden', b.dataset.tab !== 'ocr');
  $('tab-link').classList.toggle('hidden', b.dataset.tab !== 'link');
  resetOutputs();
}));

// Köprü seçeneklerini iki sekmeye de kopyala
for (const id of ['ocrTocOpts', 'linkTocOpts']) $(id).appendChild($('tocOptsTpl').content.cloneNode(true));
const tocOpts = containerId => {
  const o = {};
  $(containerId).querySelectorAll('input[data-k]').forEach(i => { o[i.dataset.k] = i.checked; });
  return o;
};
$('ocrToc').addEventListener('change', () => $('ocrTocOpts').classList.toggle('hidden', !$('ocrToc').checked));
$('outDocx').addEventListener('change', () => $('docxOpts').classList.toggle('hidden', !$('outDocx').checked));

// ---------- Dosya seçimi ----------
$('ocrFile').addEventListener('change', () => {
  const f = $('ocrFile').files;
  $('ocrDrop').classList.toggle('has', f.length > 0);
  $('ocrDrop').querySelector('strong').textContent = f.length ? (f.length === 1 ? f[0].name : f.length + ' dosya seçildi') : "Taranmış PDF veya görüntü seçin";
  $('ocrStart').disabled = !f.length;
  resetOutputs();
});
$('linkFile').addEventListener('change', () => {
  const f = $('linkFile').files;
  $('linkDrop').classList.toggle('has', f.length > 0);
  $('linkDrop').querySelector('strong').textContent = f.length ? f[0].name : 'Metin içeren PDF seçin';
  $('linkStart').disabled = !f.length;
  resetOutputs();
});

// ---------- Yardımcılar ----------
function resetOutputs() {
  $('review').classList.add('hidden');
  $('result').classList.add('hidden');
  $('downloads').innerHTML = '';
  $('msgs').innerHTML = '';
}
function msg(text, kind = 'warn') {
  const d = document.createElement('div');
  d.className = 'msg ' + kind; d.textContent = text;
  $('msgs').appendChild(d);
}
function progress(title, value, log) {
  $('progressCard').classList.remove('hidden');
  if (title != null) $('progTitle').textContent = title;
  if (value != null) $('prog').value = value;
  if (log != null) $('log').textContent = log;
}
function progressDone() { $('progressCard').classList.add('hidden'); }
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (_) { /* desteklenmiyor */ }
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
function addDownload(blob, filename, label) {
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.textContent = label + ' — ' + filename;
  $('downloads').appendChild(a);
  $('result').classList.remove('hidden');
}
function parseRange(text, max) {
  const t = (text || '').trim();
  if (!t) return Array.from({ length: max }, (_, i) => i);
  const set = new Set();
  for (const part of t.split(/[,;\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= Math.min(b, max); i++) if (i >= 1) set.add(i - 1);
  }
  return [...set].sort((x, y) => x - y);
}
async function getFont() {
  if (!fontBytes) fontBytes = await (await fetch('DejaVuSans.ttf')).arrayBuffer();
  return fontBytes;
}
const canvasToJpeg = (canvas, q = 0.78) => new Promise(res => canvas.toBlob(b => b.arrayBuffer().then(x => res(new Uint8Array(x))), 'image/jpeg', q));
$('cancel').addEventListener('click', () => { cancelled = true; $('log').textContent = 'İptal ediliyor…'; });

// =====================================================================
// OCR AKIŞI
// =====================================================================
$('ocrStart').addEventListener('click', runOcr);

async function* iteratePages(files, range, dpi) {
  // PDF: sayfaları sırayla canvas'a çiz; görüntü: doğrudan
  const first = files[0];
  if (first.type === 'application/pdf' || /\.pdf$/i.test(first.name)) {
    const pdf = await pdfjsLib.getDocument({ data: await first.arrayBuffer(), isEvalSupported: false }).promise;
    const idxs = parseRange(range, pdf.numPages);
    for (let k = 0; k < idxs.length; k++) {
      const page = await pdf.getPage(idxs[k] + 1);
      const vp1 = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const maxPx = 4500;
      if (Math.max(vp1.width, vp1.height) * scale > maxPx) scale = maxPx / Math.max(vp1.width, vp1.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      yield { canvas, widthPt: vp1.width, heightPt: vp1.height, scale: canvas.width / vp1.width, label: 'Sayfa ' + (idxs[k] + 1), k, total: idxs.length };
    }
    pdf.destroy();
  } else {
    const imgs = [...files].filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));
    for (let k = 0; k < imgs.length; k++) {
      const bmp = await createImageBitmap(imgs[k]);
      let w = bmp.width, h = bmp.height;
      const maxPx = 4500;
      if (Math.max(w, h) > maxPx) { const f = maxPx / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close();
      const widthPt = 595.28, scale = w / widthPt;
      yield { canvas, widthPt, heightPt: h / scale, scale, label: imgs[k].name, k, total: imgs.length };
    }
  }
}

async function runOcr() {
  const files = $('ocrFile').files;
  if (!files.length) return;
  const wantPdf = $('outPdf').checked, wantDocx = $('outDocx').checked;
  if (!wantPdf && !wantDocx) { msg('En az bir çıktı türü seçin.'); return; }
  resetOutputs();
  cancelled = false;
  $('ocrStart').disabled = true;
  await keepAwake(true);
  const dpi = +$('dpi').value;
  let worker;
  try {
    progress('OCR motoru yükleniyor…', 0, 'İlk kullanımda dil verisi indirilir (birkaç MB), sonra önbellekten gelir.');
    let current = { k: 0, total: 1 };
    worker = await Tesseract.createWorker($('lang').value, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          $('prog').value = (current.k + m.progress) / current.total;
        }
      }
    });
    await worker.setParameters({ user_defined_dpi: String(dpi), preserve_interword_spaces: '1' });

    const pages = [], model = [];
    for await (const pg of iteratePages(files, $('range').value, dpi)) {
      if (cancelled) break;
      current = pg;
      progress('Metin tanınıyor', pg.k / pg.total, `${pg.label} (${pg.k + 1}/${pg.total})`);
      const { data } = await worker.recognize(pg.canvas, {}, { blocks: true, text: true });
      const paragraphs = OcrCore.extractLayout(data);
      const jpg = wantPdf ? await canvasToJpeg(pg.canvas) : null;
      pg.canvas.width = pg.canvas.height = 0; // belleği bırak
      const i = pages.length;
      pages.push({ paragraphs, jpg, widthPt: pg.widthPt, heightPt: pg.heightPt, scale: pg.scale });
      const H = pg.heightPt;
      model.push({ index: i, width: pg.widthPt, height: H, rotation: 0, toPdf: (x, y) => [x, H - y], lines: TocLinks.linesFromOcr(paragraphs, pg.scale, i) });
    }
    await worker.terminate(); worker = null;
    if (cancelled) { progressDone(); msg('İşlem iptal edildi.'); return; }
    if (!pages.length) { progressDone(); msg('İşlenecek sayfa bulunamadı.', 'err'); return; }
    const empty = model.filter(p => !p.lines.length).length;
    if (empty) msg(`${empty} sayfada metin tanınamadı (boş ya da çok düşük kaliteli olabilir).`);

    state = { mode: 'ocr', pages, model, name: baseName(files[0].name), wantPdf, wantDocx, opts: tocOpts('ocrTocOpts') };
    progressDone();
    if ($('ocrToc').checked) {
      state.toc = TocLinks.detect(model);
      showReview();
    } else {
      await buildOcrOutputs();
    }
  } catch (e) {
    console.error(e);
    progressDone();
    msg('Hata: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    $('ocrStart').disabled = false;
    keepAwake(false);
  }
}

async function buildOcrOutputs() {
  const { pages, model, toc, opts, name } = state;
  const useToc = toc && toc.entries.some(e => e.include);
  progress('Dosyalar oluşturuluyor…', 0.5, '');
  if (state.wantPdf) {
    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(await getFont(), { subset: true });
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const image = await doc.embedJpg(p.jpg);
      OcrCore.addOcrPage(PDFLib, doc, font, { image, widthPt: p.widthPt, heightPt: p.heightPt, scale: p.scale, paragraphs: p.paragraphs });
    }
    if (useToc) TocLinks.applyToPdf(PDFLib, doc, model, toc, { ...opts, font });
    doc.setTitle(name);
    doc.setProducer('Tarama → Metin');
    const bytes = await doc.save();
    addDownload(new Blob([bytes], { type: 'application/pdf' }), name + '_metinli.pdf', 'Aranabilir PDF');
  }
  if (state.wantDocx) {
    let tctx = null;
    if (useToc) {
      const entries = TocLinks.resolve(model, toc);
      tctx = { tocPages: new Set(toc.tocPages), headingLineId: toc.headingLineId, entries, backButton: opts.backButton };
    }
    const blob = await OcrCore.buildDocx(JSZip, pages, $('keepLines').checked, tctx, $('dropNums').checked);
    addDownload(blob, name + '.docx', 'Word');
  }
  progressDone();
  if (useToc) {
    const n = toc.entries.filter(e => e.include).length;
    msg(`${n} içindekiler satırı köprülendi.` + (state.wantDocx ? ' Word\'de köprüye Ctrl+tıklayarak gidilir.' : ''), 'ok');
  }
}

// =====================================================================
// KÖPRÜ (METİNLİ PDF) AKIŞI
// =====================================================================
$('linkStart').addEventListener('click', runLink);

async function runLink() {
  const file = $('linkFile').files[0];
  if (!file) return;
  resetOutputs();
  cancelled = false;
  $('linkStart').disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    progress('PDF okunuyor…', 0, '');
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const model = [];
    let withText = 0;
    for (let i = 0; i < pdf.numPages; i++) {
      if (cancelled) break;
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const lines = TocLinks.linesFromTextContent(tc.items, vp, i);
      if (lines.length) withText++;
      model.push({ index: i, width: vp.width, height: vp.height, rotation: page.rotate, toPdf: (x, y) => vp.convertToPdfPoint(x, y), lines });
      progress(null, (i + 1) / pdf.numPages, `Sayfa ${i + 1}/${pdf.numPages}`);
      page.cleanup();
    }
    pdf.destroy();
    progressDone();
    if (cancelled) { msg('İşlem iptal edildi.'); return; }
    if (withText < model.length * 0.3) {
      msg('Bu PDF\'in çoğu sayfasında metin yok, taranmış görünüyor. Önce "OCR Dönüştür" sekmesinden çevirin (orada köprüler de eklenir).', 'err');
      return;
    }
    state = { mode: 'link', bytes, model, name: baseName(file.name), opts: tocOpts('linkTocOpts') };
    state.toc = TocLinks.detect(model);
    showReview();
  } catch (e) {
    console.error(e);
    progressDone();
    msg('Hata: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    $('linkStart').disabled = false;
  }
}

async function buildLinkOutput() {
  const { bytes, model, toc, opts, name } = state;
  progress('Köprüler ekleniyor…', 0.5, '');
  const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  let font = null;
  if (opts.backButton) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await getFont(), { subset: true });
  }
  const n = TocLinks.applyToPdf(PDFLib, doc, model, toc, { ...opts, font });
  const out = await doc.save();
  progressDone();
  addDownload(new Blob([out], { type: 'application/pdf' }), name + '_kopru.pdf', 'Köprülü PDF');
  msg(`${n} içindekiler satırı köprülendi.`, 'ok');
}

// =====================================================================
// GÖZDEN GEÇİRME PANELİ
// =====================================================================
function fmtPages(arr) { return arr.map(i => i + 1).join(', '); }

function showReview() {
  const { toc, model } = state;
  $('review').classList.remove('hidden');
  $('tocPagesIn').value = fmtPages(toc.tocPages);
  const box = $('entries');
  box.innerHTML = '';
  if (!toc.entries.length) {
    box.innerHTML = '<p class="hint">İçindekiler bulunamadı. Yukarıya içindekilerin bulunduğu PDF sayfa numarasını yazıp "Yeniden tara"ya basın.' +
      (state.mode === 'ocr' ? ' Köprü istemiyorsanız aşağıdaki düğmeyle dosyaları köprüsüz oluşturabilirsiniz.' : '') + '</p>';
    $('offsetIn').value = '';
    $('build').textContent = state.mode === 'ocr' ? 'Dosyaları köprüsüz oluştur' : 'Köprüleri ekle';
    $('build').disabled = state.mode !== 'ocr';
    $('review').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  $('build').disabled = false;
  $('build').textContent = state.mode === 'ocr' ? 'Köprüleri ekle ve dosyaları oluştur' : 'Köprüleri ekle';
  $('offsetIn').value = toc.offset + 1;
  $('offsetIn').max = model.length;
  for (const e of toc.entries) {
    const row = document.createElement('div');
    row.className = 'entry';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: e.include });
    cb.onchange = () => { e.include = cb.checked; };
    const ti = Object.assign(document.createElement('input'), { type: 'text', value: e.title });
    ti.style.paddingLeft = (6 + (e.level - 1) * 12) + 'px';
    ti.oninput = () => { e.title = ti.value; };
    const pp = document.createElement('span'); pp.className = 'pp'; pp.textContent = e.printed;
    const tgWrap = document.createElement('span');
    const tg = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: model.length, value: e.target + 1 });
    const badge = document.createElement('span');
    const setBadge = () => {
      const ok = !!TocLinks.findHeadingLine(model[e.target], e.title);
      badge.className = 'badge ' + (ok ? 'b-ok' : 'b-q'); badge.textContent = ok ? '✓' : '?';
    };
    tg.onchange = () => { const v = Math.max(1, Math.min(model.length, +tg.value || 1)); tg.value = v; e.target = v - 1; setBadge(); };
    setBadge();
    tgWrap.append(tg);
    const tWrap = document.createElement('span');
    tWrap.style.display = 'flex'; tWrap.style.alignItems = 'center';
    tWrap.append(ti, badge);
    row.append(cb, tWrap, pp, tgWrap);
    box.appendChild(row);
  }
  $('review').scrollIntoView({ behavior: 'smooth' });
}

$('rescan').addEventListener('click', () => {
  if (!state) return;
  const idx = parseRange($('tocPagesIn').value, state.model.length);
  if (!$('tocPagesIn').value.trim() || !idx.length) { msg('İçindekiler sayfa numarasını girin (örn. 2 veya 2-3).'); return; }
  state.toc = TocLinks.detect(state.model, idx);
  $('msgs').innerHTML = '';
  if (!state.toc.entries.length) msg('Bu sayfalarda "Başlık ...... 12" biçiminde satır bulunamadı.');
  showReview();
});

$('applyOffset').addEventListener('click', () => {
  if (!state || !state.toc.entries.length) return;
  const first = +$('offsetIn').value;
  if (!first) return;
  state.toc.offset = first - 1;
  for (const e of state.toc.entries) e.target = TocLinks.refineTarget(state.model, state.toc, e, e.printed - 1 + state.toc.offset);
  showReview();
});

$('build').addEventListener('click', async () => {
  if (!state) return;
  $('build').disabled = true;
  try {
    $('result').classList.add('hidden'); $('downloads').innerHTML = '';
    if (state.mode === 'ocr') await buildOcrOutputs();
    else await buildLinkOutput();
    $('result').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    progressDone();
    msg('Hata: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    $('build').disabled = false;
  }
});
