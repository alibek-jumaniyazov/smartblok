import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { PalletService } from './pallets.service';
import {
  ChargeLostDto,
  ClientReturnDto,
  FactoryReturnDto,
  PalletTxQueryDto,
  ReversePalletTxDto,
} from './dto';

@Controller('pallets')
export class PalletsController {
  constructor(private readonly pallets: PalletService) {}

  @Get('balances')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  balances(@CurrentUser() user: RequestUser) {
    return this.pallets.balances(user);
  }

  @Get('transactions')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  transactions(@Query() q: PalletTxQueryDto, @CurrentUser() user: RequestUser) {
    return this.pallets.transactions(q, user);
  }

  /**
   * AGENT ham yozadi (egasi qoidasi, 2026-07-30): paddonni maydonda mijozdan aynan agent
   * qabul qiladi, shuning uchun qaytarishni ham u kiritadi. Qamrov servisda: `assertOwnAgent`
   * begona mijozni 403 qiladi — agent faqat O'Z mijozining hisobiga tegadi.
   *
   * Qolgan ikkitasi A/B da QOLADI va bu ataylab: `factory-return` butun kompaniyaning
   * zavod oldidagi hisobdorligini va umumiy zaxirani kamaytiradi, `charge-lost` esa
   * mijozga PUL qarzi yozadi — ikkalasi ham agentning ish maydoni emas.
   */
  @Post('client-return')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  clientReturn(@Body() dto: ClientReturnDto, @CurrentUser() user: RequestUser) {
    return this.pallets.recordClientReturn(dto, user);
  }

  /**
   * Mijoz tomonidagi paddon harakatining stornosi — «Mijoz qaytardi» VA «Yo'qotilganini
   * undirish» qatorlari uchun. Hard-delete YO'Q — kompensatsiya qatori yoziladi (kassa
   * `POST /kassa/transactions/:id/reverse` bilan bir xil shakl).
   *
   * Darvozada uchala rol turadi, chunki QAYTARISHNI agent ham bekor qiladi: kim yozgan
   * bo'lsa, o'sha tuzatadi ham. Agentni faqat yozishga qo'yib, xatosini tuzatishni ofisga
   * tashlash uni har safar telefon qilishga majbur qilardi.
   *
   * UNDIRISHNI bekor qilish esa mijozning PUL qarzini kamaytiradi — uni servis A·B bilan
   * cheklaydi (`charge-lost` ning o'zi ham A·B da). Qamrov ham servisda: `assertOwnAgent`
   * begona mijozning qatorini 403 qiladi. Ikkalasi ham shu yerda emas, servisda — chunki
   * qaror QATOR TURIGA bog'liq va uni faqat qatorni o'qib bilib bo'ladi.
   */
  @Post('transactions/:id/reverse')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  reverseClientMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePalletTxDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.pallets.reverseClientMovement(id, dto, user);
  }

  @Post('factory-return')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryReturn(@Body() dto: FactoryReturnDto, @CurrentUser() user: RequestUser) {
    return this.pallets.returnToFactory(dto, user.userId);
  }

  @Post('charge-lost')
  @Roles('ADMIN', 'ACCOUNTANT')
  chargeLost(@Body() dto: ChargeLostDto, @CurrentUser() user: RequestUser) {
    return this.pallets.chargeLost(dto, user.userId);
  }
}
