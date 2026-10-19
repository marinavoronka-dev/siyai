import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,statSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const script=new URL('./server.mjs',import.meta.url).pathname;
const origin='http://185.219.43.207';
const folder=mkdtempSync(join(tmpdir(),'siyai-api-test-')),file=join(folder,'messages.jsonl');
const env={...process.env,PORT:'0',PUBLIC_ORIGIN:origin,FORMS_SECRET:'test-only-'.repeat(8),DATA_FILE:file};
async function start(){const child=spawn(process.execPath,[script],{env,stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);
 const port=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(Error('early exit: '+errors)));child.stdout.on('data',b=>{const m=String(b).match(/port (\d+)/);if(m)resolve(Number(m[1]));});});
 return {child,url:'http://127.0.0.1:'+port};}
async function stop(child){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}
test('VPS API persists native and legacy forms, rejects spoofing, and survives restart',async()=>{
 let {child,url}=await start();
 const request=async(path,data,extra={})=>{const r=await fetch(url+path,{method:data?'POST':'GET',headers:{Origin:origin,'X-Real-IP':'203.0.113.1',...(data?{'Content-Type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await request('/api/forms/challenge',null,{Origin:'http://evil.invalid'})).status,403);
  const httpGet=await fetch(url+'/api/forms/challenge',{headers:{Referer:origin+'/'}});assert.equal(httpGet.status,200,'HTTP browsers may omit Origin and Sec-Fetch headers');
  assert.equal((await fetch(url+'/api/forms/challenge')).status,403);
  const challenge=await request('/api/forms/challenge');assert.equal(challenge.status,200);
  const payload={kind:'feedback',message:'Пробный отзыв 💜',website:'',submissionId:randomUUID(),challenge:challenge.data.token};
  assert.equal((await request('/api/forms',payload)).status,400,'too fast');
  await new Promise(r=>setTimeout(r,2700));
  assert.equal((await request('/api/forms',{...payload,challenge:payload.challenge+'x'})).status,400);
  assert.equal((await request('/api/forms',payload,{'X-Real-IP':'203.0.113.2'})).status,400,'challenge bound to client');
  assert.equal((await request('/api/forms',payload)).status,201);
  assert.equal((await request('/api/forms',payload)).data.duplicate,true);
  assert.equal((await request('/api/forms',{...payload,message:'Changed'})).status,409);
  const feedback={score:5,easy:4,recommend:5,who:'',liked:'Календарь',unclear:'',add:'',free:'Спасибо'};
  assert.equal((await request('/api/contact',{...feedback,score:0})).status,400);
  const native=await request('/api/contact',feedback);assert.equal(native.data.ok,true);
  assert.equal((await request('/api/contact',feedback)).data.duplicate,true);
  assert.equal((await request('/api/lead',{name:'Автор',contact:'@test',note:'Запрос'})).status,201);
  assert.equal((await request('/api/author/messages',null,{'oai-authenticated-user-id':'fake'})).status,404);
  assert.equal((await request('/api/forms',{...payload,message:'x'.repeat(33000)})).status,413);
  const ch=(await request('/api/forms/challenge')).data.token;
  await new Promise(r=>setTimeout(r,2700));
  for(let i=0;i<2;i++)assert.equal((await request('/api/forms',{...payload,challenge:ch,message:'More '+i,submissionId:randomUUID()})).status,201);
  assert.equal((await request('/api/forms',{...payload,challenge:ch,message:'Rate limited',submissionId:randomUUID()})).status,429);
  assert.equal(readFileSync(file,'utf8').trim().split('\n').length,5);
  assert.equal(statSync(file).mode&0o777,0o600);
  await stop(child);({child,url}=await start());
  assert.equal((await request('/api/forms',payload)).data.duplicate,true,'retry after restart does not duplicate');
  const list=spawnSync(process.execPath,[script,'--list'],{env,encoding:'utf8'});assert.equal(list.status,0);assert.match(list.stdout,/Пробный отзыв/);
 }finally{await stop(child);}
 appendFileSync(file,'{"partial":');
 const broken=spawnSync(process.execPath,[script],{env,encoding:'utf8',timeout:3000});assert.notEqual(broken.status,0,'incomplete journal must not accept new messages');
 assert.match(broken.stderr,/Incomplete journal/);
});
