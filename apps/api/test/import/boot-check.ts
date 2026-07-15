import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const server: any = app.getHttpAdapter().getInstance();
  const routes: string[] = [];
  (server._router?.stack ?? []).forEach((l: any) => { if (l.route) routes.push(Object.keys(l.route.methods).join(",").toUpperCase() + " " + l.route.path); });
  const imp = routes.filter((r) => r.includes("import"));
  console.log("Nest booted OK. /api/import routes registered: " + imp.length);
  imp.forEach((r) => console.log("   " + r));
  await app.close();
  process.exit(imp.length >= 8 ? 0 : 1);
}
main().catch((e) => { console.error("BOOT FAILED:", e.message); process.exit(1); });
