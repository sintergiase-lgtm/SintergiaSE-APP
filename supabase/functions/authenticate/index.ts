import { getSql, json, preflight, issueToken, clientIp, sha256Hex } from './session.ts'
const SESSION_TTL_SECONDS=8*60*60
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return preflight(req)
 if(req.method==='GET'){try{const sql=getSql();const rows=await sql`select exists(select 1 from sintergia.server_secrets where name='session_hmac') as secret, exists(select 1 from sintergia.credentials) as credentials`;const configured=!!rows[0]?.secret&&!!rows[0]?.credentials;return json(req,200,{ok:true,service:'authenticate',configured})}catch(e){console.error('authenticate_health',String((e as Error)?.message??e));return json(req,503,{ok:false,error:'service_unavailable'})}}
 if(req.method!=='POST')return json(req,405,{ok:false,error:'Método no permitido'})
 let body:any;try{body=await req.json()}catch(_){return json(req,400,{ok:false,error:'Petición no válida'})}
 const scope=body?.scope,password=typeof body?.password==='string'?body.password:''
 if((scope!=='modo'&&scope!=='operacion')||password.length>200)return json(req,400,{ok:false,error:'Petición no válida'})
 if(password.length===0)return json(req,401,{ok:false,error:'Contraseña incorrecta'})
 try{const sql=getSql(),key=await sha256Hex(clientIp(req)+'|'+scope),rows=await sql`select sintergia.auth_check(${key},${scope},${password}) as r`,r=rows[0]?.r??{status:'invalid'};if(r.status==='ok'){const issued=await issueToken({sub:r.id,scope,tenant:'sintergia'},SESSION_TTL_SECONDS);return json(req,200,{ok:true,token:issued.token,scope,id:r.id,expiresAt:issued.expiresAt})}if(r.status==='blocked'){const wait=Number(r.retry_after)||900;return json(req,429,{ok:false,error:'Demasiados intentos. Inténtalo de nuevo en '+Math.ceil(wait/60)+' min.',retryAfter:wait},{'Retry-After':String(wait)})}if(r.status==='unconfigured')return json(req,503,{ok:false,error:'Las contraseñas aún no están configuradas en el servidor.'});return json(req,401,{ok:false,error:'Contraseña incorrecta'})}catch(e){console.error('authenticate_error',String((e as Error)?.message??e));return json(req,503,{ok:false,error:'Servicio de acceso no disponible'})}
})