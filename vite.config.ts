import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

function versionPlugin(): Plugin {
  return {
    name: 'version-plugin',
    writeBundle() {
      const version = {
        buildTime: Date.now(),
        version: process.env.npm_package_version || '1.0.0'
      };
      writeFileSync(
        resolve(__dirname, 'dist', 'version.json'),
        JSON.stringify(version)
      );
    }
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  plugins: [versionPlugin()],
});
