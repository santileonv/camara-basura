import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { createServer } from '../lib/http-server.js';
import { createStore } from '../lib/store.js';
import { createIngestHandler } from '../api/ingest.js';
import { createStateHandler } from '../api/state.js';
import { createHistoryHandler } from '../api/history.js';
import login from '../api/login.js';
import logout from '../api/logout.js';
import { classify } from '../lib/model.js';

test('Servidor HTTP: foto real, modelo, PostgreSQL, autenticacion, historial y salud', async () => {
  process.env.CAMERA_TOKEN='test-camera-token-'.repeat(3);
  process.env.DASHBOARD_PASSWORD='test-dashboard-password';
  process.env.SESSION_SECRET='test-session-secret-'.repeat(3);
  process.env.NODE_ENV='production';
  const db = new PGlite(); let app;
  try {
    await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
    const store = createStore(async(sql,params)=>(await db.query(sql,params)).rows);
    let healthy = true;
    const routes = {'/api/ingest':createIngestHandler(classify,store.saveReading),
      '/api/state':createStateHandler(store.readState),'/api/history':createHistoryHandler(store.readHistory),
      '/api/login':login,'/api/logout':logout};
    app=createServer({routes,health:async()=>{if(!healthy)throw new Error('test-health');await db.query('SELECT 1');}});
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+app.server.address().port;
    const request=(path,options)=>fetch(base+path,options);
    assert.equal((await request('/healthz')).status,200);
    const page=await request('/');assert.match(await page.text(),/Monitor de basura/);
    assert.ok(page.headers.get('content-security-policy'));
    for(const path of ['/model/weights.bin','/.env','/server.js','/../package.json'])assert.equal((await request(path)).status,404);
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/history')).status,401);
    assert.equal((await request('/api/ingest',{method:'POST'})).status,401);
    const logged=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:process.env.DASHBOARD_PASSWORD})});
    assert.equal(logged.status,200);
    assert.match(logged.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Secure/);
    const cookie=logged.headers.get('set-cookie').split(';')[0];
    const jpeg=await sharp({create:{width:800,height:600,channels:3,background:'#8f7357'}}).jpeg().toBuffer();
    for(let seq=1;seq<=5;seq++){
      const result=await request('/api/ingest',{method:'POST',headers:{authorization:'Bearer '+process.env.CAMERA_TOKEN,
        'content-type':'image/jpeg','x-camera-boot':'0123456789abcdef','x-frame-seq':String(seq)},body:jpeg});
      assert.equal(result.status,200,await result.text());
    }
    const state=await(await request('/api/state',{headers:{cookie}})).json();
    assert.equal(state.online,true);assert.equal(state.state.scores.length,4);assert.equal(state.state.readings,5);
    const history=await(await request('/api/history?limit=2',{headers:{cookie}})).json();
    assert.equal(history.entries.length,2);assert.ok(history.nextCursor);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM mediciones')).rows[0].n),5);
    healthy=false;assert.equal((await request('/healthz')).status,503);
    assert.equal((await request('/api/logout',{method:'POST',headers:{cookie}})).status,200);
    app.drain();assert.equal((await request('/healthz')).status,503);
  } finally {
    if(app)await new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();});
    await db.close();
  }
});

test('Recepcion limita analisis simultaneos sin acumular imagenes', async()=>{
  let release,entered; const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const app=createServer({health:async()=>{},routes:{'/api/ingest':async(req,res)=>{entered();await gate;res.end('ok');}}});
  try{
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+app.server.address().port+'/api/ingest';
    const first=fetch(url,{method:'POST'});await waiting;
    const second=await fetch(url,{method:'POST'});assert.equal(second.status,429);assert.equal(second.headers.get('retry-after'),'15');
    release();assert.equal((await first).status,200);
  }finally{release();await new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();});}
});
