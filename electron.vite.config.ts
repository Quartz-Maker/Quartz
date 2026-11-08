import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve, dirname } from 'path'
import { readFileSync } from 'fs'

// remark-parse@8 → parse-entities@2 picks a DOM-based entity decoder in browser builds,
// which cannot run in the metadata Web Worker. Use its table-based Node decoder everywhere.
const nodeEntityDecoder = {
  name: 'quartz:parse-entities-node-decoder',
  load(id: string) {
    const file = id.split('?')[0]
    if (/parse-entities[\\/]decode-entity\.browser\.js$/.test(file))
      return readFileSync(resolve(dirname(file), 'decode-entity.js'), 'utf8')
    return null
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [nodeEntityDecoder],
    worker: { format: 'es', plugins: () => [nodeEntityDecoder] }
  }
})
