function validateLocalTestUri(uri) {
  let parsed;
  try { parsed = new URL(uri); } catch (_) { throw new Error('MONGO_TEST_URI must be a valid disposable local MongoDB URI.'); }
  if (parsed.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.hash) {
    throw new Error('MONGO_TEST_URI must target an exact loopback hostname; remote/SRV targets are forbidden.');
  }
  return parsed;
}
module.exports = { validateLocalTestUri };
