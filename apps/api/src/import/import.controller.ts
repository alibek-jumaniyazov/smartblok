import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { ImportService } from './import.service';
import { RollbackDto } from './dto';

// Guards are global (JwtAuthGuard + default-deny RolesGuard); the whole importer
// is ADMIN-only — it writes financial history directly.
@Controller('import')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Roles('ADMIN')
  @Post('excel')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB cap
    }),
  )
  importExcel(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Файл юборилмади (multipart майдони: 'file')");
    }
    // .xlsx is a ZIP container — magic bytes PK
    if (!(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b)) {
      throw new BadRequestException('Файл .xlsx форматида эмас');
    }
    const isDryRun = dryRun === 'true' || dryRun === '1';
    return this.service.importExcel(file.buffer, file.originalname || 'import.xlsx', isDryRun, user);
  }

  @Roles('ADMIN')
  @Get('batches')
  listBatches() {
    return this.service.listBatches();
  }

  @Roles('ADMIN')
  @Get('batches/:id/reconciliation')
  reconciliation(@Param('id') id: string) {
    return this.service.reconciliation(id);
  }

  @Roles('ADMIN')
  @Delete('batches/:id')
  rollback(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RollbackDto) {
    return this.service.rollback(id, dto.confirm, user);
  }
}
