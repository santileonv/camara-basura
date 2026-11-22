import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminLive} from '../public/admin-live.js';
class Element{
  constructor(){this.attributes={};this.listeners={};this.value='180';this.hidden=true;this.disabled=false;this.textContent='';const names=new Set();this.classList={toggle(n,on){if(on)names.add(n);else names.delete(n);},contains:n=>names.has(n)};}
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  dispatch(name){return this.listeners[name]?.();}
}
function setup(custom){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const handlers={},doc={hidden:false,addEventListener(name,fn){handlers[name]=fn;}},timers=new Map();let next=0,authenticated=true,busy=false;const calls=[],errors=[];
  const request=custom??(async(path,options)=>{calls.push({path,...options});return {active:true,frameAt:Date.now(),device:{protocol:2,online:true}};});
  const ui=createAdminLive({get,document:doc,request,isAuthenticated:()=>authenticated,isBusy:()=>busy,onError:e=>errors.push(e),page:{addEventListener(){}},schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
  return {ui,get,doc,handlers,timers,calls,errors,auth(value){authenticated=value;},busy(value){busy=value;}};
}

test('Panel de video: iniciar, renovar, girar y detener sin tocar el análisis ni exponer tokens',async()=>{
  const f=setup();f.ui.enable();assert.equal(f.get('toggleLive').disabled,false);
  f.busy(true);await f.get('toggleLive').dispatch('click');assert.equal(f.calls.length,0);f.busy(false);
  await f.get('toggleLive').dispatch('click');assert.equal(JSON.parse(f.calls[0].body).action,'start');
  assert.match(f.get('livePhoto').attributes.src,/^\/api\/admin\/live\/stream\?t=\d+$/);assert.equal(f.get('livePhoto').hidden,false);assert.equal(f.get('toggleLive').textContent,'Detener video');
  f.ui.render();assert.equal(f.get('livePhoto').classList.contains('rotated'),true);f.get('cameraRotation').value='0';f.ui.render();assert.equal(f.get('livePhoto').classList.contains('rotated'),false);
  const renew=[...f.timers.values()].at(-1);f.timers.clear();await renew();assert.equal(JSON.parse(f.calls.at(-1).body).action,'keepalive');
  await f.get('toggleLive').dispatch('click');assert.equal(JSON.parse(f.calls.at(-1).body).action,'stop');assert.equal(f.calls.at(-1).keepalive,true);assert.equal(f.get('livePhoto').attributes.src,undefined);assert.equal(f.get('toggleLive').textContent,'Iniciar video');assert.equal(f.timers.size,0);
  await f.get('toggleLive').dispatch('click');f.doc.hidden=true;await f.handlers.visibilitychange();await new Promise(r=>setImmediate(r));assert.equal(f.get('livePhoto').attributes.src,undefined);assert.equal(JSON.parse(f.calls.at(-1).body).action,'stop');
  f.auth(false);f.ui.disable();assert.equal(f.get('toggleLive').disabled,true);assert.ok(f.calls.every(c=>c.path==='live'));
});

test('Ocultar pestaña mientras se inicia video revoca la solicitud y no deja una imagen activa',async()=>{
  let resolve;const actions=[];const f=setup(async(_path,{body})=>{const action=JSON.parse(body).action;actions.push(action);if(action==='start')return new Promise(r=>{resolve=r;});return {};});
  f.ui.enable();const starting=f.get('toggleLive').dispatch('click');f.doc.hidden=true;f.handlers.visibilitychange();resolve({active:true,frameAt:Date.now()});await starting;await new Promise(r=>setImmediate(r));
  assert.deepEqual(actions,['start','stop']);assert.equal(f.get('livePhoto').attributes.src,undefined);assert.equal(f.get('livePhoto').hidden,true);assert.equal(f.timers.size,0);
});
