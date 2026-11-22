import {adminAuth} from './admin-auth.js';
// Una sola imagen reciente en RAM. No escribe fotografías ni mediciones en PostgreSQL.
export function createLivePreview({auth=adminAuth,now=Date.now,leaseMs=15000,maxMs=300000}={}){
  let lease=null,frame=null,sequence=0,timer;const listeners=new Set();
  function clear(){clearTimeout(timer);lease=null;frame=null;for(const listener of [...listeners])listener(null);}
  function active(){
    if(lease&&(now()>=lease.expiresAt||auth.lookup(lease.request)?.key!==lease.owner))clear();
    return !!lease;
  }
  function arm(){clearTimeout(timer);timer=setTimeout(()=>{if(active())arm();},Math.max(1,lease.expiresAt-now()));timer.unref?.();}
  function status(req){const enabled=active();return {active:enabled,owned:enabled&&auth.lookup(req)?.key===lease.owner,expiresAt:lease?.expiresAt??null,stopAt:lease?.stopAt??null,frameAt:frame?.receivedAt??null};}
  function command(req,action){
    const session=auth.requireMutation(req),enabled=active();
    if(enabled&&lease.owner!==session.key)throw Object.assign(new Error('Otra sesión está usando la vista en vivo.'),{status:409});
    if(action==='stop'){clear();return status(req);}
    if(action==='keepalive'&&!enabled)throw Object.assign(new Error('La vista se detuvo. Pulsa Iniciar video para volver a activarla.'),{status:409});
    if(!enabled)lease={owner:session.key,request:{headers:{cookie:req.headers.cookie}},stopAt:Math.min(now()+maxMs,session.expiresAt)};
    lease.expiresAt=Math.min(now()+leaseMs,lease.stopAt);arm();
    return status(req);
  }
  function accept(bytes){
    if(!active())throw Object.assign(new Error('La vista en vivo no está activa.'),{status:409});
    frame={bytes,sequence:++sequence,receivedAt:now()};for(const listener of [...listeners])listener(frame);
  }
  return {active,status,command,accept,clear,
    latest(){return active()&&frame&&now()-frame.receivedAt<3000?frame:null;},
    subscribe(listener){if(listeners.size>=4)throw Object.assign(new Error('Hay demasiadas vistas abiertas. Cierra otra pestaña.'),{status:429});listeners.add(listener);return()=>listeners.delete(listener);}
  };
}
export const livePreview=createLivePreview();
