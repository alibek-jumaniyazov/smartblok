import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../common/scoping';
import { PalletService } from './pallets.service';
import { FactoryPalletShipmentService } from './factory-pallet-shipment.service';
import { DispatchFactoryPalletDto, FactoryPalletArrivalDto, FactoryPalletShipmentQueryDto, InspectFactoryPalletDto, ReturnRejectedPalletDto } from './factory-pallet-shipment.dto';
import {
  ChargeLostDto,
  ClientReturnDto,
  FactoryDefectDto,
  PalletTxQueryDto,
  ReversePalletTxDto,
} from './dto';

@Controller('pallets')
export class PalletsController {
  constructor(private readonly pallets: PalletService, private readonly shipments: FactoryPalletShipmentService) {}

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
   * «Mijozdagi paddon qaysi buyurtmalardan qolgan» (egasi so'rovi, 2026-08-13).
   *
   * O'QISH endpointi, `pallets.view` bilan bir xil ro'yxat (A·B·G): agent o'z mijozining
   * paddon qarzini ko'radi — u paddonni maydonda o'zi yig'adi. Begona mijoz servisda
   * `assertOwnAgent` bilan 403 bo'ladi (mijoz o'qilgandan KEYIN — yo'q mijoz 404 qoladi).
   */
  @Get('clients/:clientId/origins')
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  clientOrigins(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.pallets.clientPalletOrigins(clientId, user);
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
  factoryReturn(@Body() dto: DispatchFactoryPalletDto, @CurrentUser() user: RequestUser) {
    return this.shipments.dispatch(dto, user);
  }

  @Get('factory-shipments')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipments(@Query() query: FactoryPalletShipmentQueryDto) {
    return this.shipments.list(query);
  }

  @Get('factory-shipments/:id')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipment(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipments.detail(id);
  }

  @Post('factory-shipments/:id/arrive')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipmentArrival(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FactoryPalletArrivalDto, @CurrentUser() user: RequestUser) {
    return this.shipments.arrive(id, dto, user);
  }

  @Post('factory-shipments/:id/inspect')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipmentInspection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InspectFactoryPalletDto, @CurrentUser() user: RequestUser) {
    return this.shipments.inspect(id, dto, user);
  }

  @Post('factory-shipments/:id/reverse-arrival')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipmentArrivalReverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReversePalletTxDto, @CurrentUser() user: RequestUser) {
    return this.shipments.reverseArrival(id, dto, user);
  }

  @Post('factory-shipments/:id/return-rejected')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipmentRejectedReturn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnRejectedPalletDto, @CurrentUser() user: RequestUser) {
    return this.shipments.returnRejected(id, dto, user);
  }

  @Post('factory-shipments/:id/cancel')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryShipmentCancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReversePalletTxDto, @CurrentUser() user: RequestUser) {
    return this.shipments.cancel(id, dto, user);
  }

  @Post('inspections/:inspectionId/reverse')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryInspectionReverse(@Param('inspectionId', ParseUUIDPipe) id: string, @Body() dto: ReversePalletTxDto, @CurrentUser() user: RequestUser) {
    return this.shipments.reverseInspection(id, dto, user);
  }

  @Post('charge-lost')
  @Roles('ADMIN', 'ACCOUNTANT')
  chargeLost(@Body() dto: ChargeLostDto, @CurrentUser() user: RequestUser) {
    return this.pallets.chargeLost(dto, user.userId);
  }

  @Post('warehouse-returns/:returnId/reverse')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryWarehouseReturnReverse(@Param('returnId', ParseUUIDPipe) id: string, @Body() dto: ReversePalletTxDto, @CurrentUser() user: RequestUser) {
    return this.shipments.reverseWarehouseReturn(id, dto, user);
  }

  @Post('factory-defect')
  @Roles('ADMIN', 'ACCOUNTANT')
  factoryDefect(@Body() dto: FactoryDefectDto, @CurrentUser() user: RequestUser) {
    return this.pallets.recordFactoryDefect(dto, user);
  }
}
