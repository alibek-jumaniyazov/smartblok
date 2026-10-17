import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { FactoryPalletShipmentStatus } from '@prisma/client';
import { PageQueryDto } from '../common/pagination';

export class FactoryPalletShipmentQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID() factoryId?: string;
  @IsOptional() @IsEnum(FactoryPalletShipmentStatus) status?: FactoryPalletShipmentStatus;
}
export class DispatchFactoryPalletDto {
  @IsUUID() factoryId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) qty!: number;
  @IsDateString() date!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) vehiclePlate!: string;
  @IsString() @IsNotEmpty() @MaxLength(150) driverName!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsUUID() requestKey!: string;
}
export class FactoryPalletArrivalDto {
  @IsDateString() date!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class FactoryPalletAcceptanceLineDto {
  @IsString() @IsNotEmpty() @MaxLength(200) condition!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) qty!: number;
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,2})?$/, { message: 'Qabul narxi 0 yoki musbat son, ko‘pi bilan 2 kasr xonasi bo‘lishi kerak' }) unitPrice!: string;
}
export class InspectFactoryPalletDto {
  @IsDateString() date!: string;
  @IsString() @IsNotEmpty() @MaxLength(150) receiverName!: string;
  @IsOptional() @IsString() @MaxLength(150) documentRef?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => FactoryPalletAcceptanceLineDto)
  lines!: FactoryPalletAcceptanceLineDto[];
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) rejectedQty!: number;
  @IsOptional() @IsString() @MaxLength(1000) rejectionReason?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsUUID() requestKey!: string;
}
export class ReturnRejectedPalletDto {
  @IsDateString() date!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) qty!: number;
  @IsString() @IsNotEmpty() @MaxLength(1000) note!: string;
  @IsUUID() requestKey!: string;
}
