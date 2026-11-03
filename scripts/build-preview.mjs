// #5 확인용 미리보기(이 브랜치에만 있다. 원본으로 보낼 PR에는 넣지 않는다).
// 실제 서버 코드(src/app.mjs, orchestrator, settings)를 그대로 묶어 브라우저 안에서 돌리고, fetch('/api/…')를 그 코드로 넘긴다.
// 설치 없이 열어 볼 수 있는 한 장짜리 HTML을 만든다. 사용: npm i --no-save esbuild && node scripts/build-preview.mjs 출력.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = process.argv[2] ?? 'preview.html';

const SHIMS = {
  'node:http': `export default { createServer: (handler) => ({ handler }) };`,
  'node:fs': `export default {};`,
  'node:path': `export default { join: (...a) => a.join('/'), dirname: () => '', normalize: (x) => x, extname: () => '', sep: '/' };`,
  'node:url': `export const fileURLToPath = () => '/preview';`,
  // 지문·토큰 용도뿐이라 미리보기에서는 암호학적 강도가 필요 없다
  'node:crypto': `
    const randomUUID = () => (globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')); // https가 아닌 곳에는 randomUUID가 없다
    const randomBytes = (n) => ({ toString: () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('') });
    const createHash = () => { let s = ''; const h = { update: (x) => { s += x; return h; }, digest: () => {
      let a = 0x811c9dc5, b = 0x1b873593;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 2654435761) ^ (b >>> 13); }
      return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
    } }; return h; };
    export { randomUUID, randomBytes, createHash };
    export default { randomUUID, randomBytes, createHash };`,
};

const ENTRY = `
import './scripts/preview/setup.mjs';
import './public/room.js';
`;

const result = await build({
  stdin: { contents: ENTRY, resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  define: { 'import.meta.url': '"file:///preview/app.mjs"' },
  plugins: [{
    name: 'node-shims',
    setup(b) {
      // 미리보기는 로그인 없이 돈다. Firebase SDK 주소는 묶지 않는다
      b.onResolve({ filter: /^https:/ }, (a) => ({ path: a.path, external: true }));
      b.onResolve({ filter: /^firebase-admin/ }, (a) => ({ path: a.path, namespace: 'firebase-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'firebase-stub' }, () => ({ contents: 'export {}', loader: 'js' }));
      b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: 'shim' }));
      b.onLoad({ filter: /.*/, namespace: 'shim' }, (a) => {
        if (!SHIMS[a.path]) throw new Error(`shim 없음: ${a.path}`);
        return { contents: SHIMS[a.path], loader: 'js' };
      });
      // 방 주소를 쿼리로 읽는 대신 미리보기 방으로 고정한다(frame 안에서는 쿼리를 쓸 수 없다)
      b.onLoad({ filter: /public[\\/]room\.js$/ }, (a) => {
        const src = readFileSync(a.path, 'utf8');
        const from = "new URLSearchParams(location.search).get('room')";
        if (!src.includes(from)) throw new Error('room.js의 방 주소 읽기가 바뀌었어요');
        return { contents: src.replace(from, "'demo-preview'"), loader: 'js' };
      });
    },
  }],
});

const html = readFileSync(path.join(root, 'public/room.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'))
  .replace('<a class="nav-btn" href="./">데모 보기</a>', '')
  .replace('<p>개발 중인 실제 방 화면이에요. 서버를 다시 켜면 메모리에 있던 방은 사라져요.</p>', '<p>#5 확인용 미리보기예요. 새로고침하면 처음으로 돌아가요. 저장소·배포 서버에 닿지 않아요.</p>');
const css = readFileSync(path.join(root, 'public/style.css'), 'utf8') + readFileSync(path.join(root, 'scripts/preview/dock.css'), 'utf8');
const js = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
writeFileSync(out, `<title>내 비서 설정 테스트</title>
<style>${css}</style>
${body}
${readFileSync(path.join(root, 'scripts/preview/dock.html'), 'utf8')}
<script type="module">${js}</script>
`);
console.log(`${out}: ${(Buffer.byteLength(readFileSync(out)) / 1024).toFixed(0)}KB`);
