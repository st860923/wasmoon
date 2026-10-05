import { copyFile, mkdir } from 'node:fs/promises'
import { defineConfig } from 'rolldown'

const production = !process.env.ROLLUP_WATCH

export default defineConfig({
    input: './src/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'esm',
        sourcemap: true,
        minify: production,
    },
    external: ['module', 'node:module'],
    define: {
        // Webpack workaround: https://github.com/webpack/webpack/issues/16878
        'import.meta': 'Object(import.meta)',
    },
    plugins: [
        {
            name: 'copy-wasm',
            async writeBundle() {
                await mkdir('dist', { recursive: true })
                await copyFile('build/glue.wasm', 'dist/glue.wasm')
            },
        },
    ],
})
