'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
process.env.DB_TEST_MODE='pglite';
process.env.ADMIN_EMAIL='owner@example.test';
process.env.ADMIN_PASSWORD='integration-test-only';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/researchlab-');
const handler=require('../server');
const db=require('../lib/db');
const auth=require('../lib/auth');
const server=http.createServer(handler);
let base,cookie,project,report,token,memberCookie;
const started=new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{base='http://127.0.0.1:'+server.address().port;resolve();}));
async function call(path,{method='GET',body,session=cookie,headers={}}={}) {
 await started;
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Requested-With':'research-hub',...(session?{Cookie:session}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
 return {status:response.status,headers:response.headers,data};
}
after(async()=>{await new Promise(r=>server.close(r));await db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
test('database, authentication, access controls and agent lifecycle',async t=>{
 await t.test('migrations and readiness',async()=>{assert.equal((await call('/healthz')).status,200)});
 await t.test('anonymous access denied',async()=>{assert.equal((await call('/api/app/projects')).status,401)});
 await t.test('admin authentication',async()=>{const r=await call('/api/app/login/admin',{method:'POST',body:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.match(cookie,/rh_session=/)});
 await t.test('create project and member',async()=>{const r=await call('/api/app/projects',{method:'POST',body:{name:'Battery Research',emails:['member@example.test','other@example.test']}});assert.equal(r.status,201);project=r.data.project;assert.ok(project.id)});
 await t.test('publish restricted report',async()=>{const r=await call(`/api/app/projects/${project.slug}/reports`,{method:'POST',body:{title:'Cell outlook',content:'# Private outlook',access:'restricted',allowed:['member@example.test']}});assert.equal(r.status,201);report=r.data.report;assert.equal(report.access,'restricted')});
 await t.test('single-use member link',async()=>{const r=await call(`/api/app/projects/${project.slug}/members/member%40example.test/link`,{method:'POST'});assert.equal(r.status,200);const pathname=new URL(r.data.url).pathname;const login=await call(pathname,{session:null});assert.equal(login.status,303);memberCookie=login.headers.get('set-cookie').split(';')[0];const repeat=await call(pathname,{session:null});assert.equal(repeat.headers.get('location'),'/login?expired=1')});
 await t.test('member reads report and comments',async()=>{assert.equal((await call(`/api/app/reports/${report.id}`,{session:memberCookie})).status,200);const comment=await call(`/api/app/reports/${report.id}/comments`,{session:memberCookie,method:'POST',body:{body:'Please add sources.'}});assert.equal(comment.status,201);assert.equal(comment.data.comments[0].body,'Please add sources.');const raw=await call(`/r/${report.id}/raw`,{session:memberCookie});assert.equal(raw.status,200);assert.match(raw.headers.get('content-security-policy'),/sandbox/);assert.equal(raw.headers.get('cache-control'),'private, no-store')});
 await t.test('unauthorized member cannot read restricted report or raw file',async()=>{const session='rh_session='+await auth.createSession('other@example.test',false);assert.equal((await call(`/api/app/reports/${report.id}`,{session})).status,404);assert.equal((await call(`/r/${report.id}/raw`,{session})).status,404);assert.equal((await call(`/api/app/projects/${project.slug}`,{session})).data.reports.length,0)});
 await t.test('member cannot publish or mint tokens',async()=>{assert.equal((await call('/api/app/tokens',{method:'POST',body:{},session:memberCookie})).status,403)});
 await t.test('token API returns resolved project objects',async()=>{const r=await call('/api/app/tokens',{method:'POST',body:{name:'agent'}});token=r.data.token;const list=await call('/api/v1/projects',{headers:{Authorization:'Bearer '+token},session:null});assert.equal(list.status,200);assert.equal(list.data.projects[0].slug,project.slug);assert.ok(list.data.projects[0].members.includes('member@example.test'));const pub=await call('/api/v1/reports',{method:'POST',session:null,headers:{Authorization:'Bearer '+token},body:{project:project.slug,content:'# Agent report'}});assert.equal(pub.status,201)});
 await t.test('CSRF protection',async()=>{assert.equal((await call('/api/app/tokens',{method:'POST',body:{},headers:{'X-Requested-With':''}})).status,403)});
 await t.test('five incorrect OTPs remain counted despite failed requests',async()=>{const code=await auth.issueOtp('member@example.test');for(let i=0;i<5;i++)assert.equal((await call('/api/app/login/verify',{method:'POST',body:{email:'member@example.test',code:code==='000000'?'111111':'000000'}})).status,401);assert.equal((await call('/api/app/login/verify',{method:'POST',body:{email:'member@example.test',code}})).status,401)});
 await t.test('revocation immediately blocks report and raw content',async()=>{assert.equal((await call(`/api/app/projects/${project.slug}/members/member%40example.test`,{method:'DELETE'})).status,200);assert.equal((await call(`/r/${report.id}/raw`,{session:memberCookie})).status,404)});
 await t.test('invalid restrictions fail closed',async()=>{const r=await call(`/api/app/projects/${project.slug}/reports`,{method:'POST',body:{content:'# secret',access:'restricted',allowed:['outsider@example.test']}});assert.equal(r.status,400)});
 await t.test('report and project deletion',async()=>{assert.equal((await call(`/api/app/reports/${report.id}`,{method:'DELETE'})).status,200);assert.equal((await call(`/api/app/projects/${project.slug}`,{method:'DELETE'})).status,200)});
});
