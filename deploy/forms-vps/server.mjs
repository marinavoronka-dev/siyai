import { createServer } from 'node:http';
import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Single process, append-only private journal. No messages are served over HTTP.
const file = resolve(process.env.DATA_FILE || '/var/lib/siyai-forms/messages.jsonl');
if (process.argv.includes('--list')) {
  try { for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const m = JSON.parse(line); console.log(JSON.stringify({id:m.id,createdAt:new Date(m.time).toISOString(),kind:m.kind,message:m.message,contact:m.contact}));
  } } catch(e) { if(e.code!=='ENOENT') throw e; }
  process.exit(0);
}
const origin = process.env.PUBLIC_ORIGIN;
const secret = process.env.FORMS_SECRET;
if (!origin || new URL(origin).origin !== origin || !secret || secret.length < 32) throw Error('Set PUBLIC_ORIGIN and FORMS_SECRET (32+ chars)');
const port = Number(process.env.PORT || 3001);
const mac = value => createHmac('sha256', secret).update(value).digest('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
mkdirSync(dirname(file), {recursive:true,mode:0o700});
let records=[];
try { const raw=readFileSync(file,'utf8'); if(raw && !raw.endsWith('\n')) throw Error('Incomplete journal: restore from backup before starting');
 records=raw.split('\n').filter(Boolean).map(s=>JSON.parse(s));
 for(const m of records) if(!uuid.test(m.id)||!Number.isFinite(m.time)||typeof m.message!=='string') throw Error('Invalid journal');
} catch(e) { if(e.code!=='ENOENT') throw e; }
const ids=new Map(records.map(m=>[m.id,m]));
const DAY=86400000; let recent=records.filter(m=>m.time>Date.now()-DAY);
const throttle=new Map();
function send(res,status,value) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function bad(code,status=400){throw Object.assign(Error(code),{status});}
function text(v,max,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))bad('invalid_field');return v.trim();}
async function body(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))bad('content_type',415);
 let n=0,parts=[];for await(const b of req){n+=b.length;if(n>32768)bad('too_large',413);parts.push(b);}
 let p;try{p=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{bad('invalid_json');}
 if(!p||typeof p!=='object'||Array.isArray(p))bad('invalid_json');return p;
}
function verify(token,client){
 const parts=String(token||'').split('.'); if(parts.length!==4)bad('challenge');
 const signed=parts.slice(0,3).join('.'), expected=mac(signed);
 if(!/^[a-f\d]{64}$/.test(parts[3])||!timingSafeEqual(Buffer.from(parts[3]),Buffer.from(expected)))bad('challenge');
 const age=Date.now()-Number(parts[0]);if(!Number.isFinite(age)||age<2500||age>1200000||parts[2]!==client)bad('challenge');
}
function save(m){
 recent=recent.filter(x=>x.time>Date.now()-DAY);
 const prior=ids.get(m.id) || (m.legacy && recent.find(x=>x.legacy&&x.hash===m.hash&&x.client===m.client&&x.time>Date.now()-600000));
 if(prior){if(prior.hash!==m.hash||prior.client!==m.client)bad('id_conflict',409);return {id:prior.id,duplicate:true};}
 if(recent.length>=500||recent.filter(x=>x.client===m.client).length>=20||recent.filter(x=>x.client===m.client&&x.time>Date.now()-600000).length>=5)bad('rate_limit',429);
 const fd=openSync(file,'a',0o600);
 try {const bytes=Buffer.from(JSON.stringify(m)+'\n');let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);const dir=openSync(dirname(file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
 catch(e){storageFailed=true;throw e;}finally{closeSync(fd);}
 ids.set(m.id,m);recent.push(m);return {id:m.id,duplicate:false};
}
let storageFailed=false;
const server=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'&&req.method==='GET')return send(res,storageFailed?503:200,{ok:!storageFailed});
  if(!['/api/forms/challenge','/api/forms','/api/contact','/api/lead'].includes(path))bad('not_found',404);
  if(req.headers.origin!==origin && !(req.method==='GET'&&!req.headers.origin&&req.headers['sec-fetch-site']==='same-origin'))bad('origin',403);
  // Bound to loopback; Nginx must overwrite X-Real-IP, never append user input.
  const client=mac(String(req.headers['x-real-ip']||req.socket.remoteAddress));
  const now=Date.now();for(const [key,v]of throttle)if(v.until<now)throttle.delete(key);
  const limit=throttle.get(client)||{n:0,until:now+60000};
  if(throttle.size>=10000&&!throttle.has(client))bad('rate_limit',429);
  limit.n++;throttle.set(client,limit);if(limit.n>60)bad('rate_limit',429);
  if(path==='/api/forms/challenge'){
   if(req.method!=='GET')bad('method',405);
   const value=now+'.'+randomUUID()+'.'+client;return send(res,200,{token:value+'.'+mac(value),waitMs:3000});
  }
  if(req.method!=='POST')bad('method',405);if(storageFailed)bad('storage_unavailable',503);
  const p=await body(req);let kind,message,contact='',id,legacy=path!=='/api/forms';
  if(!legacy){
   if(!['feedback','order','sponsor'].includes(p.kind))bad('kind');kind=p.kind;
   if(p.website!=='')bad('spam');verify(p.challenge,client);
   message=text(p.message,10000,true);id=text(p.submissionId,36,true);if(!uuid.test(id))bad('id');
   if(kind!=='feedback'){contact=text(p.email,254,true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))bad('email');}
   else if(p.email)bad('feedback_contact');
  }else if(path==='/api/contact'){
   for(const k of ['score','easy','recommend'])if(!Number.isInteger(p[k])||p[k]<1||p[k]>5)bad('rating');
   const clean={score:p.score,easy:p.easy,recommend:p.recommend};
   for(const k of ['who','liked','unclear','add','free'])clean[k]=text(p[k]??'',2000);
   message=JSON.stringify(clean);kind='feedback';id=randomUUID();
  }else{kind='lead';message=JSON.stringify({name:text(p.name,100,true),note:text(p.note??'',5000)});contact=text(p.contact,254,true);id=randomUUID();}
  const hash=digest(JSON.stringify([kind,message,contact]));
  const result=save({id,kind,message,contact,hash,time:Date.now(),client,legacy});
  return send(res,result.duplicate?200:201,{ok:true,success:true,stored:true,...result});
 } catch(e){send(res,e.status||503,{ok:false,success:false,code:e.status?e.message:'storage_unavailable'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,'127.0.0.1',()=>console.log('Siyai forms listening on loopback port '+server.address().port));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
