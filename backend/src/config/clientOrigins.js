function getClientOrigins(value = process.env.CLIENT_URL || 'http://localhost:3000') {
  const origins = value.split(',').map((item) => item.trim());
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin || Boolean(url.username || url.password);
    } catch (_) { return true; }
  })) throw new Error('CLIENT_URL must contain comma-separated exact HTTP(S) origins, without wildcards, paths or credentials');
  return [...new Set(origins)];
}
module.exports = { getClientOrigins };
