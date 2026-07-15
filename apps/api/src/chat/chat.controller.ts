import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ChatService } from './chat.service';
import { CreateChatDto, SendMessageDto } from './dto';

const ALL = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'] as const;

@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get()
  @Roles(...ALL)
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @Post()
  @Roles(...ALL)
  create(@Body() dto: CreateChatDto, @CurrentUser() user: RequestUser) {
    return this.service.create(user, dto.title);
  }

  @Get(':id')
  @Roles(...ALL)
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(id, user);
  }

  @Post(':id/message')
  @Roles(...ALL)
  send(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SendMessageDto, @CurrentUser() user: RequestUser) {
    return this.service.send(id, user, dto.text);
  }

  @Delete(':id')
  @Roles(...ALL)
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.delete(id, user);
  }
}
