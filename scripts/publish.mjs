import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {upload} from '@vercel/blob/client';
const [project,filename,title,summary]=process.argv.slice(2);
const base=process.env.RH_URL?.replace(/\/$/,''), token=process.env.RH_TOKEN;
if(!base||!token||!project||!filename) throw new Error('Set RH_URL and RH_TOKEN; run node scripts/publish.mjs <project-slug> <file> [title] [summary]');
const headers={Authorization:`Bearer ${token}`};
async function api(endpoint,body) {const r=await fetch(base+endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(result.error||r.status);return result;}
const bytes=await readFile(filename);
if(bytes.length>100*1024*1024)throw new Error('Maximum file size is 100 MB.');
const init=await api(`/api/v1/projects/${encodeURIComponent(project)}/uploads`,{filename:path.basename(filename)});
if(!init.direct)throw new Error('This server does not have private Blob storage. Use push.sh for local file uploads.');
await upload(init.pathname,new Blob([bytes]),{access:'private',handleUploadUrl:base+'/api/v1/blob/upload',headers,multipart:true});
const result=await api('/api/v1/reports',{project,uploadId:init.id,title,summary,allowed:(process.env.RH_ALLOWED||'').split(',').filter(Boolean)});
console.log(result.url);
