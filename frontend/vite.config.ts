import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.BACKEND_URL || 'http://127.0.0.1:5001';
const devPort = parseInt(process.env.PORT || '5173', 10);

export default defineConfig({
    plugins: [react()],
    server: {
        host: '127.0.0.1',
        port: devPort,
        strictPort: true,
        proxy: {
            '/api': backendTarget,
            '/health': backendTarget,
            '/ready': backendTarget,
            '/socket.io': { target: backendTarget, ws: true },
        },
    },
});
