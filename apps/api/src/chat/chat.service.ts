import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDateStr } from '../common/tashkent-time';
import type { RequestUser } from '../common/scoping';
import { SMARTBLOK_KNOWLEDGE, sessionContext } from './knowledge';
import { ChatToolsService } from './tools';

/**
 * Necha marta «tool chaqir → natijani ber → yana o'yla» aylanishiga ruxsat beramiz.
 * Murakkab savol ham odatda 3-4 tool bilan yopiladi; bu shift cheksiz halqadan
 * himoya (har aylanish alohida API so'rovi va alohida pul).
 */
const MAX_TOOL_ROUNDS = 6;

/** Bitta tool natijasining shifti — kontekstni bosib ketmasligi uchun. */
const MAX_TOOL_RESULT_CHARS = 20_000;

type Msg = Anthropic.MessageParam;

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);
  /**
   * Standart model — Sonnet 5.
   *
   * Ilgari bu Haiku 4.5 edi va yordamchi shunchaki suhbatlashardi. Endi u pul
   * raqamlari ustida KO'P BOSQICHLI tool ishlatadi, va shu ishda Haiku jonli
   * sinovda sezilarli adashdi: «kimga eng ko'p pul o'tkazganmiz?» degan savolga
   * noto'g'ri tool'larni chaqirib, chalkash javob berdi; aniqlashtirish savolida
   * esa bazada YO'Q zavod nomini o'ylab topdi. Sonnet 5 aynan o'sha savollarga
   * to'g'ri va toza javob berdi. Pul haqidagi javobda xato narxi arzonlikdan
   * qimmat, shuning uchun standart shu.
   *
   * Arzonroq kerak bo'lsa .env da ANTHROPIC_MODEL=claude-haiku-4-5 — kod
   * o'zgarmaydi (kuchliroq: claude-opus-5).
   */
  private readonly model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ChatToolsService,
  ) {}

  get aiEnabled(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /** The user's saved conversations, newest first, with message counts. */
  list(user: RequestUser) {
    return this.prisma.chatConversation.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
  }

  /** One conversation with its full message thread (owner only). */
  async get(id: string, user: RequestUser) {
    const c = await this.prisma.chatConversation.findFirst({
      where: { id, userId: user.userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Suhbat topilmadi');
    return c;
  }

  create(user: RequestUser, title?: string) {
    return this.prisma.chatConversation.create({ data: { userId: user.userId ?? null, title: title?.trim() || 'Yangi suhbat' } });
  }

  async delete(id: string, user: RequestUser) {
    const c = await this.prisma.chatConversation.findFirst({ where: { id, userId: user.userId } });
    if (!c) throw new NotFoundException('Suhbat topilmadi');
    await this.prisma.chatConversation.delete({ where: { id } }); // cascade removes messages
    return { ok: true };
  }

  /** Send a user message, get Claude's reply, persist both, return them. */
  async send(id: string, user: RequestUser, text: string) {
    const conv = await this.get(id, user); // verifies ownership + loads history
    const userMsg = await this.prisma.chatMessage.create({ data: { conversationId: id, role: 'user', content: text } });

    const history: Msg[] = [...conv.messages, userMsg].map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    }));

    let reply: string;
    let usedTools: string[] = [];
    if (!this.aiEnabled) {
      reply = 'AI sozlanmagan — server .env faylida ANTHROPIC_API_KEY ni to‘ldiring.';
    } else {
      try {
        const answer = await this.answer(history, user);
        reply = answer.text;
        usedTools = answer.usedTools;
      } catch (e) {
        this.log.warn(`chat AI error: ${(e as Error).message}`);
        reply = this.friendlyError(e);
      }
    }

    const assistantMsg = await this.prisma.chatMessage.create({ data: { conversationId: id, role: 'assistant', content: reply } });

    // first user message becomes the title; always bump updatedAt
    const title = conv.messages.length === 0 ? text.slice(0, 48) : undefined;
    await this.prisma.chatConversation.update({ where: { id }, data: { updatedAt: new Date(), ...(title ? { title } : {}) } });

    // `usedTools` is per-turn telemetry for the UI («qaysi ma'lumotdan olindi») — it is
    // deliberately NOT persisted: a reloaded thread shows the answer, not the plumbing.
    return { userMessage: userMsg, assistantMessage: assistantMsg, usedTools };
  }

  // ───────────────────────── the agentic loop ─────────────────────────

  /**
   * Tool-use halqasi: model tool so'rasa — uni ishlatib, natijani qaytaramiz va yana
   * so'raymiz; `end_turn` bo'lguncha (yoki shift tugaguncha) davom etadi.
   *
   * Kesh (prompt caching) prefiks mosligiga qurilgan, shuning uchun tartib muhim:
   * tools → system → messages. Tool ro'yxati ham, bilim bloki ham HAR SO'ROVDA bir xil
   * baytlar bo'ladi; sana/rol kabi o'zgaruvchan kontekst esa kesh chegarasidan KEYIN,
   * ikkinchi system blokida turadi — aks holda har kun kesh nolga tushardi.
   */
  private async answer(history: Msg[], user: RequestUser): Promise<{ text: string; usedTools: string[] }> {
    const client = new Anthropic();
    const tools = this.tools.specs(user.role);
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SMARTBLOK_KNOWLEDGE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: sessionContext(user, tashkentDateStr(new Date())) },
    ];

    const messages: Msg[] = [...history];
    const usedTools: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await client.messages.create({
        model: this.model,
        max_tokens: 4000,
        system,
        tools,
        messages,
      });

      if (res.stop_reason !== 'tool_use') {
        const text = this.textOf(res);
        return {
          text:
            text ||
            (res.stop_reason === 'max_tokens'
              ? 'Javob juda uzun bo‘lib ketdi. Savolni biroz toraytirib qayta so‘rang.'
              : 'Javob bo‘sh chiqdi — savolni boshqacha ifodalab ko‘ring.'),
          usedTools,
        };
      }

      // The assistant turn MUST go back verbatim — it carries the tool_use blocks the
      // results are matched against by id.
      messages.push({ role: 'assistant', content: res.content });

      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      // Parallel calls come back in ONE assistant turn and their results must go back in
      // ONE user turn — splitting them teaches the model to stop calling in parallel.
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        calls.map(async (call) => {
          usedTools.push(call.name);
          try {
            const data = await this.tools.run(call.name, (call.input ?? {}) as Record<string, unknown>, user);
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              content: this.clip(JSON.stringify(data)),
            };
          } catch (e) {
            // A failed tool comes back as an error RESULT, never as a dropped block:
            // the model needs it to change approach, and a missing tool_result is a 400.
            this.log.warn(`chat tool ${call.name} failed: ${(e as Error).message}`);
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              content: `Xatolik: ${(e as Error).message}`,
              is_error: true,
            };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }

    return {
      text:
        'Savolga javob berish uchun juda ko‘p ma’lumot kerak bo‘ldi va men chegaraga yetdim. ' +
        'Iltimos, savolni kichikroq qismlarga bo‘lib so‘rang (masalan bitta zavod yoki bitta davr uchun).',
      usedTools,
    };
  }

  private textOf(res: Anthropic.Message): string {
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }

  private clip(s: string): string {
    return s.length <= MAX_TOOL_RESULT_CHARS
      ? s
      : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(natija qisqartirildi — so‘rovni toraytiring)`;
  }

  /** Typed SDK errors → a sentence the owner can act on, instead of a stack trace. */
  private friendlyError(e: unknown): string {
    if (e instanceof Anthropic.AuthenticationError) {
      return 'AI kaliti noto‘g‘ri yoki eskirgan — server .env faylidagi ANTHROPIC_API_KEY ni tekshiring.';
    }
    if (e instanceof Anthropic.RateLimitError) {
      return 'AI hozir band (so‘rovlar chegarasi). Bir daqiqadan keyin qayta urinib ko‘ring.';
    }
    if (e instanceof Anthropic.NotFoundError) {
      return `AI modeli topilmadi: «${this.model}». .env faylidagi ANTHROPIC_MODEL qiymatini tekshiring.`;
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return 'AI serveriga ulanib bo‘lmadi — internet aloqasini tekshiring.';
    }
    if (e instanceof Anthropic.APIError) {
      return `AI xatolik qaytardi (${e.status ?? '—'}). Keyinroq urinib ko‘ring.`;
    }
    return 'AI hozir javob bera olmadi (xatolik). Keyinroq urinib ko‘ring.';
  }
}
