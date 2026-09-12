import { build } from 'esbuild';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { builtinModules, createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';

const root = resolve('../..');
await mkdir('dist', { recursive: true });
const result = await build({
  metafile: true, entryPoints: ['src/worker.ts'], bundle: true, format: 'esm', platform: 'neutral',
  mainFields: ['module', 'main'], conditions: ['workerd'],
  define: { 'import.meta.url': '"file:///worker.js"' },
  minify: true, keepNames: true, target: 'es2022', outfile: 'dist/worker.js', sourcemap: true,
  external: ['cloudflare:*', 'node:*', '@nestjs/microservices', '@nestjs/microservices/microservices-module', '@nestjs/platform-socket.io', 'class-transformer', 'class-validator'],
  banner: { js: 'import { createRequire as __trekCreateRequire } from "node:module"; const require = __trekCreateRequire("/worker.js");' },
  plugins: [{ name: 'trek-worker-runtime', setup(builder) {
    builder.onLoad({ filter: /node_modules\/depd\/index\.js$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const start = source.indexOf('  // eslint-disable-next-line no-new-func', source.indexOf('function wrapfunction'));
      const end = source.indexOf('  return deprecatedfn', start);
      if (start < 0 || end < 0) throw new Error('Unsupported depd version');
      const replacement = `  var deprecate = this;
  var deprecatedfn = function () { log.call(deprecate, message, site); return fn.apply(this, arguments); };
  Object.defineProperty(deprecatedfn, 'length', {value: fn.length});
`;
      return {contents: source.slice(0, start) + replacement + source.slice(end), loader: 'js', resolveDir: dirname(args.path)};
    });
    builder.onLoad({ filter: /shared\/src\/index\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace("export * from './sanitize/sanitize';", ''), loader: 'ts', resolveDir: dirname(args.path) }));
    builder.onResolve({ filter: /cron-registrar\.service$/ }, () => ({path:resolve('src/cron-unavailable.ts')}));
    builder.onResolve({ filter: /audit-log\.logger$/ }, () => ({path:resolve('src/logger.ts')}));
    builder.onResolve({ filter: /drivers\/local\.driver$/ }, () => ({path:resolve('src/storage-unavailable.ts')}));
    builder.onResolve({ filter: /^iconv-lite$/ }, args => {
      const resolved = createRequire(resolve(args.resolveDir, 'resolve.cjs')).resolve('iconv-lite');
      if (resolved.includes('/node_modules/@nestjs/') || resolved.includes('/node_modules/@modelcontextprotocol/')) return {path: resolve(root, 'node_modules/raw-body/node_modules/iconv-lite/lib/index.js')};
      return undefined;
    });
    builder.onResolve({ filter: /^pdf-parse$/ }, () => ({path: resolve('src/pdf-unavailable.ts')}));
    builder.onResolve({ filter: /^pkce-challenge$/ }, () => ({ path: resolve(root, 'node_modules/pkce-challenge/dist/index.browser.js') }));
    builder.onResolve({ filter: /^@trek\/shared$/ }, () => ({ path: resolve(root, 'shared/src/index.ts') }));
    builder.onResolve({ filter: /\/sanitize\/sanitize$/ }, args => ({ path: resolve(args.resolveDir, `${args.path}.ts`), sideEffects: false }));
    builder.onResolve({ filter: /(?:^|\/)config$/ }, args => resolve(args.resolveDir, args.path) === resolve(root, 'server/src/config')
      ? { path: resolve('src/config.ts') } : undefined);
    builder.onResolve({ filter: /database\.connection$/ }, () => ({ path: resolve('src/connection.ts') }));
    builder.onResolve({ filter: /.*/ }, args => builtinModules.includes(args.path)
      ? { path: `node:${args.path}`, external: true } : undefined);
    builder.onLoad({ filter: /server\/src\/.*\.ts$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const result = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true },
        fileName: args.path,
      });
      const virtualDir = `/tmp/trek/${relative(root, dirname(args.path))}`;
      return { contents: `const __dirname = ${JSON.stringify(virtualDir)};\n${result.outputText}`, loader: 'js', resolveDir: dirname(args.path) };
    });
  } }],
});

await writeFile('dist/meta.json', JSON.stringify(result.metafile));
