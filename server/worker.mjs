const AUTHOR_HTML = '__AUTHOR_HTML__';
const AUTHOR_JS = '__AUTHOR_JS__';
const JSON_HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const encode = new TextEncoder();
function json(value,status=200,extra={}) { return new Response(JSON.stringify(value),{status,headers:{...JSON_HEADERS,...extra}}); }
function fail(code,status) { return json({success:false,code},status); }
function trustedOrigin(request,env,allowFetch=false) {
 const origin=request.headers.get('Origin');
 return origin===env.PUBLIC_ORIGIN || (!origin && allowFetch && request.headers.get('Sec-Fetch-Site')==='same-origin');
}
async function smallJSON(request,max=16384) {
 if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')) throw new Error('content_type');
 if (Number(request.headers.get('Content-Length')||0)>max) throw new Error('too_large');
 const reader=request.body?.getReader(); if (!reader) throw new Error('body');
 let bytes=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max){await reader.cancel();throw new Error('too_large');}chunks.push(value);}
 const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
}
function hex(bytes) { return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
async function sign(value,secret) {
 const key=await crypto.subtle.importKey('raw',encode.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encode.encode(value)));
}
async function validSignature(value,signature,secret) {
 if(!/^[a-f0-9]{64}$/.test(signature||''))return false;
 const key=await crypto.subtle.importKey('raw',encode.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(signature.match(/../g).map(pair=>parseInt(pair,16)));
 return crypto.subtle.verify('HMAC',key,bytes,encode.encode(value));
}
async function clientHash(request,env) {
 // Cloudflare supplies this header; raw IP addresses are never persisted or logged.
 return sign('client:'+ (request.headers.get('CF-Connecting-IP') || 'shared-ingress'),env.FORMS_SIGNING_KEY);
}
async function challenge(request,env) {
 if(!trustedOrigin(request,env,true))return fail('origin',403);
 if(!env.DB || !env.FORMS_SIGNING_KEY || !env.PUBLIC_ORIGIN)return fail('unavailable',503);
 const body=Date.now()+'.'+crypto.randomUUID()+'.'+await clientHash(request,env);
 return json({token:body+'.'+await sign(body,env.FORMS_SIGNING_KEY),waitMs:3000});
}
async function acceptForm(request,env) {
 if(!trustedOrigin(request,env))return fail('origin',403);
 if(!env.DB || !env.FORMS_SIGNING_KEY)return fail('unavailable',503);
 let input;try{input=await smallJSON(request);}catch{return fail('invalid_body',400);}
 if(!input || typeof input!=='object' || Array.isArray(input))return fail('invalid_body',400);
 if(input.website !== '')return fail('spam',400);
 if(!['feedback','order','sponsor'].includes(input.kind))return fail('kind',400);
 if(typeof input.message!=='string' || !input.message.trim() || encode.encode(input.message).length>10000)return fail('message',400);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.submissionId||''))return fail('id',400);
 const email=input.kind==='feedback'?null:typeof input.email==='string'?input.email.trim():'';
 if(input.kind==='feedback' && input.email)return fail('feedback_contact',400);
 if(input.kind!=='feedback' && (email.length>254 || !/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(email)))return fail('email',400);
 const parts=String(input.challenge||'').split('.');
 if(parts.length!==4)return fail('challenge',400);
 const signed=parts.slice(0,3).join('.');
 if(!await validSignature(signed,parts[3],env.FORMS_SIGNING_KEY))return fail('challenge',400);
 const now=Date.now(),age=now-Number(parts[0]);
 if(!Number.isFinite(age) || age<0 || age>20*60*1000)return fail('challenge_expired',400);
 if(age<2500)return fail('too_fast',429);
 const client=await clientHash(request,env);if(parts[2]!==client)return fail('challenge',400);
 const digest=await sign(JSON.stringify([input.kind,input.message.trim(),email]),env.FORMS_SIGNING_KEY);
 const id=input.submissionId;
 const prior=await env.DB.prepare('SELECT content_hash FROM form_messages WHERE id=?').bind(id).first();
 if(prior)return prior.content_hash===digest?json({success:true,stored:true,id,duplicate:true}):fail('id_conflict',409);
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO form_messages(id,kind,message,reply_email,content_hash,created_at)
   SELECT ?,?,?,?,?,? WHERE
   (SELECT COUNT(*) FROM form_rate_events WHERE created_at>?) < 500 AND
   (SELECT COUNT(*) FROM form_rate_events WHERE client_hash=? AND created_at>?) < 5 AND
   (SELECT COUNT(*) FROM form_rate_events WHERE client_hash=? AND created_at>?) < 20`).bind(id,input.kind,input.message.trim(),email,digest,now,now-86400000,client,now-600000,client,now-86400000),
  env.DB.prepare('INSERT OR IGNORE INTO form_rate_events(id,client_hash,created_at) SELECT ?,?,? WHERE changes()=1').bind(id,client,now),
  env.DB.prepare('DELETE FROM form_rate_events WHERE created_at<?').bind(now-86400000)
 ]);
 if(results[0].meta.changes===1)return json({success:true,stored:true,id},201);
 const concurrent=await env.DB.prepare('SELECT content_hash FROM form_messages WHERE id=?').bind(id).first();
 if(concurrent)return concurrent.content_hash===digest?json({success:true,stored:true,id,duplicate:true}):fail('id_conflict',409);
 return json({success:false,code:'rate_limit'},429,{'Retry-After':'600'});
}
async function isAuthor(request,env) {
 const id=request.headers.get('oai-authenticated-user-id');if(!id || !env.DB)return false;
 let owner=await env.DB.prepare('SELECT user_id FROM form_author_identity WHERE singleton=1').first();
 if(!owner){
  const verifiedEmail=request.headers.get('oai-authenticated-user-email');
  if(!env.AUTHOR_SETUP_EMAIL || !verifiedEmail || verifiedEmail.toLowerCase()!==env.AUTHOR_SETUP_EMAIL.toLowerCase())return false;
  // Only a platform-verified email can bootstrap the durable Site-specific user ID.
  await env.DB.prepare('INSERT OR IGNORE INTO form_author_identity(singleton,user_id) VALUES(1,?)').bind(id).run();
  owner=await env.DB.prepare('SELECT user_id FROM form_author_identity WHERE singleton=1').first();
 }
 return owner?.user_id===id;
}
async function authorList(request,env) {
 if(!await isAuthor(request,env))return fail('not_author',request.headers.get('oai-authenticated-user-id')?403:401);
 const params=new URL(request.url).searchParams,kind=params.get('kind')||'all',cursor=params.get('cursor');
 if(!['all','feedback','order','sponsor'].includes(kind))return fail('filter',400);
 let where='1=1',bindings=[];
 if(kind!=='all'){where+=' AND kind=?';bindings.push(kind);}
 if(cursor){const match=cursor.match(/^(\d{13}):([a-f0-9-]{36})$/i);if(!match)return fail('cursor',400);where+=' AND (created_at<? OR (created_at=? AND id<?))';bindings.push(Number(match[1]),Number(match[1]),match[2]);}
 const result=await env.DB.prepare(`SELECT id,kind,message,reply_email,created_at,read_at FROM form_messages WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 26`).bind(...bindings).all();
 const rows=result.results.slice(0,25),last=rows.at(-1);
 return json({items:rows,nextCursor:result.results.length>25?last.created_at+':'+last.id:null});
}
async function markRead(request,env,id) {
 if(!trustedOrigin(request,env))return fail('origin',403);
 if(!await isAuthor(request,env))return fail('not_author',401);
 let data;try{data=await smallJSON(request,256);}catch{return fail('invalid_body',400);}
 if(typeof data?.read!=='boolean')return fail('read',400);
 const result=await env.DB.prepare('UPDATE form_messages SET read_at=? WHERE id=?').bind(data.read?Date.now():null,id).run();
 return result.meta.changes?json({success:true}):fail('not_found',404);
}
export default {async fetch(request,env) {
 try {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/forms/challenge')return request.method==='GET'?await challenge(request,env):fail('method',405);
  if(path==='/api/forms')return request.method==='POST'?await acceptForm(request,env):fail('method',405);
  if(path==='/api/author/messages')return request.method==='GET'?await authorList(request,env):fail('method',405);
  const readMatch=path.match(/^\/api\/author\/messages\/([a-f0-9-]{36})\/read$/i);
  if(readMatch)return request.method==='POST'?await markRead(request,env,readMatch[1]):fail('method',405);
  if(path==='/author' || path==='/author/'){
   if(request.method!=='GET')return fail('method',405);
   if(!request.headers.get('oai-authenticated-user-id'))return new Response(null,{status:302,headers:{Location:'/signin-with-chatgpt?return_to=%2Fauthor','Cache-Control':'no-store'}});
   if(!await isAuthor(request,env))return new Response('Доступ разрешён только автору проекта.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
   return new Response(AUTHOR_HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
  }
  if(path==='/author-app.js')return new Response(AUTHOR_JS,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(path.startsWith('/api/') || path.startsWith('/author'))return fail('not_found',404);
  if(!['GET','HEAD'].includes(request.method))return fail('method',405);
  return env.ASSETS?env.ASSETS.fetch(request):new Response('Приложение временно недоступно.',{status:503});
 }catch{return fail('unavailable',503);}
}};
