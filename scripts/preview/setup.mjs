// 브라우저 안의 서버: 실제 createApp을 메모리 저장소로 만들고 fetch('/api/…')를 그 처리기로 넘긴다. 시계는 앞으로 돌릴 수 있다.
import { createApp } from '../../src/app.mjs';
import { MemoryStore } from '../../src/store/memory.mjs';
import { seedDemoRoom } from '../../src/dev/seed.mjs';

const ROOM = 'demo-preview';

// frame에 따라 브라우저 저장소가 막힐 수 있어 메모리로 대신한다(새로고침하면 어차피 방이 사라진다)
const mem = new Map([['agent-settlement.uid', 'me']]);
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });

let offset = 0;
const clock = () => new Date(Date.now() + offset);
const store = new MemoryStore({ now: clock });
const server = createApp({ store, gemini: null, clock, env: { DEV_SEED: '1' } });

function call(url, init = {}) {
  const u = new URL(url, 'http://preview.local');
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    method: init.method ?? 'GET', url: u.pathname + u.search, headers, socket: { remoteAddress: 'preview' },
    async* [Symbol.asyncIterator]() { if (init.body) yield init.body; },
  };
  return new Promise((resolve) => {
    let status = 200;
    const out = {};
    const res = {
      writableEnded: false,
      setHeader: (k, v) => { out[k] = v; },
      writeHead: (s, h) => { status = s; Object.assign(out, h); },
      end: (b) => { res.writableEnded = true; resolve(new Response(status === 204 ? null : (b ?? ''), { status, headers: out })); },
    };
    server.handler(req, res);
  });
}

// 시작 상태: 영수증 줄을 미리 나눠 두어 바로 청구서부터 해 볼 수 있게 한다
async function reset({ fresh }) {
  store.cols.clear();
  store.events.clear();
  offset = 0;
  await seedDemoRoom(store, { id: ROOM });
  if (fresh) await store.delete('agents', 'me');
  // 설정 완료 시나리오는 규칙 확인에 집중하도록 민수의 근거 이의를 끈다. 새 사용자 시나리오는 이의와 중재까지 이어진다
  if (!fresh) {
    const ms = await store.get('agents', 'ms');
    await store.put('agents', { ...ms, rules: { ...ms.rules, onDispute: 'ask' } });
  }
  const post = (path, uid, body = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body) }).then((r) => r.json());
  for (const e of (await store.list('expenses', { roomId: ROOM })).filter((x) => x.split === 'items' && x.items?.length)) {
    const { expense } = await post(`/api/rooms/${ROOM}/expenses/${encodeURIComponent(e.id)}/allocate`, e.createdBy);
    for (const it of e.items) {
      const a = expense.alloc[it.id];
      if (a.confidence < 0.7) await post(`/api/rooms/${ROOM}/expenses/${encodeURIComponent(e.id)}/lines/${encodeURIComponent(it.id)}`, e.createdBy, { consumers: a.consumers.length ? a.consumers : e.present, confirm: true });
    }
  }
}

const ready = reset({ fresh: true });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  await ready;
  return call(url, init);
};

// ---------------------------------------------------------------- 테스트 도구
const $ = (s) => document.querySelector(s);
const showClock = () => { $('#dock-now').textContent = clock().toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }); };
const refresh = () => {
  // 지금 보는 사람을 다시 고르면 방 화면이 기록을 처음부터 다시 받는다
  ($('#main [data-action=who][aria-checked=true]') ?? $('#main [data-action=who][data-id=me]'))?.click();
  showClock();
};
const tick = async () => {
  await server.tick();
  showClock();
};
setInterval(() => tick().catch(() => {}), 3000);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-dock]');
  if (!el) return;
  const what = el.dataset.dock;
  if (what === 'toggle') {
    const panel = $('#dock-panel');
    panel.hidden = !panel.hidden;
    $('#dock-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  } else if (what === 'fresh' || what === 'set') {
    await reset({ fresh: what === 'fresh' });
    mem.set('agent-settlement.uid', 'me');
    $('#dock-status').textContent = what === 'fresh' ? "'나'를 새 사용자로 다시 시작했어요." : '모두 설정을 마친 상태로 다시 시작했어요. 민수의 이의는 꺼 두었어요.';
    refresh();
  } else if (what === 'day') {
    offset += 24 * 3600_000;
    await tick();
    $('#dock-status').textContent = '하루 뒤로 옮겼어요.';
    refresh();
  } else if (what === 'payday') {
    // 다음 25일 09:00 KST(00:00 UTC)로 옮긴다
    const now = clock();
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 25));
    if (at <= now) at.setUTCMonth(at.getUTCMonth() + 1);
    offset += at - now;
    await tick();
    $('#dock-status').textContent = '다음 25일 오전 9시로 옮겼어요.';
    refresh();
  }
});
showClock();
window.__preview = { store, server, clock };
