import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SettingsService } from '../common/settings.service';
import { SettingsAdminService } from './settings-admin.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { UpdateSettingDto } from './dto';

@Controller('settings')
export class SettingsController {
  constructor(
    private settings: SettingsService,
    private admin: SettingsAdminService,
  ) {}

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get()
  all() {
    return this.settings.all();
  }

  /** ADMIN only; key must be whitelisted (agentDebtLimitDefault, truckCapacityPallets, saleMarginMinPct, palletPriceDefault). */
  @Roles('ADMIN')
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @CurrentUser() user: RequestUser) {
    return this.admin.update(key, dto.value, user);
  }
}
