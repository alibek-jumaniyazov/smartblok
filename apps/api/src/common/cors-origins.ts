// Fail fast in production instead of silently defaulting to the dev SPA origin: a
// missing CORS_ORIGIN in prod would block every cross-origin XHR and the socket.io
// connection, breaking the app with no boot error. Dev keeps the localhost default.
export function requireCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CORS_ORIGIN o‘rnatilmagan. Production’da frontend domenini vergul bilan ajratib bering, masalan: CORS_ORIGIN="https://app.smartblok.uz".',
      );
    }
    return ['http://localhost:5173'];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
