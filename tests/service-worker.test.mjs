import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../dist/sw.js', import.meta.url),'utf8');
function load(base) {
  const events={};
  runInNewContext(source, { URL, Response, self: { location: new URL(`https://example.org${base}sw.js`), addEventListener: (name,fn)=>events[name]=fn } });
  return events.fetch;
}
for (const base of ['/', '/siyai/']) {
  test(`service worker scope ${base}`,()=>{
    const handler=load(base);
    // respondWith is called synchronously: we only test routing, not the response promise.
    const routed=(path, method='GET', origin='https://example.org')=>{
      let intercepted=false;
      handler({request:{url:origin+path,method},respondWith(p){intercepted=true;p.catch(()=>{});}});
      return intercepted;
    };
    assert.equal(routed(base),true);
    assert.equal(routed(base+'index.html'),true);
    assert.equal(routed(base+'assets/image-abc.png'),true);
    assert.equal(routed(base+'manifest.webmanifest'),true);
    assert.equal(routed(base+'api/forms'),false);
    assert.equal(routed(base,'POST'),false);
    assert.equal(routed(base,'GET','https://outside.org'),false);
    assert.equal(routed('/elsewhere/'),false);
  });
}
