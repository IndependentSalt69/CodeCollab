import { io } from 'socket.io-client';

let socketInstance = null;

/** @param {string | undefined} serverUrl */
export const initClientSocket = (serverUrl = undefined, options = {}) => {
  if (!socketInstance) {
    socketInstance = io(serverUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      ...options,
    });
  } else if (options && Object.keys(options).length > 0) {
    if (options.auth) {
      socketInstance.auth = { ...socketInstance.auth, ...options.auth };
    }
  }
  return socketInstance;
};

export const getClientSocket = () => {
  return socketInstance || initClientSocket();
};

export const resetClientSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
};
