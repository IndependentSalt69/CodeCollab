const { validateLocalTestUri } = require('./localMongoTarget');
test.each(['mongodb://127.0.0.1:52957', 'mongodb://localhost:27017', 'mongodb://[::1]:27017'])('permits exact loopback %s', uri => {
  expect(validateLocalTestUri(uri).protocol).toBe('mongodb:');
});
test.each([undefined, '', 'mongodb+srv://localhost', 'mongodb://localhost.evil.example',
  'mongodb://127.0.0.1.evil.example', 'mongodb://localhost@remote.example',
  'mongodb://remote.example/db?label=localhost', 'mongodb://localhost,remote.example'])('rejects non-loopback lookalikes without reflecting URI %s', uri => {
  expect(() => validateLocalTestUri(uri)).toThrow(/MONGO_TEST_URI/);
});
