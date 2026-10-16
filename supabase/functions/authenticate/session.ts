import postgres from 'npm:postgres@3.4.3'
import { validateSessionClaims } from '../_shared/session-claims.mjs'
const enc=new TextEncoder(),dec=new TextDecoder();let _sql:any=null
export function getSql(){if(!_sql){const url=Deno.env.get('SUPABASE_DB_URL');if(!url)throw new Error('missing_db_url');_sql=postgres(url,{max:1,prepare:false,idle_timeout:20,connect_timeout:10})}return _sql}
const DEFAULT_ALLOWED_HEADERS='authorization, content-type, x-requested-with, x-sintergia-request-id, x-sintergia-health-check, apikey, x-client-info'
const DEFAULT_ALLOWED_ORIGINS=['https://sintergiase-lgtm.github.io','https://sintergiase-app.pages.dev']
function allowedOrigin(origin:string){
  const configured=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean)
  const allowed=new Set([...DEFAULT_ALLOWED_ORIGINS,...configured].map(value=>{try{return new URL(value).origin===value?value:''}catch{return ''}}).filter(Boolean))
  return !!origin&&allowed.has(origin)
}
function allowedHeaders(req:Request){
  const requested=(req.headers.get('access-control-request-headers')??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)
  const safe=new Set(DEFAULT_ALLOWED_HEADERS.split(',').map(s=>s.trim()))
  for(const h of requested) if(!safe.has(h)&&!h.startsWith('x-sintergia-')) return DEFAULT_ALLOWED_HEADERS
  return requested.length?requested.join(', '):DEFAULT_ALLOWED_HEADERS
}
export function corsHeaders(req:Request){
  const origin=req.headers.get('origin')??''
  const h:Record<string,string>={
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':allowedHeaders(req),
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin'
  }
  if(origin&&allowedOrigin(origin)){ h['Access-Control-Allow-Origin']=origin }
  return h
}
export function preflight(req:Request){return new Response(null,{status:204,headers:corsHeaders(req)})}
export function json(req:Request,status:number,body:unknown,extra:Record<string,string>={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders(req),...extra}})}
export function clientIp(req:Request){
  const trustedIp=req.headers.get('cf-connecting-ip')?.trim()||''
  return trustedIp.length>0&&trustedIp.length<=45?trustedIp:'unknown'
}
export async function sha256Hex(text:string){const d=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('')}
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64urlDecode(str:string){const pad='='.repeat((4-str.length%4)%4),bin=atob(str.replace(/-/g,'+').replace(/_/g,'/')+pad),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
let _key:CryptoKey|null=null,_keyAt=0
async function hmacKey(){if(_key&&Date.now()-_keyAt<10*60*1000)return _key;const sql=getSql(),rows=await sql`select value from sintergia.server_secrets where name='session_hmac'`;if(!rows.length)throw new Error('missing_session_secret');_key=await crypto.subtle.importKey('raw',enc.encode(String(rows[0].value)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);_keyAt=Date.now();return _key}
export async function issueToken(claims:Record<string,unknown>,ttlSeconds:number){const now=Math.floor(Date.now()/1000),payload={...claims,iat:now,exp:now+ttlSeconds,jti:crypto.randomUUID()},p=b64url(enc.encode(JSON.stringify(payload))),sig=new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(),enc.encode(p)));return {token:'v1.'+p+'.'+b64url(sig),expiresAt:payload.exp*1000}}
export async function verifyToken(token:string){const key=await hmacKey();try{const parts=token.split('.');if(parts.length!==3||parts[0]!=='v1')return null;const ok=await crypto.subtle.verify('HMAC',key,b64urlDecode(parts[2]),enc.encode(parts[1]));if(!ok)return null;const payload=JSON.parse(dec.decode(b64urlDecode(parts[1])));return validateSessionClaims(payload)}catch(_){return null}}