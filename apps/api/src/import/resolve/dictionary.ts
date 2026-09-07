import { norm } from './normalize';
import { matchName } from './matcher';
import type { MasterData } from '../parse/types';

/**
 * ═══════ AYNIYAT — SPRAVOCHNIK BO'YICHA («Кўрсаткичлар») ═══════
 *
 * ┌ NIMA O'ZGARDI ┐
 * Eski shablonda mijozning kim ekani TAXMIN qilinardi: nomlar bir necha varaqda har xil
 * yozilgan («Жаср Версал» / «Жасур Версал»), va import ularni fuzzy moslashtirish bilan
 * birlashtirishga urinardi. Har yuklashda egasi o'nlab nomni qo'lda tasdiqlashi kerak edi,
 * xato bo'lsa esa ikki mijozning balansi qo'shilib ketardi.
 *
 * Yangi faylda javob EGASINING O'ZIDA: «Кўрсаткичлар» varag'ida har mijoz uchun rasmiy nom,
 * ikkita yozilish varianti, eski daftardagi kaliti va biriktirilgan AGENT yozilgan. Shuning
 * uchun bu modul avvalo LUG'ATGA qaraydi va faqat lug'atda umuman yo'q nom uchun fuzzy
 * taklif beradi — u ham qaror emas, egasiga ko'rsatiladigan TAKLIF.
 *
 * ┌ NEGA «нормаллаштирилган» bosqich ham bor ┐
 * Lug'at ham qo'lda yoziladi: bitta nom varaqda «Одилбек Ера хоус», lug'atda «Одилбек ога
 * Эра хоус» bo'lishi mumkin. `norm()` ikkalasini bitta kalitga keltiradi (translit + ё/е,
 * х/ҳ, қ/к, ў/у yig'ilishi), shuning uchun bunday farq savol tug'dirmaydi. Aynan bu qadam
 * etalon faylda «справочникда йўқ ном» ni NOLGA tushiradi.
 */

export type ResolveVia = 'official' | 'variant' | 'legacy' | 'normalized' | 'fuzzy' | 'unknown';

export interface ClientResolution {
  raw: string;
  /** справочникdagi RASMIY nom — daftar’ga shu yoziladi. `null` — lug'atda topilmadi. */
  canonical: string | null;
  /** справочник biriktirgan agent (E ustuni) */
  agentName: string | null;
  via: ResolveVia;
  /** faqat `via === 'fuzzy' | 'unknown'` da — egasiga ko'rsatiladigan taklif */
  suggestion?: { name: string; confidence: number; reason: string };
}

/** Fuzzy taklif shu darajadan past bo'lsa umuman ko'rsatilmaydi (chalg'itadi). */
const FUZZY_FLOOR = 0.55;

export class Dictionary {
  private readonly byExact = new Map<string, string>(); // xom yozuv → rasmiy nom
  private readonly byKey = new Map<string, string>(); // norm kaliti → rasmiy nom
  private readonly agentOf = new Map<string, string>(); // rasmiy nom → agent
  private readonly officialNames: string[] = [];

  private readonly agentByKey = new Map<string, string>();
  private readonly factoryByKey = new Map<string, string>();

  private constructor(master: MasterData) {
    for (const c of master.clients) {
      const official = c.officialName.trim();
      if (!official) continue;
      this.officialNames.push(official);
      if (c.agentName.trim()) this.agentOf.set(official, c.agentName.trim());

      // Rasmiy nom BIRINCHI yoziladi va keyingi yozuvlar uni BOSMAYDI: ikki mijoz bir xil
      // variant yozgan bo'lsa (справочникdagi yozuv xatosi), rasmiy nom har doim ustun.
      for (const alias of [official, ...c.variants, c.legacyKey]) {
        const a = alias.trim();
        if (!a) continue;
        if (!this.byExact.has(a)) this.byExact.set(a, official);
        const k = norm(a).key;
        if (k && !this.byKey.has(k)) this.byKey.set(k, official);
      }
    }
    for (const a of master.agents) {
      const k = norm(a).key;
      if (k && !this.agentByKey.has(k)) this.agentByKey.set(k, a.trim());
    }
    for (const f of master.factories) {
      const k = norm(f).key;
      if (k && !this.factoryByKey.has(k)) this.factoryByKey.set(k, f.trim());
    }
  }

  static from(master: MasterData): Dictionary {
    return new Dictionary(master);
  }

  /** Barcha rasmiy nomlar — commit mijozlarni shulardan yaratadi. */
  clients(): string[] {
    return [...this.officialNames];
  }

  agents(): string[] {
    return [...new Set(this.agentByKey.values())];
  }

  factories(): string[] {
    return [...new Set(this.factoryByKey.values())];
  }

  /** Rasmiy nomga biriktirilgan agent. */
  agentForClient(officialName: string): string | null {
    return this.agentOf.get(officialName) ?? null;
  }

  resolveClient(raw: string): ClientResolution {
    const t = (raw ?? '').trim();
    if (!t) return { raw: t, canonical: null, agentName: null, via: 'unknown' };

    const exact = this.byExact.get(t);
    if (exact) {
      return { raw: t, canonical: exact, agentName: this.agentOf.get(exact) ?? null, via: this.viaOf(t, exact) };
    }
    const byKey = this.byKey.get(norm(t).key);
    if (byKey) {
      return { raw: t, canonical: byKey, agentName: this.agentOf.get(byKey) ?? null, via: 'normalized' };
    }

    // Lug'atda yo'q — QAROR QABUL QILMAYMIZ, taklif beramiz. Bu ataylab: lug'at egasining
    // hujjati, unga yangi nom qo'shish ham uning qarori.
    const m = matchName(t, this.officialNames);
    const suggestion =
      m.best && m.score >= FUZZY_FLOOR
        ? { name: m.best, confidence: Number(m.score.toFixed(2)), reason: `o‘xshashlik: ${m.verdict}` }
        : undefined;
    return { raw: t, canonical: null, agentName: null, via: 'unknown', suggestion };
  }

  /** Agent nomi — справочник yozilishiga keltiriladi («Жамол 22-22» har varaqda bir xil). */
  resolveAgent(raw: string): string | null {
    const t = (raw ?? '').trim();
    if (!t) return null;
    return this.agentByKey.get(norm(t).key) ?? null;
  }

  /** Zavod nomi («Коалс» / «Ментора»). */
  resolveFactory(raw: string): string | null {
    const t = (raw ?? '').trim();
    if (!t) return null;
    return this.factoryByKey.get(norm(t).key) ?? null;
  }

  /** Aynan qaysi ustun mos kelgani — review ekranida «nega shunday» degan savolga javob. */
  private viaOf(raw: string, official: string): ResolveVia {
    if (raw === official) return 'official';
    // «Эски варақ» kaliti har doim «{raqam}-{nom}» ko'rinishida — variantdan shu bilan farq qiladi
    return /^\d+\s*-/.test(raw) ? 'legacy' : 'variant';
  }
}
