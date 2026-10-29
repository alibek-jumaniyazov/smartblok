import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { utf8FileName } from '../../src/import/file-name';

/**
 * «To'liq almashtirish» (REPLACE) tozalashi har bir Prisma modelini qamraydimi.
 *
 * 2026-10-29: saytda bitta zavod poddon reysi bo'lgani uchun REPLACE preview HTTP 500 berdi —
 * `FactoryPalletAcceptanceLine` → `PalletTransaction` (Restrict) tozalash ro'yxatida yo'q edi va
 * `palletTransaction.deleteMany()` P2003 bilan yiqildi. Bu test schema'dagi HAR BIR modelni
 * tekshiradi: u o'chiriladi yoki ataylab saqlanadi, Restrict bog'lanishlar esa bolalardan
 * boshlab o'chiriladi. Yangi jadval qo'shib, tozalashni unutish shu yerda darhol ko'rinadi.
 */
let checks = 0;
const ok = (cond: boolean, label: string) => { checks++; assert.ok(cond, label); };

// REPLACE saqlaydigan modellar: login, sozlamalar, audit, AI suhbat va import staging'i
// (ImportRow/Issue/EntityMap/Fingerprint partiya bilan Cascade bo'lib o'chadi).
const KEEP = new Set([
  'AppSetting', 'User', 'AuditLog', 'ChatConversation', 'ChatMessage',
  'ImportRow', 'ImportIssue', 'ImportEntityMap', 'ImportFingerprint',
]);

const source = readFileSync(join(__dirname, '../../src/import/commit/import-commit.service.ts'), 'utf8');
const body = /async function wipeAllBusinessData\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1];
ok(!!body, 'wipeAllBusinessData topildi');
const order = [...body!.matchAll(/tx\.(\w+)\.deleteMany\(/g)].map((m) => m[1][0].toUpperCase() + m[1].slice(1));
ok(new Set(order).size === order.length, 'har bir model bir marta o‘chiriladi');

const models = Prisma.dmmf.datamodel.models;
const names = new Set(models.map((m) => m.name));
for (const name of order) ok(names.has(name), `${name} — schema'da bor model`);
for (const m of models) {
  ok(order.includes(m.name) || KEEP.has(m.name), `${m.name} REPLACE'da o‘chiriladi yoki ataylab saqlanadi`);
}

/** Bog'lanish qatorni o'chirishni to'sadimi: aniq Restrict/NoAction yoki majburiy FK (Prisma standarti). */
const blocks = (f: Prisma.DMMF.Field) => {
  const action = f.relationOnDelete ?? (f.isRequired ? 'Restrict' : 'SetNull');
  return action === 'Restrict' || action === 'NoAction';
};
for (const m of models) {
  for (const f of m.fields) {
    if (f.kind !== 'object' || !f.relationFromFields?.length || f.type === m.name || !blocks(f)) continue;
    const child = order.indexOf(m.name), parent = order.indexOf(f.type);
    if (parent === -1) continue; // ota saqlanadi — bola uni to'smaydi
    ok(child !== -1, `${m.name}.${f.name} → ${f.type}: saqlanadigan model o‘chiriladigan qatorni to‘sib qo‘ymasin`);
    ok(child < parent, `${m.name} (${child}) ${f.type} (${parent}) dan OLDIN o‘chirilishi kerak`);
  }
}

// Yuklangan fayl nomi: busboy UTF-8 baytlarini latin1 deb o'qiydi.
const garbled = Buffer.from('Система газаблок (1).xlsb', 'utf8').toString('latin1');
ok(garbled !== 'Система газаблок (1).xlsb', 'sinov nomi haqiqatan buzilgan');
ok(utf8FileName(garbled) === 'Система газаблок (1).xlsb', 'buzilgan kirillcha nom tiklanadi');
ok(utf8FileName('Система газаблок (1).xlsb') === 'Система газаблок (1).xlsb', 'to‘g‘ri unicode nom o‘zgarmaydi');
ok(utf8FileName('Smart blok.xlsx') === 'Smart blok.xlsx', 'lotincha nom o‘zgarmaydi');
ok(utf8FileName('café.xlsx') === 'café.xlsx', 'haqiqiy latin1 nom o‘zgarmaydi');

console.log(`REPLACE wipe coverage: ${checks} checks passed (${order.length} models wiped, ${KEEP.size} kept).`);
