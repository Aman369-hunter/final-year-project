// Client-side PDF of a doctor's case report. The disclaimer is printed on every
// page (Section 6.4 rule 1). Server-side PDFs (/api/reports/:id/pdf) come in Phase 3.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { isDemo } from '../demo/mode.js';
import { CATEGORY_LABELS, MISSING_INPUT_LABELS, pct } from './risk.js';

export function buildReportPdf(c) {
  const demo = isDemo() || Boolean(c.demo);
  const r = c.assessment.response;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  doc.setFont('helvetica', 'bold').setFontSize(16).text('LSD-CDSS screening report', M, y);
  y += 18;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100);
  doc.text(`Case ${c.id} · generated ${new Date().toLocaleString()} · engine ${r.model.engine_version} (${r.model.mode}), weights ${r.model.weights_version}`, M, y);
  y += 22;

  doc.setTextColor(0).setFontSize(10);
  const pt = c.patient;
  doc.text(`Patient: ${pt.name} · ${pt.age_years} y · ${pt.sex}`, M, y);
  y += 14;
  const top = r.predictions.find((p) => p.rank === 1);
  doc.setFont('helvetica', 'bold');
  doc.text(`Risk band: ${r.risk_level} · top screening result ${top.display_name} at ${pct(top.absolute_risk)} absolute risk`, M, y);
  doc.setFont('helvetica', 'normal');
  y += 14;
  const missing = r.confidence.missing_inputs.map((m) => MISSING_INPUT_LABELS[m] ?? m).join(', ') || 'none';
  doc.text(`Confidence: ${r.confidence.level} · missing inputs: ${missing}`, M, y);
  y += 12;
  doc.setFontSize(9).text(doc.splitTextToSize(r.confidence.note, W - 2 * M), M, y);

  y += 24;
  const H = doc.internal.pageSize.getHeight();
  const section = (title, head, body) => {
    if (y > H - 140) {
      doc.addPage();
      y = M;
    }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0).text(title, M, y);
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y + 6,
      head: [head],
      body,
      margin: { left: M, right: M, bottom: 72 },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59] },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 24;
  };

  section(
    'Screening risk, all six diseases',
    ['Rank', 'Disease', 'Absolute risk', 'Relative probability', 'Score'],
    [...r.predictions].sort((a, b) => a.rank - b.rank).map((p) => [p.rank, p.display_name, pct(p.absolute_risk), pct(p.relative_probability), `${p.raw_score} / ${p.max_possible_score}`]),
  );
  section(
    'Contributing factors',
    ['Category', 'Finding', 'Value', 'Points', 'Direction', 'Disease', 'Citation'],
    r.factors.map((f) => [CATEGORY_LABELS[f.category] ?? f.category, f.label, f.value, f.points, f.direction, f.disease, f.citation]),
  );
  section(
    'Confirmatory tests',
    ['Priority', 'Test', 'Rationale'],
    r.recommendations.confirmatory_tests.length ? r.recommendations.confirmatory_tests.map((t) => [t.priority, t.test, t.rationale]) : [['—', 'None suggested', '']],
  );
  section(
    'Treatment pathways (post-confirmation only)',
    ['Pathway', 'Stage'],
    r.recommendations.treatment_pathways.length ? r.recommendations.treatment_pathways.map((t) => [t.name, t.stage]) : [['None at this screening result', '']],
  );

  if (y > H - 130) {
    doc.addPage();
    y = M;
  }
  const referral = doc.splitTextToSize(`Referral: ${r.recommendations.referral}`, W - 2 * M);
  doc.setFontSize(9).text(referral, M, y);
  y += referral.length * 11 + 4;
  if (r.inheritance?.note) doc.text(doc.splitTextToSize(`Inheritance: ${r.inheritance.note}`, W - 2 * M), M, y);

  if (demo) doc.setProperties({ title: 'DEMO: not real patient data', subject: 'DEMO MODE report. Scripted data, not a clinical record.' });

  // Disclaimer + page number on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (demo) drawDemoMarks(doc, W, H, M);
    doc.setDrawColor(217, 119, 6).setFillColor(255, 251, 235).rect(M, H - 62, W - 2 * M, 34, 'FD');
    doc.setFontSize(8).setTextColor(120, 53, 15).setFont('helvetica', 'bold').text('Medical disclaimer: ', M + 6, H - 50);
    doc.setFont('helvetica', 'normal').text(doc.splitTextToSize(r.disclaimer, W - 2 * M - 95), M + 88, H - 50);
    doc.setTextColor(120).text(`Page ${i} of ${pages}`, W - M, H - 16, { align: 'right' });
  }
  return doc;
}

// A report made in demo mode can never be mistaken for a real one: a diagonal
// watermark across the page body AND a header strip, on every page, plus a DEMO- filename.
function drawDemoMarks(doc, W, H, M) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  doc.setFont('helvetica', 'bold').setFontSize(110).setTextColor(190, 18, 60);
  doc.text('DEMO', W / 2, H / 2 + 40, { align: 'center', angle: 35 });
  doc.restoreGraphicsState();
  doc.setFillColor(190, 18, 60).rect(M, 12, W - 2 * M, 17, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(255, 255, 255);
  doc.text('DEMO MODE - NOT REAL PATIENT DATA - NOT A CLINICAL RECORD', W / 2, 24, { align: 'center' });
  doc.setFont('helvetica', 'normal');
}

export function downloadReport(c) {
  const name = `lsd-cdss-report-${c.id}.pdf`;
  buildReportPdf(c).save(isDemo() || c.demo ? `DEMO-${name}` : name);
}
