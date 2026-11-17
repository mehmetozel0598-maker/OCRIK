/*
 * OCR çekirdeği — tarayıcıda ve Node'da (test için) aynı kod çalışır.
 * Bağımlılıklar dışarıdan verilir: PDFLib (pdf-lib), JSZip.
 */
(function (root) {
  'use strict';

  // Tesseract sonucundan satır ve paragrafları çıkar
  function extractLayout(data) {
    const paragraphs = [];
    for (const block of data.blocks || []) {
      for (const par of block.paragraphs || []) {
        const lines = [];
        for (const line of par.lines || []) {
          const words = (line.words || []).filter(w => w.text && w.text.trim());
          if (!words.length) continue;
          lines.push({ bbox: line.bbox, baseline: line.baseline, words });
        }
        if (lines.length) paragraphs.push({ lines });
      }
    }
    return paragraphs;
  }

  // Paragraf metni: satırları birleştir, satır sonu tirelemesini düzelt
  function paragraphText(par, keepLines) {
    const lineTexts = par.lines.map(l => l.words.map(w => w.text.trim()).join(' '));
    if (keepLines) return lineTexts;
    let out = '';
    for (const t of lineTexts) {
      if (!out) { out = t; continue; }
      if (/[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(out) && /^[a-zçğıöşü]/.test(t)) {
        out = out.slice(0, -1) + t;
      } else {
        out += ' ' + t;
      }
    }
    return [out];
  }

  // Sayfa görüntüsünü + görünmez (seçilebilir) metin katmanını PDF'e ekle
  // scale: piksel / punto oranı
  function addOcrPage(PDFLib, pdfDoc, font, opts) {
    const { image, widthPt, heightPt, scale, paragraphs } = opts;
    const page = pdfDoc.addPage([widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });

    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [PDFLib.pushGraphicsState(), PDFLib.beginText(),
      PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible)];

    for (const par of paragraphs) {
      for (const line of par.lines) {
        const lineH = (line.bbox.y1 - line.bbox.y0) / scale;
        const size = Math.max(2, lineH * 0.82);
        const bl = line.baseline;
        line.words.forEach((w, i) => {
          let text = w.text.trim();
          if (!text) return;
          const isLast = i === line.words.length - 1;
          // Baseline'ı kelimenin x konumunda hesapla
          let byPx = w.bbox.y1;
          if (bl && bl.x1 !== bl.x0) {
            const cx = w.bbox.x0;
            byPx = bl.y0 + (bl.y1 - bl.y0) * (cx - bl.x0) / (bl.x1 - bl.x0);
            if (!(byPx > w.bbox.y0 && byPx <= w.bbox.y1 + lineH * scale * 0.5)) byPx = w.bbox.y1;
          }
          const x = w.bbox.x0 / scale;
          const y = heightPt - byPx / scale;
          const boxW = (w.bbox.x1 - w.bbox.x0) / scale;
          const safe = sanitize(font, text);
          if (!safe) return;
          const natural = font.widthOfTextAtSize(safe, size);
          const tz = natural > 0 ? Math.max(10, Math.min(500, (boxW / natural) * 100)) : 100;
          ops.push(
            PDFLib.setFontAndSize(fontKey, size),
            PDFLib.setCharacterSqueeze(tz),
            PDFLib.setTextMatrix(1, 0, 0, 1, x, y),
            PDFLib.showText(font.encodeText(isLast ? safe : safe + ' '))
          );
        });
      }
    }
    ops.push(PDFLib.endText(), PDFLib.popGraphicsState());
    page.pushOperators(...ops);
    return page;
  }

  // Fontta karşılığı olmayan karakterleri at
  function sanitize(font, text) {
    try { font.encodeText(text); return text; } catch (e) {
      return Array.from(text).filter(ch => { try { font.encodeText(ch); return true; } catch (_) { return false; } }).join('');
    }
  }

  function xmlEsc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  // pages: [{ paragraphs }] ; toc (isteğe bağlı): { tocPages:Set, headingLineId, entries(resolve edilmiş), backButton }
  async function buildDocx(JSZip, pages, keepLines, toc, dropPageNums) {
    const isPageNum = line => dropPageNums && /^[\s\-–—]*(sayfa\s*)?\d{1,4}([\s\/]+\d{1,4})?[\s\-–—]*$/i.test(line.words.map(w => w.text).join(' '));
    const body = [];
    let bmId = 1, pending = '';
    const bm = name => { const id = bmId++; return `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:bookmarkEnd w:id="${id}"/>`; };
    const run = (t, rpr) => `<w:r>${rpr ? '<w:rPr>' + rpr + '</w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
    const para = (inner, ppr) => { const s = `<w:p><w:pPr>${ppr || '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/>'}</w:pPr>${pending}${inner}</w:p>`; pending = ''; return s; };
    const backPara = e => para(`<w:hyperlink w:anchor="ic_${e.id}" w:history="1">${run('\u2191 \u0130\u00e7indekiler', '<w:rStyle w:val="Kopru"/><w:sz w:val="16"/>')}</w:hyperlink>`,
      '<w:spacing w:after="0"/><w:jc w:val="right"/>');

    const T = toc && toc.entries && toc.entries.length ? toc : null;
    const entryByLast = new Map(), skip = new Set(), headingMap = new Map(), pageTop = new Map();
    if (T) {
      for (const e of T.entries) {
        entryByLast.set(e.lineIds[e.lineIds.length - 1], e);
        e.lineIds.slice(0, -1).forEach(id => skip.add(id));
        if (e.headingLine) {
          if (!headingMap.has(e.headingLine.id)) headingMap.set(e.headingLine.id, []);
          headingMap.get(e.headingLine.id).push(e);
        } else {
          if (!pageTop.has(e.target)) pageTop.set(e.target, []);
          pageTop.get(e.target).push(e);
        }
      }
    }
    let tocBmPlaced = false;

    pages.forEach((pg, pi) => {
      if (pi > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      const isToc = T && T.tocPages.has(pi);
      if (T && !isToc && pageTop.has(pi)) {
        const es = pageTop.get(pi);
        pending += es.map(e => bm('bl_' + e.id)).join('');
        if (T.backButton) body.push(backPara(es[0]));
      }
      if (isToc) {
        if (!tocBmPlaced && T.headingLineId == null) { pending += bm('icindekiler'); tocBmPlaced = true; }
        for (const par of pg.paragraphs) for (const line of par.lines) {
          if (skip.has(line.id)) continue;
          if (!entryByLast.has(line.id) && isPageNum(line)) continue;
          const text = line.words.map(w => w.text.trim()).join(' ');
          const e = entryByLast.get(line.id);
          if (line.id === T.headingLineId) {
            if (!tocBmPlaced) { pending += bm('icindekiler'); tocBmPlaced = true; }
            body.push(para(run(text, '<w:b/><w:sz w:val="28"/>'), '<w:spacing w:after="240"/><w:jc w:val="center"/>'));
          } else if (e) {
            pending += bm('ic_' + e.id);
            const ind = Math.max(0, (e.level - 1) * 360);
            body.push(para(
              `<w:hyperlink w:anchor="bl_${e.id}" w:history="1">${run(e.title, '<w:rStyle w:val="Kopru"/>')}<w:r><w:tab/></w:r>${run(String(e.printed), '<w:rStyle w:val="Kopru"/>')}</w:hyperlink>`,
              `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9072"/></w:tabs><w:spacing w:after="80"/><w:ind w:left="${ind}"/>`));
          } else {
            body.push(para(run(text)));
          }
        }
        return;
      }
      for (const par of pg.paragraphs) {
        // Paragrafı başlık satırlarından böl
        let seg = [];
        const flush = () => {
          if (!seg.length) return;
          const texts = paragraphText({ lines: seg }, keepLines);
          body.push(para(texts.map((t, i) => (i > 0 ? '<w:r><w:br/></w:r>' : '') + run(t)).join('')));
          seg = [];
        };
        for (const line of par.lines) {
          const hs = T && headingMap.get(line.id);
          if (!hs) { if (!isPageNum(line)) seg.push(line); continue; }
          flush();
          if (T.backButton) body.push(backPara(hs[0]));
          pending += hs.map(e => bm('bl_' + e.id)).join('');
          const text = line.words.map(w => w.text.trim()).join(' ');
          body.push(para(`<w:hyperlink w:anchor="ic_${hs[0].id}" w:history="1">${run(text, '<w:b/>')}</w:hyperlink>`,
            '<w:keepNext/><w:spacing w:before="120" w:after="160"/>'));
        }
        flush();
      }
    });
    if (pending) body.push(para(''));

    const zip = new JSZip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>');
    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>');
    zip.file('word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    zip.file('word/styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:styleId="Kopru"><w:name w:val="Köprü"/><w:rPr><w:color w:val="1A56DB"/></w:rPr></w:style>' +
      '</w:styles>');
    zip.file('word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>');
    return zip.generateAsync({
      type: typeof window === 'undefined' ? 'nodebuffer' : 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    });
  }

  const api = { extractLayout, paragraphText, addOcrPage, buildDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OcrCore = api;
})(this);
