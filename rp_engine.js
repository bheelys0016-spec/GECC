/* GECC 2569 template PDF engine.  Keeps every template page intact and draws
 * only live audit values and optional, saved evidence as an appendix. */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('pdf-lib'), require('@pdf-lib/fontkit'));
  else root.GECCReportEngine = factory(root.PDFLib, root.fontkit);
})(typeof window !== 'undefined' ? window : globalThis, function(PDFLib, fontkit){
  'use strict';
  if(!PDFLib) throw new Error('PDF-Lib is required');
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const TEMPLATE_PAGES = 22;

  function criteriaList(value){
    if(Array.isArray(value)) return value;
    if(value && Array.isArray(value.criteria)) return value.criteria;
    /* Older pages may have stored criteria under common wrapper names. */
    if(value && Array.isArray(value.CITERIA)) return value.CITERIA;
    if(value && Array.isArray(value.CRIERIA)) return value.CRIERIA;
    return [];
  }
  function flatten(criteria){ return criteriaList(criteria).flatMap(function(c){ return (c.items || []).map(function(i){ return Object.assign({criterionId:c.id}, i); }); }); }
  function score(criteria){
    const all = flatten(criteria), physical = all.filter(i => i.criterionId === 1), quality = all.filter(i => i.criterionId === 2), outcome = all.filter(i => i.criterionId === 3);
    const qualityPoints = quality.filter(i => i.checked).reduce((sum, i) => sum + Number(i.points || 0), 0);
    const maxQuality = quality.reduce((sum, i) => sum + Number(i.points || 0), 0);
    return {
      physicalComplete: physical.length === 15 && physical.every(i => i.checked),
      qualityPoints, maxQuality, outcomePoints: outcome.filter(i => i.checked).reduce((sum, i) => sum + Number(i.points || 0), 0),
      outcomeMax: outcome.reduce((sum, i) => sum + Number(i.points || 0), 0),
      schemaValid: physical.length === 15 && quality.length === 41 && maxQuality === 70 && outcome.length === 3 && outcome.reduce((sum, i) => sum + Number(i.points || 0), 0) === 30
    };
  }
  function thaiDate(){ return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {day:'numeric', month:'long', year:'numeric'}).format(new Date()); }
  function drawText(page, text, x, y, font, size, color){ page.drawText(String(text), {x,y,size,font,color:color || rgb(0.08,0.12,0.22), maxWidth:530, lineHeight:size + 2}); }
  function drawPageStamp(page, label, font){
    page.drawRectangle({x:40,y:23,width:515,height:15,color:rgb(1,1,1),opacity:0.90});
    drawText(page, label, 43, 27, font, 7.5, rgb(0.26,0.32,0.43));
  }
  function dataUriBytes(uri){ const at=uri.indexOf(','); if(at < 0) throw new Error('Invalid saved image'); const body=uri.slice(at+1); if(typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(body, 'base64')); const raw=atob(body); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
  async function appendEvidence(doc, criteria, font){
    const evidence = flatten(criteria).filter(i => Array.isArray(i.images) && i.images.length);
    if(!evidence.length) return 0;
    let page, y = 780, added = 0;
    for(const item of evidence){
      for(const image of item.images){
        if(!page || y < 175){ page = doc.addPage([595.28,841.89]); added++; y = 785; drawText(page, 'ภาคผนวก: ภาพหลักฐานจากระบบตรวจประเมิน', 42, y, font, 14); y -= 28; }
        try{
          const bytes = dataUriBytes(image.url);
          const embedded = /^data:image\/png/i.test(image.url) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const scale = Math.min(230 / embedded.width, 145 / embedded.height, 1);
          const dims = embedded.scale(scale);
          page.drawRectangle({x:42,y:y-150,width:245,height:158,borderColor:rgb(.75,.78,.84),borderWidth:.6});
          page.drawImage(embedded,{x:49,y:y-142,width:dims.width,height:dims.height});
          drawText(page, 'เกณฑ์ ' + item.criterionId + ' ข้อ ' + item.no, 310, y-16, font, 10);
          drawText(page, item.note || image.name || 'ภาพหลักฐาน', 310, y-38, font, 9);
          if(item.driveLink) drawText(page, item.driveLink, 310, y-64, font, 7, rgb(0.04,.30,.72));
          y -= 170;
        }catch(error){ console.warn('Skipped unsupported saved evidence image:', image.name, error); }
      }
    }
    return added;
  }
  async function render(options){
    const template = options.templateBytes, fontBytes = options.fontBytes, state = options.state || {}, stationName = options.stationName || 'ไม่ระบุชื่อศูนย์ราชการสะดวก';
    const doc = await PDFDocument.load(template, {ignoreEncryption:true});
    if(doc.getPageCount() !== TEMPLATE_PAGES) throw new Error('Expected the 22-page GECC 2569 template.');
    // The template already carries its Thai font.  Generated labels are kept in
    // PDF base-14 Latin glyphs because PDF-Lib does not perform Thai shaping;
    // this prevents broken tone marks while preserving every Thai template glyph.
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const criteria = criteriaList(state);
    const result = score(criteria);
    const pages = doc.getPages();
    drawText(pages[1], 'Smart Rail audit: physical ' + (result.physicalComplete ? '15/15 complete' : 'incomplete') + ' | quality ' + result.qualityPoints + '/' + result.maxQuality + ' | outcome ' + result.outcomePoints + '/' + result.outcomeMax, 45, 95, font, 8);
    if(!result.schemaValid) drawText(pages[1], 'Schema warning: current audit must be reconciled to 41 items / 70 quality points before a 100-point total is issued.', 45, 80, font, 7, rgb(.70,.12,.12));
    pages.forEach((page, index) => drawPageStamp(page, 'Smart Rail GECC audit export | template page ' + (index+1) + '/' + TEMPLATE_PAGES, font));
    const appendixPages = options.includeEvidence ? await appendEvidence(doc, criteria, font) : 0;
    return {bytes:await doc.save(), summary:Object.assign(result,{templatePages:TEMPLATE_PAGES, appendixPages})};
  }
  async function downloadFromBrowser(options){
    const [templateBytes,fontBytes] = await Promise.all([fetch(options.templateUrl).then(r => { if(!r.ok) throw new Error('Cannot load template PDF'); return r.arrayBuffer(); }), options.fontUrl ? fetch(options.fontUrl).then(r => { if(!r.ok) throw new Error('Cannot load Thai font'); return r.arrayBuffer(); }) : Promise.resolve(null)]);
    const result = await render(Object.assign({},options,{templateBytes,fontBytes}));
    const blob = new Blob([result.bytes], {type:'application/pdf'}), url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=options.filename || 'GECC-2569-report.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    return result.summary;
  }
  return {render, score, downloadFromBrowser, TEMPLATE_PAGES};
});
