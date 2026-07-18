import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class PatchRowDto {
  @IsObject()
  patch!: Record<string, unknown>;
}

export class ResolveIssueDto {
  @IsIn(['ACCEPTED', 'EDITED', 'IGNORED'])
  status!: 'ACCEPTED' | 'EDITED' | 'IGNORED';

  @IsOptional()
  value?: unknown;
}

export class ResolveEntityDto {
  // The final canonical client name the owner chose/typed for this raw name.
  @IsString()
  @MinLength(1)
  name!: string;
}

export class CommitDto {
  @IsString()
  @MinLength(8)
  confirmToken!: string;

  /**
   * How the committed data joins what's already there:
   *   APPEND  — add these rows on top (the same file may be imported again → duplicates)
   *   REPLACE — first roll back EVERY other committed import (compensating), then write
   *             this one, so the imported dataset is fully swapped. Manual (non-import)
   *             data is never touched. Defaults to APPEND.
   */
  @IsOptional()
  @IsIn(['APPEND', 'REPLACE'])
  mode?: 'APPEND' | 'REPLACE';
}
