const mongoose = require('mongoose');

function sanitizeMongoUri(uri = '') {
  if (typeof uri !== 'string') return '';
  return uri.replace(/(:\/\/)([^:@\s]+)?(?::([^@\s]+))?@/, '$1***:***@');
}

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI;

  try {
    const conn = await mongoose.connect(mongoURI);

    console.log(
      `[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`
    );

    return conn;
  } catch (error) {
    const sanitizedError = sanitizeMongoUri(error.message);
    console.error(`[MongoDB] Connection error: ${sanitizedError}`);
    console.error(
      `[MongoDB] Note: Please check your network connection, IP whitelist on MongoDB Atlas, or ensure your configured database host is accessible.`
    );
    throw error;
  }
};

module.exports = connectDB;
