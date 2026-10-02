import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { AgentsService } from './agents.service';
import { AgentKpiQueryDto, AgentKpiSettingsDto, CreateAgentDto, UpdateAgentDto } from './dto';
import { AgentKpiService } from './agent-kpi.service';

@Controller('agents')
export class AgentsController {
  constructor(private service: AgentsService, private kpi: AgentKpiService) {}

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT')
  list() {
    return this.service.list();
  }

  // declared before ':id' so the literal path wins route matching
  @Get('me')
  @Roles('AGENT')
  me(@CurrentUser() user: RequestUser) {
    return this.service.me(user);
  }

  @Get('kpi')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  report(@Query() query: AgentKpiQueryDto, @CurrentUser() user: RequestUser) {
    return this.kpi.report(query, user);
  }

  @Put('kpi/settings')
  @Roles('ADMIN')
  updateKpiSettings(@Body() dto: AgentKpiSettingsDto, @CurrentUser() user: RequestUser) {
    return this.kpi.updateSettings(dto, user);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.detail(id, user);
  }

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT')
  create(@Body() dto: CreateAgentDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}
