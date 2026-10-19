import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import worker from '../server/worker.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sqlite=new DatabaseSync(':memory:');sqlite.exec(await readFile(new URL('../drizzle/0000_forms.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){return{success:true,meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};},async batch(queries){sqlite.exec('BEGIN IMMEDIATE');try{const result=[];for(const q of queries)result.push(await q.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const origin='https://siyai.test';const env={PUBLIC_ORIGIN:origin,FORMS_SIGNING_KEY:'test-only-not-a-production-secret',AUTHOR_SETUP_EMAIL:'owner@example.test',DB,ASSETS:{fetch:async()=>new Response('static page')}};
let time=1800000000000;const originalNow=Date.now;Date.now=()=>time;
function req(path,method='GET',body,extra={}){const headers={'CF-Connecting-IP':'192.0.2.1',Origin:origin,...extra};if(body!==undefined)headers['Content-Type']='application/json';return new Request(origin+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});}
async function fetch(path,method='GET',body,extra={}){return worker.fetch(req(path,method,body,extra),env);}
async function token(ip='192.0.2.1'){const r=await fetch('/api/forms/challenge','GET',undefined,{'CF-Connecting-IP':ip});assert.equal(r.status,200);const data=await r.json();time+=3100;return data.token;}
const count=()=>Number(sqlite.prepare('SELECT COUNT(*) AS n FROM form_messages').get().n);
try{
 let r=await fetch('/author');assert.equal(r.status,302);assert(r.headers.get('Location').startsWith('/signin-with-chatgpt'));
 assert.equal((await fetch('/api/author/messages')).status,401);
 assert.equal((await fetch('/api/author/messages','GET',undefined,{'oai-authenticated-user-id':'stranger','oai-authenticated-user-email':'not-owner@example.test'})).status,403);
 const owner={'oai-authenticated-user-id':'verified-owner-id','oai-authenticated-user-email':'owner@example.test'};
 assert.equal((await fetch('/author','GET',undefined,owner)).status,200);
 assert.equal(sqlite.prepare('SELECT user_id FROM form_author_identity').get().user_id,'verified-owner-id');
 assert.equal((await fetch('/api/author/messages','GET',undefined,{'...':'ignored','oai-authenticated-user-id':'another-id','oai-authenticated-user-email':'owner@example.test'})).status,403);
 assert.equal((await fetch('/api/author/messages','GET',undefined,{'oai-authenticated-user-id':'verified-owner-id','oai-authenticated-user-email':'changed@example.test'})).status,200);
 const t0=await (await fetch('/api/forms/challenge')).json();const base={kind:'feedback',message:'Технический тест: <img src=x onerror=alert(1)>',website:'',submissionId:crypto.randomUUID(),challenge:t0.token};
 assert.equal((await fetch('/api/forms','POST',base,{Origin:'https://evil.test'})).status,403);
 assert.equal((await fetch('/api/forms','POST',{...base,website:'spam.test'})).status,400);
 assert.equal((await fetch('/api/forms','POST',base)).status,429);assert.equal(count(),0);time+=3100;
 assert.equal((await fetch('/api/forms','POST',{...base,email:'private@example.test'})).status,400);
 assert.equal((await fetch('/api/forms','POST',{...base,message:'x'.repeat(17000)})).status,400);
 r=await fetch('/api/forms','POST',base);assert.equal(r.status,201);assert.equal((await r.json()).stored,true);assert.equal(count(),1);
 assert.equal(sqlite.prepare('SELECT reply_email FROM form_messages').get().reply_email,null);
 r=await fetch('/api/forms','POST',base);assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);assert.equal(count(),1);
 assert.equal((await fetch('/api/forms','POST',{...base,message:'different'})).status,409);
 const order={...base,kind:'order',email:'reply@example.test',submissionId:crypto.randomUUID(),message:'Создать приложение'};
 assert.equal((await fetch('/api/forms','POST',{...order,email:'a\n@example.test'})).status,400);
 assert.equal((await fetch('/api/forms','POST',order)).status,201);
 for(let i=0;i<3;i++)assert.equal((await fetch('/api/forms','POST',{...base,submissionId:crypto.randomUUID(),message:'Тест '+i})).status,201);
 assert.equal(count(),5);assert.equal((await fetch('/api/forms','POST',{...base,submissionId:crypto.randomUUID()})).status,429);assert.equal(count(),5);
 const t2=await token('192.0.2.2');assert.equal((await fetch('/api/forms','POST',{...base,submissionId:crypto.randomUUID(),challenge:t2},{'CF-Connecting-IP':'192.0.2.2'})).status,201);
 assert.equal((await fetch('/api/forms','POST',{...base,submissionId:crypto.randomUUID(),challenge:t2})).status,400);
 const rows=await (await fetch('/api/author/messages','GET',undefined,owner)).json();assert.equal(rows.items.length,6);assert(rows.items.some(x=>x.message.includes('<img')));assert(rows.items.some(x=>x.reply_email==='reply@example.test'));
 assert.equal((await fetch('/api/author/messages/'+base.submissionId+'/read','POST',{read:true},{...owner,Origin:'https://evil.test'})).status,403);
 assert.equal((await fetch('/api/author/messages/'+base.submissionId+'/read','POST',{read:true},owner)).status,200);assert(sqlite.prepare('SELECT read_at FROM form_messages WHERE id=?').get(base.submissionId).read_at);
 assert.equal((await fetch('/api/author/messages/'+base.submissionId+'/read','POST',{read:false},owner)).status,200);
 assert.equal((await fetch('/api/author/messages?kind=unknown','GET',undefined,owner)).status,400);
 time+=21*60*1000;assert.equal((await fetch('/api/forms','POST',{...base,submissionId:crypto.randomUUID()})).status,400);
 assert.equal(await (await fetch('/')).text(),'static page');assert.equal((await fetch('/','POST',{})).status,405);
 const unavailable=await worker.fetch(req('/api/forms','POST',base),{...env,DB:null});assert.equal(unavailable.status,503);
 const source=await readFile(new URL('../server/author.js',import.meta.url),'utf8');assert(!source.includes('innerHTML'));assert(source.includes('textContent'));
 console.log('PASS: real SQLite schema and atomic writes; owner-only access with durable ID; origin/body/email checks; signed timed challenge; honeypot; limits; idempotency; privacy; read/unread; no false success or HTML injection.');
}finally{Date.now=originalNow;sqlite.close();}
