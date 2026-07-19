import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post,
  Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportRowKind } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ImportService } from './import.service';
import { CommitDto, PatchRowDto, PreviewDto, ResolveEntityDto, ResolveIssueDto } from './dto';

// multer's Express.Multer.File typing needs @types/multer (not installed); type inline.
type UploadedXlsx = { buffer: Buffer; originalname: string; size: number };
const MAX_BYTES = 10 * 1024 * 1024;

@Controller('import')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Post('upload')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: UploadedXlsx, @CurrentUser() user: RequestUser) {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    if (file.size > MAX_BYTES) throw new BadRequestException('Fayl 10 MB dan katta');
    return this.service.uploadAndStage(file.buffer, file.originalname, user);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getBatch(id);
  }

  @Get(':id/rows')
  @Roles('ADMIN', 'ACCOUNTANT')
  rows(@Param('id', new ParseUUIDPipe()) id: string, @Query('kind') kind?: ImportRowKind) {
    return this.service.listRows(id, kind);
  }

  @Get(':id/issues')
  @Roles('ADMIN', 'ACCOUNTANT')
  issues(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.listIssues(id);
  }

  @Get(':id/entities')
  @Roles('ADMIN', 'ACCOUNTANT')
  entities(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.listEntities(id);
  }

  @Patch(':id/rows/:rowId')
  @Roles('ADMIN')
  patchRow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('rowId', new ParseUUIDPipe()) rowId: string,
    @Body() dto: PatchRowDto,
  ) {
    return this.service.patchRow(id, rowId, dto.patch);
  }

  @Post(':id/issues/:issueId/resolve')
  @Roles('ADMIN')
  resolveIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Body() dto: ResolveIssueDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.resolveIssue(id, issueId, dto, user);
  }

  @Post(':id/entities/:mapId/resolve')
  @Roles('ADMIN')
  resolveEntity(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('mapId', new ParseUUIDPipe()) mapId: string,
    @Body() dto: ResolveEntityDto,
  ) {
    return this.service.resolveEntity(id, mapId, dto.name);
  }

  @Post(':id/preview')
  @Roles('ADMIN', 'ACCOUNTANT')
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PreviewDto) {
    return this.service.preview(id, dto?.mode ?? 'APPEND');
  }

  @Post(':id/commit')
  @Roles('ADMIN')
  commit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CommitDto, @CurrentUser() user: RequestUser) {
    return this.service.commit(id, dto.confirmToken, user, dto.mode ?? 'APPEND');
  }

  @Post(':id/rollback')
  @Roles('ADMIN')
  rollback(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.service.rollback(id, user);
  }
}
