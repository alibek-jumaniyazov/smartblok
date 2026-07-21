import { Prisma } from '@prisma/client';

/**
 * Davlat raqami (truck plate) canonicalization — ONE source of truth for the Excel
 * importer, the manual Moshinalar CRUD and the ad-hoc truck minted on an order.
 *
 * Before this module the importer canonicalized plates while manual entry stored the
 * raw string, so «90 x 700 ca» typed by hand became a SECOND row for the truck the
 * import had already created as «90 X 700 CA» — two vehicles, one physical truck, and
 * a VEHICLE transport ledger split across both.
 */

/** Cyrillic plate letters that look like Latin ones (Uzbek plates use Latin). */
const PLATE_MAP: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
};

/** Stored/display form: upper, Cyrillic→Latin, whitespace runs collapsed, trimmed. */
export function normalizePlate(plate: string): string {
  return [...plate.toUpperCase()].map((c) => PLATE_MAP[c] ?? c).join('').replace(/\s+/g, ' ').trim();
}

/**
 * Comparison key — normalizePlate + ALL whitespace removed, so «90X700CA» and
 * «90 X 700 CA» are ONE truck. MUST stay semantically identical to PLATE_KEY_SQL below
 * and to the expression in the Vehicle_plate_key index
 * (migration 20260721120000_vehicle_plate_normalize_repair).
 */
export function plateKey(plate: string): string {
  return normalizePlate(plate).replace(/\s+/g, '');
}

/**
 * Form value → column value. Blank/whitespace becomes NULL, never ''.
 * Postgres unique indexes allow many NULLs but '' is a real value, so storing ''
 * let exactly ONE plate-less vehicle exist and rejected every later one as a
 * "duplicate plate" — while the user had typed no plate at all.
 */
export const cleanPlate = (v?: string | null): string | null => normalizePlate(v ?? '') || null;

/** Same blank→NULL rule for the free-text sidecars. */
export const cleanText = (v?: string | null): string | null => (v ?? '').trim() || null;

/**
 * The normalized-plate expression, mirroring plateKey() in SQL. MUST stay identical to
 * the expression in the Vehicle_plate_key index.
 *
 * ⚠ translate() lists BOTH cases of the Cyrillic lookalikes. Postgres upper() on non-ASCII
 * delegates to the cluster's LC_CTYPE and is a no-op under C/POSIX, so relying on it to
 * raise 'х' to 'Х' before translate() would make this key diverge from plateKey() — whose
 * JS toUpperCase() ALWAYS folds Cyrillic — on some clusters. Listing both cases makes the
 * fold locale-free and leaves upper() responsible for ASCII only.
 *
 * NOTE: '\\s+' in a TS template literal renders as '\s+' in the SQL text — a single
 * backslash is required there ('\s' in a plain JS string would collapse to just 's').
 */
const PLATE_KEY_SQL = Prisma.sql`regexp_replace(translate(upper(plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\\s+','','g')`;

export interface FleetVehicleRef {
  id: string;
  name: string;
  plate: string | null;
  active: boolean;
}

/** Prisma client or interactive-transaction client — both expose $queryRaw. */
type RawCapable = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

/**
 * The ONE fleet (oneTime=false) vehicle holding this plate, ignoring case, spacing and
 * Cyrillic lookalikes. oneTime rows are per-order history and never participate.
 * Pass excludeId when checking an UPDATE so a row never conflicts with itself.
 */
export async function findFleetVehicleByPlate(
  db: RawCapable,
  plate: string,
  excludeId?: string,
): Promise<FleetVehicleRef | null> {
  const rows = await db.$queryRaw<FleetVehicleRef[]>(Prisma.sql`
    SELECT id, name, plate, active FROM "Vehicle"
    WHERE "oneTime" = false AND plate IS NOT NULL
      AND ${PLATE_KEY_SQL} = ${plateKey(plate)}
      ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
    LIMIT 1`);
  return rows[0] ?? null;
}
