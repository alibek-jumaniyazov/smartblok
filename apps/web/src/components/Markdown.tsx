// components/Markdown.tsx — AI javoblari uchun KICHIK markdown renderi.
//
// Nega o'z qo'limiz bilan: AI yordamchi javobda jadval va ro'yxat ishlatadi (system
// promptda shunday aytilgan), lekin uni xom matn sifatida ko'rsatsak ekranda «| Zavod |
// Summa |» degan quvurlar chiqadi. Butun boshli markdown kutubxonasi esa bitta chat
// pufagi uchun ortiqcha yuk.
//
// XAVFSIZLIK: bu yerda `dangerouslySetInnerHTML` YO'Q — matn faqat React tugunlariga
// aylantiriladi, shuning uchun modeldan (yoki bazadagi izohdan) kelgan HTML hech qachon
// bajarilmaydi.
//
// Qo'llab-quvvatlanadi: sarlavha (#..###), quvurli jadval, «- » / «1. » ro'yxatlari,
// ```kod``` bloklari, va satr ichida **qalin**, *kursiv*, `kod`. Qolgani — oddiy matn.
import { Fragment, type ReactNode } from 'react';
import { theme } from 'antd';

/** `**qalin**`, `*kursiv*`, `` `kod` `` — satr ichidagi belgilar. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // uchta naqsh bitta regexda: tartib muhim — `kod` avval, ichidagi yulduzcha bezak emas
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-i${i++}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="sb-md__code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => l.trimStart().startsWith('|');
/** «|---|:--:|» ajratgichi — jadval sarlavhasidan keyin keladi va chizilmaydi. */
const isTableDivider = (l: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const { token } = theme.useToken();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── kod bloki ──
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) buf.push(lines[i++]);
      i++; // yopuvchi ```
      blocks.push(
        <pre key={`b${blocks.length}`} className="sb-md__pre">
          {buf.join('\n')}
        </pre>,
      );
      continue;
    }

    // ── jadval ──
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      blocks.push(
        <div key={`b${blocks.length}`} className="sb-md__tablewrap">
          <table className="sb-md__table">
            <thead>
              <tr>
                {head.map((h, hi) => (
                  <th key={hi}>{inline(h, `h${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    // raqam ustunlari o'ngga tekislanadi — pul jadvali shunday o'qiladi
                    <td key={ci} className={/^[\d\s.,+-]+$/.test(c) ? 'num sb-md__td--num' : undefined}>
                      {inline(c, `c${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // ── ro'yxat (belgili yoki raqamli) ──
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered.test(lines[i]) : bullet.test(lines[i]))) {
        const mm = lines[i].match(ordered ? numbered : bullet);
        items.push(mm ? mm[1] : lines[i]);
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={`b${blocks.length}`} className="sb-md__list">
          {items.map((it, ii) => (
            <li key={ii}>{inline(it, `l${blocks.length}-${ii}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    // ── sarlavha ──
    const heading = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <div
          key={`b${blocks.length}`}
          className="sb-md__h"
          style={{ fontSize: heading[1].length === 1 ? 15 : 14, color: token.colorText }}
        >
          {inline(heading[2], `hd${blocks.length}`)}
        </div>,
      );
      i++;
      continue;
    }

    // ── oddiy paragraf: bo'sh satrgacha yig'iladi, ichki satr uzilishlari saqlanadi ──
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isTableRow(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i]) && !lines[i].trimStart().startsWith('```') && !/^\s*#{1,3}\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length) {
      blocks.push(
        <p key={`b${blocks.length}`} className="sb-md__p">
          {para.map((l, li) => (
            <Fragment key={li}>
              {li > 0 ? <br /> : null}
              {inline(l, `p${blocks.length}-${li}`)}
            </Fragment>
          ))}
        </p>,
      );
    } else {
      i++; // bo'sh satr
    }
  }

  return <div className="sb-md">{blocks}</div>;
}
