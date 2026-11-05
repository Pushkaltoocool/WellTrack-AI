/**
 * Take your journal with you: a plain-text (Markdown) file or a printable PDF, shared through the
 * system share sheet. Everything is generated on the phone; nothing is uploaded.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { parseDateKey } from '@/lib/dates';

import { emotionMeta, type JournalAnalysis } from './analysis';
import { parseDocument } from './markdown';

export interface ExportableEntry {
  dateKey: string;
  body: string;
  prompt: string | null;
  tags: string[];
  analysis: JournalAnalysis | null;
}

const longDate = (key: string) => parseDateKey(key).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const feelings = (a: JournalAnalysis | null) => a?.emotions.map((e) => emotionMeta(e.name).label) ?? [];
const oldestFirst = <E extends ExportableEntry>(entries: E[]) => [...entries].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

/** Markdown keeps the journal's own formatting markers, so it reads well anywhere. */
export function journalToMarkdown(entries: ExportableEntry[], exportedOn: string): string {
  const out = [`# My WellTrack journal`, '', `Exported ${longDate(exportedOn)} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, ''];
  for (const e of oldestFirst(entries)) {
    out.push('---', '', `## ${longDate(e.dateKey)}`, '');
    if (e.prompt) out.push(`*${e.prompt}*`, '');
    out.push(e.body.trim(), '');
    const meta = [feelings(e.analysis).length ? `Feelings: ${feelings(e.analysis).join(', ')}` : '', e.tags.length ? `Tags: ${e.tags.map((t) => `#${t}`).join(' ')}` : ''].filter(Boolean);
    if (meta.length) out.push(`> ${meta.join(' · ')}`, '');
  }
  return out.join('\n');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bodyHtml(body: string): string {
  return parseDocument(body).map((line) => {
    const text = line.spans.filter((sp) => !sp.marker).map((sp) => {
      let h = escapeHtml(sp.text);
      if (sp.bold) h = `<b>${h}</b>`;
      if (sp.italic) h = `<i>${h}</i>`;
      if (sp.underline) h = `<u>${h}</u>`;
      if (sp.strike) h = `<s>${h}</s>`;
      return h;
    }).join('');
    if (!text.trim()) return '<p class="gap"></p>';
    switch (line.block) {
      case 'title': return `<h3 class="t">${text}</h3>`;
      case 'heading': return `<h4>${text}</h4>`;
      case 'subheading': return `<h5>${text}</h5>`;
      case 'quote': return `<blockquote>${text}</blockquote>`;
      default: return `<p>${text}</p>`;
    }
  }).join('\n');
}

export function journalToHtml(entries: ExportableEntry[], exportedOn: string): string {
  const items = oldestFirst(entries).map((e) => {
    const meta = [feelings(e.analysis).join(', '), e.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).map(escapeHtml).join(' · ');
    return `<article><h2>${escapeHtml(longDate(e.dateKey))}</h2>${e.prompt ? `<p class="prompt">${escapeHtml(e.prompt)}</p>` : ''}${bodyHtml(e.body)}${meta ? `<p class="meta">${meta}</p>` : ''}</article>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Georgia,'Times New Roman',serif;color:#1C2333;margin:40px 48px;line-height:1.55;font-size:13pt}
h1{font-weight:400;font-size:26pt;margin:0 0 4px}.sub{color:#6B7080;font-family:Helvetica,Arial,sans-serif;font-size:10pt;margin:0 0 28px}
article{page-break-inside:avoid;border-top:1px solid #E8E0D4;padding-top:18px;margin-top:18px}
h2{font-weight:400;font-size:15pt;margin:0 0 8px;color:#2C8F7B}.prompt{font-style:italic;color:#555C6B}
h3.t{font-size:18pt;font-weight:400;margin:8px 0}h4{font-size:15pt;font-weight:400;margin:8px 0}h5{font-size:12pt;margin:8px 0}
blockquote{border-left:3px solid #E8956B;margin:8px 0;padding-left:12px;font-style:italic;color:#555C6B}p{margin:0 0 6px}.gap{height:6px}
.meta{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;color:#6B7080;margin-top:10px}
</style></head><body><h1>My WellTrack journal</h1><p class="sub">Exported ${escapeHtml(longDate(exportedOn))} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</p>
${items}</body></html>`;
}

export type ExportFormat = 'pdf' | 'text';

/** Builds the file and opens the share sheet. Returns false when sharing isn't available. */
export async function shareJournal(entries: ExportableEntry[], format: ExportFormat, today: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  if (format === 'pdf') {
    // Ask for the bytes and write our own file: the share sheet (and Expo Go) can't always read print's output path.
    const { base64 } = await Print.printToFileAsync({ html: journalToHtml(entries, today), base64: true });
    if (!base64) throw new Error('The PDF could not be created.');
    const pdf = new File(Paths.cache, `welltrack-journal-${today}.pdf`);
    if (pdf.exists) pdf.delete();
    pdf.create();
    await pdf.write(base64, { encoding: 'base64' });
    await Sharing.shareAsync(pdf.uri,{ mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Export journal' });
  } else {
    const file = new File(Paths.cache, `welltrack-journal-${today}.md`);
    if (file.exists) file.delete();
    file.create();
    await file.write(journalToMarkdown(entries, today));
    await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown', dialogTitle: 'Export journal' });
  }
  return true;
}
