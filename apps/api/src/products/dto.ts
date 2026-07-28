import { PriceKind } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/** Accepts a positive number or a positive numeric string (money/volume input). */
function IsPositiveNumeric(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isPositiveNumeric',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} musbat son bo'lishi kerak`, ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') return Number.isFinite(value) && value > 0;
          if (typeof value === 'string') {
            return /^\s*\d+(\.\d+)?\s*$/.test(value) && !/^\s*0+(\.0+)?\s*$/.test(value);
          }
          return false;
        },
      },
    });
  };
}

export class ProductsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  factoryId?: string;
}

export class CreateProductDto {
  @IsUUID()
  factoryId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @IsPositiveNumeric()
  m3PerPallet!: number | string;

  @IsOptional()
  @IsInt()
  @Min(1)
  blocksPerPallet?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /**
   * Zavod narxlari MAJBURIY (egasi qarori, 2026-07-28).
   *
   * Ilgari ikkalasi ham ixtiyoriy edi va narxsiz mahsulot bemalol yaratilardi. Natijasi
   * jimgina ertaga chiqardi: «Mahsulotlar»da mahsulot bor, sotish ham ishlaydi, lekin
   * zavod bilan naqd hisob-kitob qilmoqchi bo'lganda «naqd narxi belgilanmagan» deb
   * to'xtatilardi — va o'shanda buni narx kitobiga bog'lash egasi uchun umuman ravshan
   * emas edi. Narxni yaratish paytida so'rash — shu tuzoqni ildizidan yo'q qiladi.
   */
  @IsPositiveNumeric()
  priceFactoryCash!: number | string;

  @IsPositiveNumeric()
  priceFactoryBank!: number | string;

  @IsOptional()
  @IsPositiveNumeric()
  priceDealerSale?: number | string;

  /**
   * Boshlang'ich narxlar qaysi kundan kuchga kirsin (kiritilmasa — bugun).
   *
   * Narx kitobi sanaga bog'liq: buyurtma o'z SANASIDAGI narxni o'qiydi. Demak bugun
   * kiritilgan narx kechagi buyurtmaga qo'llanmaydi. Import qilingan (o'tgan oylardagi)
   * tarix ustiga mahsulot qo'shilganda bu maydon shart bo'ladi.
   */
  @IsOptional()
  @IsDateString()
  pricesEffectiveFrom?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @IsOptional()
  @IsPositiveNumeric()
  m3PerPallet?: number | string;

  @IsOptional()
  @IsInt()
  @Min(1)
  blocksPerPallet?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Versioned insert into the three-kind price book.
 *
 * `effectiveFrom` — buyurtma SHU SANADAGI narxni o'qiydi, shuning uchun eski buyurtmani
 * qamrab olish uchun sanani orqaga surish kerak. Kiritilmasa bugungi kun olinadi.
 * O'sha kunga narx allaqachon bo'lsa — u tuzatiladi (yangi versiya yaratilmaydi).
 */
export class AddProductPriceDto {
  @IsEnum(PriceKind)
  kind!: PriceKind;

  @IsPositiveNumeric()
  pricePerM3!: number | string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
