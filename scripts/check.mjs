import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Script } from 'node:vm';
const root = resolve('dist');
const html = await readFile(resolve(root,'index.html'),'utf8');
let scripts = 0;
for (const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/.test(attrs) || /application\/(ld\+)?json/.test(attrs)) continue;
  new Script(body); scripts++;
}
new Script(await readFile(resolve(root,'sw.js'),'utf8'));
const manifest = JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './') throw Error('Manifest must support subpath hosting');
const refs = new Set([...html.matchAll(/(?:src|href)=["']((?:\.\/)?assets\/[^"']+)["']/g)].map(m=>m[1]));
for (const icon of manifest.icons) refs.add(icon.src);
const cssPath=resolve(root,'assets/tailwind.css');
const css=await readFile(cssPath,'utf8');
for (const [,raw] of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
  if (!/^(data:|https?:|#)/.test(raw)) await access(resolve(dirname(cssPath),raw));
}
for (const ref of refs) await access(resolve(root,ref));
if (!html.includes("register('./sw.js')")) throw Error('Service worker registration must be relative');
console.log(`OK: ${scripts} inline script(s), service worker, manifest and ${refs.size} local assets`);
