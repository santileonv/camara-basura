import {adminAuth} from '../lib/admin-auth.js';
import {cameraAuthorized} from '../lib/auth.js';
import {body,reply} from '../lib/config.js';
import {livePreview} from '../lib/live-preview.js';
import {deviceStatus} from '../lib/device-status.js';

export function createLivePreviewHandlers({auth=adminAuth,preview=livePreview,device=deviceStatus,heartbeatMs=1000,now=Date.now}={}){
  let uploading=false,lastUpload=-Infinity;
  return {
    control:async(req,res)=>{
      try{
        if(req.method==='GET'){auth.requireSession(req);return reply(res,200,{...preview.status(req),device:device.read()});}
        if(req.method!=='PUT')return reply(res,405,{error:'Usa GET o PUT.'});
        auth.requireMutation(req);
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{error:'Se requiere JSON.'});
        let input;try{input=JSON.parse((await body(req,2048)).toString('utf8'));}catch(e){if(e.status)throw e;return reply(res,400,{error:'JSON inválido.'});}
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!['start','keepalive','stop'].includes(input.action))return reply(res,400,{error:'Operación de video inválida.'});
        return reply(res,200,{...preview.command(req,input.action),device:device.read()});
      }catch(e){reply(res,e.status||503,{error:e.status?e.message:'No se pudo cambiar la vista en vivo.'});}
    },
    upload:async(req,res)=>{
      let claimed=false;
      try{
        if(req.method!=='POST')return reply(res,405,{error:'Usa POST.'});
        if(!cameraAuthorized(req))return reply(res,401,{error:'Token de cámara incorrecto.'});
        const enabled=preview.active();res.setHeader('X-Preview-Active',enabled?'1':'0');
        if(!enabled)return reply(res,409,{error:'La vista en vivo no está activa.'});
        if(uploading||now()-lastUpload<300)return reply(res,429,{error:'Espera al siguiente cuadro.'});
        if(!/^image\/jpeg(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{error:'Se requiere JPEG.'});
        uploading=true;claimed=true;
        const jpeg=await body(req,500000);
        if(jpeg.length<4||jpeg[0]!==255||jpeg[1]!==216||jpeg.at(-2)!==255||jpeg.at(-1)!==217)return reply(res,415,{error:'JPEG inválido.'});
        // Verificar la autorización de la vista otra vez después de recibir el cuerpo.
        preview.accept(jpeg);lastUpload=now();device.note(req);
        res.setHeader('X-Preview-Active',preview.active()?'1':'0');return reply(res,200,{ok:true});
      }catch(e){if(!preview.active())res.setHeader('X-Preview-Active','0');reply(res,e.status||503,{error:e.status?e.message:'No se pudo recibir el cuadro.'});}
      finally{if(claimed)uploading=false;}
    },
    stream:async(req,res)=>{
      let dispose,timer,done=false;
      const finish=()=>{if(done)return;done=true;clearInterval(timer);dispose?.();res.end();};
      try{
        if(req.method!=='GET')return reply(res,405,{error:'Usa GET.'});
        auth.requireSession(req);if(!preview.active())return reply(res,409,{error:'Inicia la vista en vivo.'});
        const send=frame=>{
          if(done)return;
          if(res.destroyed||res.writableEnded)return finish();
          if(!frame||!auth.lookup(req)||!preview.active())return finish();
          // No acumular cuadros de un cliente lento; el próximo cuadro sustituye al anterior.
          if(res.writableNeedDrain)return;
          const header=Buffer.from(`--xiao-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.bytes.length}\r\n\r\n`);
          res.write(Buffer.concat([header,frame.bytes,Buffer.from('\r\n')]));
        };
        dispose=preview.subscribe(send);
        res.statusCode=200;res.setHeader('Content-Type','multipart/x-mixed-replace; boundary=xiao-frame');
        res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Accel-Buffering','no');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        res.flushHeaders();res.on('close',finish);res.on('error',finish);
        timer=setInterval(()=>{if(!auth.lookup(req)||!preview.active())finish();},heartbeatMs);timer.unref?.();
        const latest=preview.latest();if(latest)send(latest);
      }catch(e){clearInterval(timer);dispose?.();if(!res.headersSent)reply(res,e.status||503,{error:e.status?e.message:'No se pudo abrir el video.'});else finish();}
    }
  };
}
export const livePreviewHandlers=createLivePreviewHandlers();
