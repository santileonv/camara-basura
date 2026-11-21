// Confirmación operativa de la placa. No guarda secretos ni fotos.
export function createDeviceStatus(now=Date.now){
  let last=null;
  return {
    note(req){
      if(req.headers['x-control-protocol']!=='1')return;
      const mode=req.headers['x-device-mode'],version=req.headers['x-control-version'];
      if(!['running','paused'].includes(mode)||! /^(0|[1-9]\d{0,18})$/.test(version||''))return;
      last={seenAt:now(),paused:mode==='paused',version};
    },
    read(){return last?{...last,online:now()-last.seenAt<20000}:null;}
  };
}
export const deviceStatus=createDeviceStatus();
