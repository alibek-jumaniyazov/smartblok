import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ImportIssueSeverity as Sev } from '@prisma/client';
import type { Finding, RuleContext } from './rule-registry';

/**
 * Optional AI "second opinion" over the staged data (Claude Haiku 4.5 — the
 * low-cost tier the owner chose). It is NOT the primary check: the deterministic
 * rule engine already catches the known anomalies. This pass looks for things the
 * rules don't anticipate and explains them in Uzbek. It can NEVER raise a BLOCK —
 * only the deterministic rules gate the commit; the AI is advisory (CONFIRM/WARN/INFO).
 * With no ANTHROPIC_API_KEY set, it returns nothing and the import proceeds normally.
 */
@Injectable()
export class AiReviewService {
  private readonly log = new Logger(AiReviewService.name);

  get enabled(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async review(ctx: RuleContext, alreadyFlagged: Finding[]): Promise<Finding[]> {
    if (!this.enabled) return [];
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

    const flaggedSet = new Set(alreadyFlagged.map((f) => `${f.origin.sheetName}|${f.origin.excelRow}|${f.ruleId}`));

    const payload = {
      shipments: ctx.shipments.map((r) => ({
        sheet: r.origin.sheetName, row: r.origin.excelRow, client: r.clientRaw, agent: r.agentRaw,
        date: r.date?.toISOString().slice(0, 10) ?? null, size: r.size, cube: r.cube,
        costPrice: r.costPrice?.toNumber() ?? null, salePrice: r.salePrice?.toNumber() ?? null,
        saleSum: r.saleSum?.toNumber() ?? null, palletQty: r.palletQty,
        transport: r.transport?.toNumber() ?? null, transportWord: r.transportWord,
      })),
      clientPayments: ctx.clientPayments.map((p) => ({
        sheet: p.origin.sheetName, row: p.origin.excelRow, agent: p.agentRaw, client: p.clientRaw,
        date: p.date?.toISOString().slice(0, 10) ?? null,
        payer: p.payer, total: p.total?.toNumber() ?? null, palletReturn: p.palletReturn,
      })),
      factoryPayments: ctx.factoryPayments.map((f) => ({
        sheet: f.origin.sheetName, row: f.origin.excelRow,
        date: f.date?.toISOString().slice(0, 10) ?? null, amount: f.amount?.toNumber() ?? null,
      })),
      alreadyCaughtRules: [...new Set(alreadyFlagged.map((f) => f.ruleId))],
    };

    // the origin sheets actually present in this workbook (journal + agent sheets)
    const sheetNames = [...new Set([
      ...ctx.shipments.map((r) => r.origin.sheetName),
      ...ctx.clientPayments.map((p) => p.origin.sheetName),
      ...ctx.factoryPayments.map((f) => f.origin.sheetName),
    ])];
    if (!sheetNames.length) return [];

    const schema = {
      type: 'object', additionalProperties: false, required: ['findings'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['sheet', 'excelRow', 'severity', 'concern', 'messageUz'],
            properties: {
              sheet: { type: 'string', enum: sheetNames },
              excelRow: { type: 'integer' },
              severity: { type: 'string', enum: ['CONFIRM', 'WARN', 'INFO'] },
              concern: { type: 'string' }, // short kebab slug
              messageUz: { type: 'string' }, // full Uzbek sentence
            },
          },
        },
      },
    };

    const system =
      'Siz gaz-blok dilerining Excel’dan import qilinayotgan hisob-kitobini tekshiruvchi ' +
      'yordamchisiz. Kitob tuzilishi: bitta JURNAL varag‘i (har qator — bitta mashina yetkazmasi: agent, ' +
      'mijoz, kub, narxlar, poddon, transport) va har bir AGENT uchun alohida daftar varag‘i (mijoz bloklari: ' +
      'to‘lovlar va yetkazmalar). Deterministik qoidalar allaqachon ma’lum xatolarni topgan (alreadyCaughtRules). ' +
      'Sizning vazifangiz — o‘sha qoidalar SEZMAGAN shubhali qatorlarni topish: g‘ayritabiiy ustama/marja, ' +
      'mantiqsiz miqdor (m³/poddon), to‘lovchi bilan mijoz mos kelmasligi, takrorlangan yoki chetlab ketgan ' +
      'qatorlar. Har bir topilma uchun aniq varaq+qatorni ko‘rsating va sababini O‘ZBEKCHA (lotin) bir gapda ' +
      'tushuntiring. Hech qachon BLOCK darajasini bermang — faqat CONFIRM/WARN/INFO. Ishonchingiz komil ' +
      'bo‘lmasa, qo‘shmang. Allaqachon topilgan qatorlarni takrorlamang.';

    try {
      // output_config (structured outputs) may be newer than the installed SDK
      // types — build params loosely and narrow the result.
      const params: Record<string, unknown> = {
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        output_config: { format: { type: 'json_schema', schema } },
      };
      const res = (await client.messages.create(params as any)) as Anthropic.Message;

      const text = res.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
      const parsed = JSON.parse(text) as { findings: Array<{ sheet: string; excelRow: number; severity: keyof typeof Sev; concern: string; messageUz: string }> };

      return (parsed.findings ?? [])
        .filter((f) => !flaggedSet.has(`${f.sheet}|${f.excelRow}|AI_${f.concern}`))
        .map((f): Finding => ({
          ruleId: `AI_${f.concern}`,
          severity: Sev[f.severity] ?? Sev.INFO,
          origin: { sheetName: f.sheet, excelRow: f.excelRow },
          message: `🤖 ${f.messageUz}`,
        }));
    } catch (e) {
      this.log.warn(`AI review skipped: ${(e as Error).message}`);
      return []; // AI is best-effort — never block the import on it
    }
  }
}
