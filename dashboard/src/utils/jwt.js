// Decodifica (sin verificar firma) el payload de un JWT HS256.
// La firma real la respalda la URL secreta: el JWT sirve como friction gate.
// El acceso a los datos está controlado por RLS + anon key.
export function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '==='.slice((padded.length + 3) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function isExpired(payload) {
  if (!payload?.exp) return true;
  return Math.floor(Date.now() / 1000) > payload.exp;
}
