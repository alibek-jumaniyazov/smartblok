import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { KassaService } from '../kassa/kassa.service';
import { PalletService } from '../pallets/pallets.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { RequestUser } from '../common/scoping';
import { parseTashkentFrom, parseTashkentTo } from '../common/tashkent-time';
import { cyr } from '../common/translit';
import { Book } from './xlsx/book';
import { ROLES } from './xlsx/labels';
import { formatDate, formatDateTime, writeContents, writeCover } from './sheets/cover';
import { writeSummary } from './sheets/summary';
import { writeReconciliation } from './sheets/reconciliation';
import { writeAgents, writeClients, writeFactories, writeVehicles } from './sheets/parties';
import { writeAllocations, writePayments } from './sheets/payments';
import { cashTotals, writeCashBridge, writeCashJournal, writeCashboxes } from './sheets/kassa';
import { writeBonusTransactions, writeBonusWallets, writeExpenses } from './sheets/bonus';
import { writeOrderItems, writeOrders, writePalletSummary, writePalletTransactions } from './sheets/operations';
import {
  writeClientPrices,
  writeImportBatches,
  writeProductPrices,
  writeProducts,
  writeReference,
  writeUsers,
} from './sheets/catalog';
import { writeAudit, writeLedger } from './sheets/ledger';
import type { Ctx, Window } from './sheets/ctx';
import type { ExportQueryDto } from './dto';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pallets: PalletService,
    private readonly kassa: KassaService,
    private readonly settings: SettingsService,
    private readonly dashboard: DashboardService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Butun biznesni bitta .xlsx ga yig'adi.
   *
   * Ma'lumot HAR DOIM to'g'ridan-to'g'ri Prisma'dan olinadi, HTTP ro'yxat
   * endpointlari orqali emas: ular sahifa hajmini 200 tada qotirib qo'yadi va to'liq
   * damp jimgina kesilib qolardi.
   *
   * Varaqlar tartibi ataylab shunday: muqova → mundarija → xulosa → solishtirma →
   * balanslar → pul → operatsiyalar → ma'lumotnomalar → xom yozuvlar. Ya'ni umumiydan
   * xususiyga: faylni ochgan odam avval «biznes qanday turibdi» ni ko'radi, keyin
   * xohlasa har bir yozuvgacha tushadi.
   */
  async buildWorkbook(
    query: ExportQueryDto,
    user: RequestUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const startedAt = Date.now();
    const window = resolveWindow(query);
    const book = new Book(user.name);

    const ctx: Ctx = {
      book,
      prisma: this.prisma,
      ledger: this.ledger,
      pallets: this.pallets,
      kassa: this.kassa,
      settings: this.settings,
      window,
      periodLabel: cyr(
        window
          ? `Tanlangan davr: ${formatDate(window.gte)} — ${formatDate(new Date(window.lt.getTime() - 1))}`
          : 'Butun davr — bazadagi hamma yozuv',
      ),
    };

    // ── varaqlardan OLDIN kerak bo'ladigan raqamlar ──
    // Kassa jamlari xulosa varag'ida ishlatiladi, lekin kassa varag'i kitobda undan
    // KEYIN turadi; shuning uchun ma'lumot oldindan olinadi va varaq yozuvchiga
    // uzatiladi (ikkinchi marta o'qilmaydi).
    const [boxes, summary, counts] = await Promise.all([
      this.kassa.cashboxes(),
      this.dashboard.summary(user, window ? { from: query.from, to: query.to } : undefined),
      this.loadCounts(),
    ]);
    const cash = cashTotals(boxes);
    const summaryInput = {
      summary,
      cash,
      window: window && query.from && query.to ? { from: query.from, to: query.to } : null,
      counts,
    };

    // ── 1–2: muqova va mundarija (birinchi yorliqlar, oxirida to'ldiriladi) ──
    const coverWs = book.sheet('cover', {
      tab: 'Muqova',
      title: 'Muqova',
      desc: 'Hujjat haqida maʼlumot va raqamlarni oʼqish qoidalari.',
    });
    const contentsWs = book.sheet('cover', {
      tab: 'Mundarija',
      title: 'Mundarija',
      desc: 'Barcha varaqlar roʼyxati va ularga havolalar.',
    });

    // ── 3: umumiy ko'rsatkichlar ──
    const summaryWs = book.sheet('kpi', {
      tab: 'Umumiy koʼrsatkichlar',
      title: 'Umumiy koʼrsatkichlar',
      desc: 'Sof foyda, pul oqimi, qoldiqlar va paddon — saytdagi bosh sahifa bilan bir xil raqamlar.',
    });
    book.count(summaryWs, writeSummary(summaryWs, summaryInput));

    // ── 4: solishtirma ──
    await writeReconciliation(ctx, summaryInput, cash);

    // ── 5–8: balanslar ──
    await writeClients(ctx);
    await writeAgents(ctx);
    await writeFactories(ctx);
    await writeVehicles(ctx);

    // ── 9–16: pul ──
    await writePayments(ctx);
    await writeAllocations(ctx);
    await writeCashboxes(ctx, boxes);
    await writeCashJournal(ctx);
    await writeCashBridge(ctx);
    await writeBonusWallets(ctx);
    await writeBonusTransactions(ctx);
    await writeExpenses(ctx);

    // ── 17–20: operatsiyalar ──
    await writeOrders(ctx);
    await writeOrderItems(ctx);
    await writePalletSummary(ctx);
    await writePalletTransactions(ctx);

    // ── 21–26: ma'lumotnomalar ──
    await writeProducts(ctx);
    await writeProductPrices(ctx);
    await writeClientPrices(ctx);
    await writeUsers(ctx);
    await writeReference(ctx);

    // ── 27–29: xom yozuvlar ──
    await writeLedger(ctx);
    await writeAudit(ctx);
    await writeImportBatches(ctx);

    // ── muqova + mundarija: endi qator sonlari ma'lum ──
    const generatedAt = new Date();
    writeCover(
      coverWs,
      {
        generatedAt,
        author: user.name,
        authorRole: ROLES[user.role] ? cyr(ROLES[user.role]) : user.role,
        periodLabel: ctx.periodLabel,
        dataRangeLabel: summary.dataRange
          ? `${summary.dataRange.from} — ${summary.dataRange.to}`
          : cyr("Buyurtma yoʼq"),
      },
      book,
    );
    writeContents(contentsWs, book);

    const buffer = await book.toBuffer();
    const filename = `${cyr('{SmartBlok} — toʼliq eksport')} ${formatDate(generatedAt)}.xlsx`;

    const rows = book.entries.reduce((a, e) => a + e.rows, 0);
    this.logger.log(
      `export xlsx: ${book.entries.length} sheets, ${rows} rows, ${(buffer.length / 1024).toFixed(0)} KB, ${Date.now() - startedAt} ms`,
    );

    // Tranzaksiyadan tashqarida — yozilmasa ham yuklab olishni buzmaydi.
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.EXPORT,
      entity: 'Export',
      note: `Excel eksport: ${book.entries.length} varaq, ${rows} qator, davr: ${query.from ?? 'boshidan'} — ${query.to ?? 'hozirgacha'}`,
      after: { sheets: book.entries.length, rows, bytes: buffer.length, from: query.from ?? null, to: query.to ?? null },
    });

    void formatDateTime;
    return { buffer, filename };
  }

  /** Muqova va xulosa varaqlaridagi «nechta mijoz / zavod / …» raqamlari. */
  private async loadCounts(): Promise<Record<string, number>> {
    const [clients, agents, factories, vehicles, products, payments] = await Promise.all([
      this.prisma.client.count(),
      this.prisma.agent.count(),
      this.prisma.factory.count(),
      this.prisma.vehicle.count(),
      this.prisma.product.count(),
      this.prisma.payment.count(),
    ]);
    return { clients, agents, factories, vehicles, products, payments };
  }
}

/**
 * from/to (YYYY-MM-DD, Toshkent kunlari) → UTC oynasi.
 *
 * Yuqori chegara KEYINGI kunning yarim tuni, ya'ni `to` kunning o'zi to'liq kiradi.
 * Ikkalasi ham bo'sh bo'lsa — butun baza. Faqat bittasi berilsa, ikkinchi tomon ochiq
 * qoladi (masalan «1-iyundan hozirgacha»).
 */
function resolveWindow(q: ExportQueryDto): Window | null {
  const gte = parseTashkentFrom(q.from);
  const lt = parseTashkentTo(q.to);
  if (!gte && !lt) return null;
  return {
    gte: gte ?? new Date(0),
    // ochiq yuqori chegara — «kelajakdagi sanali» yozuvlar ham tushib qolmasin
    lt: lt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  };
}
