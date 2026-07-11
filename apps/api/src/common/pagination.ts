import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 50;

  @IsOptional() @IsString()
  search?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const pageArgs = (q: { page?: number; pageSize?: number }) => {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
};

export const paged = <T>(items: T[], total: number, page: number, pageSize: number): Paged<T> => ({
  items,
  total,
  page,
  pageSize,
});
