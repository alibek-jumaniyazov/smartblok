import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as XLSX from 'xlsx';
import { Roles } from '../auth/roles.decorator';
import { OrdersRegisterQueryDto, SvodQueryDto } from './dto';
import { ReportsService } from './reports.service';

// Guards are global (JwtAuthGuard + RolesGuard via APP_GUARD).
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('svod')
  svod(@Query() q: SvodQueryDto) {
    return this.service.svod(q.from, q.to);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('orders-register')
  ordersRegister(@Query() q: OrdersRegisterQueryDto) {
    return this.service.ordersRegister(q);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('orders-register.xlsx')
  async ordersRegisterXlsx(@Query() q: OrdersRegisterQueryDto, @Res() res: Response) {
    const result = await this.service.ordersRegister({ ...q, page: 1, pageSize: 200 } as OrdersRegisterQueryDto);
    // export everything matching the filter, not one page
    const all: unknown[] = [...result.items];
    let page = 2;
    while (all.length < result.total && page < 500) {
      const next = await this.service.ordersRegister({ ...q, page, pageSize: 200 } as OrdersRegisterQueryDto);
      all.push(...next.items);
      page++;
    }
    this.sendXlsx(res, 'orders-register', [{ name: 'Buyurtmalar', rows: all as Record<string, unknown>[] }]);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('svod.xlsx')
  async svodXlsx(@Query() q: SvodQueryDto, @Res() res: Response) {
    const svod = (await this.service.svod(q.from, q.to)) as Record<string, any>;
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = [];
    // flatten: one summary sheet + one sheet per agent block when present
    const summaryRows: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(svod)) {
      if (Array.isArray(value)) continue;
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (v == null || typeof v === 'object') continue;
          summaryRows.push({ section: key, metric: k, value: v });
        }
      } else if (value != null) {
        summaryRows.push({ section: '', metric: key, value });
      }
    }
    sheets.push({ name: 'Svod', rows: summaryRows });
    for (const [key, value] of Object.entries(svod)) {
      if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
        sheets.push({
          name: key.slice(0, 31),
          rows: (value as Record<string, unknown>[]).map((r) => this.flatten(r)),
        });
      }
    }
    this.sendXlsx(res, 'svod', sheets);
  }

  private flatten(row: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(out, this.flatten(v as Record<string, unknown>, `${prefix}${k}.`));
      } else if (!Array.isArray(v)) {
        out[`${prefix}${k}`] = v;
      }
    }
    return out;
  }

  private sendXlsx(res: Response, base: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name || 'Sheet');
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res
      .status(200)
      .setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('content-disposition', `attachment; filename="${base}-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      .send(buf);
  }
}
