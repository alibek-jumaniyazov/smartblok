import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Saved AI chat (Haiku). PrismaService is global; ANTHROPIC_API_KEY drives the model. */
@Module({
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
