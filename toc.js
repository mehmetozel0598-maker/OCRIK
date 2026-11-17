/*
 * İçindekiler köprü modülü
 * Sayfa modeli: { index, width, height, rotation, toPdf(x,y)->[x,y], lines:[{id,text,x0,y0,x1,y1}] }
 * (koordinatlar punto cinsinden, sol-üst köşe orijinli)
 */
(function (root) {
  'use strict';

  const HEADINGS = ['icindekiler', 'icindekiler tablosu', 'icerik', 'icerikler', 'fihrist', 'contents', 'table of contents'];

  function norm(s) {
    return (s || '').toLocaleLowerCase('tr')
      .replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Baştaki numaralandırmayı at: "1.2.", "A.", "IV-", "a)" vb.
  function stripNumbering(s) {
    return s.replace(/^\s*((\d+|[a-zA-Z]|[IVXivx]{1,5})[.)\-]\s*)+/, '')
      .replace(/^\s*\d+(\.\d+)*\s+/, '').trim();
  }

  function levelOf(title) {
    const m = title.match(/^\s*(\d+(?:\.\d+)*)[.)]?\s/);
    return m ? Math.min(6, m[1].split('.').length) : 1;
  }

  // OCR'ın sayılarda yaptığı tipik hataları düzelt (O→0, Z→2, S→5 ...)
  // Harf karışıklıkları yalnızca satırda noktalı çizgi varsa kabul edilir
  const DIGIT_LIKE = { I: '1', l: '1', '|': '1', i: '1', O: '0', o: '0', D: '0', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', T: '7', g: '9', q: '9' };
  function fixDigits(tok, hasLeader) {
    if (!tok || tok.length > 4) return null;
    if (/^\d+$/.test(tok)) return parseInt(tok, 10);
    if (!hasLeader && !/\d/.test(tok)) return null;
    let out = '';
    for (const ch of tok) {
      if (/\d/.test(ch)) out += ch;
      else if (DIGIT_LIKE[ch]) out += DIGIT_LIKE[ch];
      else return null;
    }
    if (!hasLeader && tok.replace(/\d/g, '').length > 1) return null;
    return parseInt(out, 10);
  }

  // "Başlık ........ 12" → {title, page}
  const LEADER_RE = /[.\u2026·•_]{3,}|(?:\s?[.\u2026·•_]){4,}/;
  function parseEntry(text) {
    const t = text.replace(/\s+$/, '');
    const m = t.match(/^(.*?)[\s.\u2026·•_–—\-:]*\s*([0-9A-Za-z|]{1,4})$/);
    if (!m) return null;
    const hasLeader = LEADER_RE.test(t);
    const page = fixDigits(m[2], hasLeader);
    if (page == null || page < 1) return null;
    // Sayı ile başlık arasında ayraç olmalı (ör. "Madde213" giriş değildir)
    const before = t.slice(0, t.length - m[2].length);
    if (!/[\s.\u2026·•_–—\-:]$/.test(before)) return null;
    // Noktalı çizgiyi (OCR'ın onu harf diye okuduğu çöp dahil) başlıktan kes
    let title = m[1];
    const lead = title.search(LEADER_RE);
    if (lead > 0) title = title.slice(0, lead);
    title = title.replace(/[\s.\u2026·•_–—\-:]+$/, '').trim();
    if ((title.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length < 2) return null;
    return { title, page };
  }

  function isHeading(text) { return HEADINGS.includes(norm(text)); }

  function lineRect(lines) {
    return {
      x0: Math.min(...lines.map(l => l.x0)), y0: Math.min(...lines.map(l => l.y0)),
      x1: Math.max(...lines.map(l => l.x1)), y1: Math.max(...lines.map(l => l.y1))
    };
  }

  function parseTocPage(page, startIdx, entries) {
    let buffer = [];
    let parsed = 0, considered = 0;
    for (let i = startIdx; i < page.lines.length; i++) {
      const line = page.lines[i];
      if (!line.text.trim()) continue;
      considered++;
      const e = parseEntry(line.text);
      if (e) {
        parsed++;
        let lines = [line], title = e.title;
        const cont = buffer.length && (/^[a-zçğıöşü(]/.test(e.title) ||
          /[-,;]$|\s(ve|ile|veya|ya da|ilişkin|göre)$/i.test(buffer[buffer.length - 1].text.trim()));
        if (cont) {
          title = buffer.map(b => b.text.trim()).join(' ').replace(/-\s+/g, '') + ' ' + e.title;
          lines = buffer.concat(lines);
        }
        buffer = [];
        entries.push({
          id: entries.length, title, printed: e.page, level: levelOf(title),
          tocPage: page.index, lineIds: lines.map(l => l.id), rect: lineRect(lines), include: true
        });
      } else {
        buffer.push(line);
        if (buffer.length > 2) buffer.shift();
      }
    }
    return { parsed, considered };
  }

  // İçindekiler sayfalarını ve girişlerini bul
  function detect(pages, manualTocPages) {
    let tocPages = [], headingLineId = null, entries = [];
    if (manualTocPages && manualTocPages.length) {
      tocPages = manualTocPages.filter(i => pages[i]);
      for (const pi of tocPages) {
        const p = pages[pi];
        let start = 0;
        const h = p.lines.findIndex(l => isHeading(l.text));
        if (h >= 0) { if (headingLineId == null) headingLineId = p.lines[h].id; start = h + 1; }
        parseTocPage(p, start, entries);
      }
    } else {
      const limit = Math.min(pages.length, 40);
      for (let pi = 0; pi < limit; pi++) {
        const p = pages[pi];
        const h = p.lines.findIndex(l => isHeading(l.text));
        if (h < 0) continue;
        const tmp = [];
        const r = parseTocPage(p, h + 1, tmp);
        if (r.parsed < 2) continue;
        headingLineId = p.lines[h].id;
        tocPages = [pi];
        entries = tmp;
        // Devam sayfaları
        for (let pj = pi + 1; pj < Math.min(pages.length, pi + 12); pj++) {
          const t2 = [];
          const r2 = parseTocPage(pages[pj], 0, t2);
          if (r2.parsed >= 3 && r2.parsed >= r2.considered * 0.4) {
            tocPages.push(pj);
            t2.forEach(e => { e.id = entries.length; entries.push(e); });
          } else break;
        }
        break;
      }
    }
    entries.forEach((e, i) => { e.id = i; });
    const result = { tocPages, headingLineId, entries, offset: 0 };
    if (entries.length) {
      result.offset = guessOffset(pages, result);
      entries.forEach(e => { e.target = refineTarget(pages, result, e, e.printed - 1 + result.offset); });
    }
    return result;
  }

  function pageNormText(p) {
    if (!p._norm) p._norm = ' ' + p.lines.map(l => norm(l.text)).join(' ') + ' ';
    return p._norm;
  }

  function titleKey(title) {
    const k = norm(stripNumbering(title));
    return k.length > 24 ? k.slice(0, 24).replace(/\s\S*$/, '') || k.slice(0, 24) : k;
  }

  function titleOnPage(pages, toc, idx, title) {
    const p = pages[idx];
    if (!p || toc.tocPages.includes(idx)) return false;
    const k = titleKey(title);
    return k.length >= 4 && pageNormText(p).includes(' ' + k);
  }

  function guessOffset(pages, toc) {
    const n = pages.length;
    let best = null, bestScore = -1;
    for (let o = -n; o <= n; o++) {
      let score = 0;
      for (const e of toc.entries) if (titleOnPage(pages, toc, e.printed - 1 + o, e.title)) score++;
      if (score > bestScore || (score === bestScore && Math.abs(o) < Math.abs(best))) { best = o; bestScore = score; }
    }
    if (bestScore > 0) return best;
    // Eşleşme yoksa: en küçük sayfa numarası içindekilerden sonraki sayfaya denk gelsin
    const minP = Math.min(...toc.entries.map(e => e.printed));
    const after = Math.max(...toc.tocPages) + 1;
    return after - (minP - 1);
  }

  function refineTarget(pages, toc, e, guess) {
    for (const d of [0, 1, -1, 2, -2]) {
      if (titleOnPage(pages, toc, guess + d, e.title)) { e.matched = true; return guess + d; }
    }
    e.matched = false;
    return Math.max(0, Math.min(pages.length - 1, guess));
  }

  function bigramSim(a, b) {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const A = grams(a), B = grams(b);
    let inter = 0;
    for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
    return (2 * inter) / (a.length - 1 + b.length - 1);
  }

  // Hedef sayfadaki başlık satırını bul (yoksa null)
  function findHeadingLine(page, title) {
    if (!page) return null;
    const key = norm(stripNumbering(title));
    if (key.length < 3) return null;
    let best = null, bestS = 0;
    for (const l of page.lines) {
      const ln = norm(stripNumbering(l.text));
      if (!ln) continue;
      let s;
      if (ln.startsWith(key.slice(0, Math.min(key.length, 30)))) s = 1;
      else s = bigramSim(ln.slice(0, key.length + 2), key.slice(0, Math.max(ln.length, 3)));
      if (s > bestS) { bestS = s; best = l; }
    }
    return bestS >= 0.72 ? best : null;
  }

  // Seçili girişleri hedef/başlık bilgisiyle hazırla
  function resolve(pages, toc) {
    const list = toc.entries.filter(e => e.include && pages[e.target]);
    for (const e of list) {
      e.headingLine = findHeadingLine(pages[e.target], e.title);
    }
    return list;
  }

  function rectToPdf(page, r) {
    const a = page.toPdf(r.x0, r.y0), b = page.toPdf(r.x1, r.y1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  function makeDest(PDFLib, pdfDoc, page, yTop) {
    const pref = pdfDoc.getPage(page.index).ref;
    const top = page.toPdf(0, Math.max(0, yTop))[1];
    return [pref, 'XYZ', null, top, null];
  }

  function addLink(PDFLib, pdfDoc, page, rect, dest) {
    const ctx = pdfDoc.context;
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], H: 'I', Dest: dest
    });
    const ref = ctx.register(annot);
    pdfDoc.getPage(page.index).node.addAnnot(ref);
  }

  /**
   * PDF'e köprüleri ekle.
   * opts: { backButton, headingBackLink, bookmarks, font }
   */
  function applyToPdf(PDFLib, pdfDoc, pages, toc, opts) {
    const list = resolve(pages, toc);
    const tocFirst = pages[toc.tocPages[0]];
    let headingY = 0;
    if (toc.headingLineId != null) {
      const hl = tocFirst.lines.find(l => l.id === toc.headingLineId);
      if (hl) headingY = hl.y0 - 12;
    }
    const pad = 1.5;

    // 1) İçindekiler satırı → hedef sayfa
    for (const e of list) {
      const tp = pages[e.tocPage];
      const r = e.rect;
      const tgt = pages[e.target];
      const y = e.headingLine ? e.headingLine.y0 - 10 : 0;
      addLink(PDFLib, pdfDoc, tp, rectToPdf(tp, { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }), makeDest(PDFLib, pdfDoc, tgt, y));
    }

    // 2) Hedef sayfa → içindekiler (girişin bulunduğu yere)
    const backFor = e => makeDest(PDFLib, pdfDoc, pages[e.tocPage], Math.max(0, e.rect.y0 - 40));
    const buttonDone = new Set();
    for (const e of list) {
      const tgt = pages[e.target];
      if (opts.headingBackLink && e.headingLine) {
        const h = e.headingLine;
        addLink(PDFLib, pdfDoc, tgt, rectToPdf(tgt, { x0: h.x0 - pad, y0: h.y0 - pad, x1: h.x1 + pad, y1: h.y1 + pad }), backFor(e));
      }
      if (opts.backButton && opts.font && !buttonDone.has(e.target)) {
        buttonDone.add(e.target);
        drawBackButton(PDFLib, pdfDoc, tgt, opts.font, backFor(e));
      }
    }

    // 3) Yer imleri (sol paneldeki bookmark listesi)
    if (opts.bookmarks && list.length) addOutline(PDFLib, pdfDoc, pages, list, tocFirst, headingY);
    return list.length;
  }

  function drawBackButton(PDFLib, pdfDoc, page, font, dest) {
    if ((page.rotation || 0) % 360 !== 0) {
      // Döndürülmüş sayfada çizim yapmadan sadece üst-sağ köşeye görünmez bağlantı
      addLink(PDFLib, pdfDoc, page, rectToPdf(page, { x0: page.width - 90, y0: 6, x1: page.width - 8, y1: 24 }), dest);
      return;
    }
    const label = '↑ İçindekiler';
    const size = 7.5;
    const w = font.widthOfTextAtSize(label, size) + 10, h = 13;
    const vx = page.width - w - 10, vy = 8;
    const [px, pyTop] = page.toPdf(vx, vy);
    const py = pyTop - h;
    const pg = pdfDoc.getPage(page.index);
    const blue = PDFLib.rgb(0.1, 0.34, 0.86);
    pg.drawRectangle({ x: px, y: py, width: w, height: h, color: PDFLib.rgb(1, 1, 1), opacity: 0.9, borderColor: blue, borderWidth: 0.6, borderOpacity: 0.9 });
    pg.drawText(label, { x: px + 5, y: py + 3.6, size, font, color: blue });
    addLink(PDFLib, pdfDoc, page, [px, py, px + w, py + h], dest);
  }

  // Seviyeli (1, 1.1, 1.1.1 ...) yer imi ağacı
  function addOutline(PDFLib, pdfDoc, pages, list, tocFirst, headingY) {
    const ctx = pdfDoc.context;
    const rootRef = ctx.nextRef();
    const nodes = [];
    const tocNode = { title: 'İçindekiler', dest: makeDest(PDFLib, pdfDoc, tocFirst, headingY), level: 0, children: [] };
    const top = { children: [tocNode] };
    const stack = [{ level: 0, node: top }];
    const baseLevel = Math.min(...list.map(e => e.level));
    for (const e of list) {
      const lvl = e.level - baseLevel + 1;
      const node = { title: e.title, dest: makeDest(PDFLib, pdfDoc, pages[e.target], e.headingLine ? e.headingLine.y0 - 10 : 0), level: lvl, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= lvl) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: lvl, node });
    }
    const build = (children, parentRef) => {
      children.forEach(c => { c.ref = ctx.nextRef(); });
      children.forEach((c, i) => {
        const d = {
          Title: PDFLib.PDFHexString.fromText(c.title), Parent: parentRef, Dest: c.dest
        };
        if (i > 0) d.Prev = children[i - 1].ref;
        if (i < children.length - 1) d.Next = children[i + 1].ref;
        if (c.children.length) {
          build(c.children, c.ref);
          d.First = c.children[0].ref; d.Last = c.children[c.children.length - 1].ref;
          d.Count = -c.children.length; // kapalı başlasın
        }
        ctx.assign(c.ref, ctx.obj(d));
        nodes.push(c);
      });
    };
    build(top.children, rootRef);
    ctx.assign(rootRef, ctx.obj({
      Type: 'Outlines', First: top.children[0].ref, Last: top.children[top.children.length - 1].ref, Count: nodes.length
    }));
    pdfDoc.catalog.set(PDFLib.PDFName.of('Outlines'), rootRef);
    pdfDoc.catalog.set(PDFLib.PDFName.of('PageMode'), PDFLib.PDFName.of('UseOutlines'));
  }

  // pdf.js metin öğelerinden satır modeli üret
  function linesFromTextContent(items, viewport, pageIndex) {
    const parts = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) { if (it.str === ' ' && parts.length) parts[parts.length - 1].str += ' '; continue; }
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const fh = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      const [x2] = viewport.convertToViewportPoint(it.transform[4] + it.width, it.transform[5]);
      parts.push({ str: it.str, x0: Math.min(x, x2), x1: Math.max(x, x2), base: y, h: fh });
    }
    parts.sort((a, b) => a.base - b.base || a.x0 - b.x0);
    const rows = [];
    for (const p of parts) {
      const r = rows.find(r => Math.abs(r.base - p.base) < Math.max(r.h, p.h) * 0.45);
      if (r) { r.parts.push(p); r.h = Math.max(r.h, p.h); } else rows.push({ base: p.base, h: p.h, parts: [p] });
    }
    rows.sort((a, b) => a.base - b.base);
    return rows.map((r, k) => {
      r.parts.sort((a, b) => a.x0 - b.x0);
      let text = '';
      let prev = null;
      for (const p of r.parts) {
        if (prev && !/\s$/.test(text) && !/^\s/.test(p.str) && p.x0 - prev.x1 > r.h * 0.18) text += ' ';
        text += p.str; prev = p;
      }
      return {
        id: pageIndex + ':' + k, text: text.replace(/\s+/g, ' ').trim(),
        x0: Math.min(...r.parts.map(p => p.x0)), x1: Math.max(...r.parts.map(p => p.x1)),
        y0: r.base - r.h * 0.85, y1: r.base + r.h * 0.25
      };
    }).filter(l => l.text);
  }

  // OCR sonucundan (piksel) satır modeli üret; satırlara id verir
  function linesFromOcr(paragraphs, scale, pageIndex) {
    const lines = [];
    let k = 0;
    for (const par of paragraphs) for (const line of par.lines) {
      line.id = pageIndex + ':' + (k++);
      lines.push({
        id: line.id, text: line.words.map(w => w.text.trim()).join(' '),
        x0: line.bbox.x0 / scale, y0: line.bbox.y0 / scale, x1: line.bbox.x1 / scale, y1: line.bbox.y1 / scale
      });
    }
    return lines;
  }

  const api = { detect, resolve, applyToPdf, linesFromTextContent, linesFromOcr, findHeadingLine, parseEntry, norm, refineTarget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TocLinks = api;
})(this);
