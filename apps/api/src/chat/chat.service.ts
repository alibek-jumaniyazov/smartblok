import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/scoping';

const SYSTEM =
  'Siz SmartBlok ERP tizimidagi yordamchi AI assistantsiz — gaz-blok (gazoblok) ' +
  'ulgurji savdosi bilan shug‘ullanuvchi diler uchun. Foydalanuvchiga OʼZBEK tilida (lotin) ' +
  'qisqa, aniq va foydali javob bering. Savol biznes, hisob-kitob, buyurtma, to‘lov yoki ' +
  'poddon haqida bo‘lsa — shu kontekstda javob bering. Bilmasangiz, taxmin qilmang.';

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);
  private readonly model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  constructor(private readonly prisma: PrismaService) {}

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

    const history = [...conv.messages, userMsg].map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    }));

    let reply: string;
    if (!this.aiEnabled) {
      reply = 'AI sozlanmagan — server .env faylida ANTHROPIC_API_KEY ni to‘ldiring.';
    } else {
      try {
        const client = new Anthropic();
        const res = await client.messages.create({ model: this.model, max_tokens: 2000, system: SYSTEM, messages: history });
        reply = res.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('').trim() || '(bo‘sh javob)';
      } catch (e) {
        this.log.warn(`chat AI error: ${(e as Error).message}`);
        reply = 'AI hozir javob bera olmadi (xatolik). Keyinroq urinib ko‘ring.';
      }
    }

    const assistantMsg = await this.prisma.chatMessage.create({ data: { conversationId: id, role: 'assistant', content: reply } });

    // first user message becomes the title; always bump updatedAt
    const title = conv.messages.length === 0 ? text.slice(0, 48) : undefined;
    await this.prisma.chatConversation.update({ where: { id }, data: { updatedAt: new Date(), ...(title ? { title } : {}) } });

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  }
}
