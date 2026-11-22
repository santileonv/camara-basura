export function createAdminLive({get,document:doc,request,isAuthenticated,isBusy,onError,page=globalThis.window,schedule=setTimeout,cancel=clearTimeout}){
  let enabled=false,viewing=false,pending=false,timer,generation=0;
  function render(){
    get('toggleLive').textContent=viewing?'Detener video':'Iniciar video';
    get('toggleLive').disabled=!enabled||pending||isBusy();
    get('livePhoto').classList.toggle('rotated',get('cameraRotation').value==='180');
  }
  function clearImage(){get('livePhoto').removeAttribute('src');get('livePhoto').hidden=true;get('liveEmpty').hidden=false;}
  async function stop(remote=true,message='Video detenido. Puedes iniciarlo cuando necesites ajustar la posición.'){
    const wasViewing=viewing;viewing=false;const expected=++generation;cancel(timer);clearImage();get('liveStatus').textContent=message;render();
    if(remote&&wasViewing&&isAuthenticated()){pending=true;render();try{await request('live',{method:'PUT',body:JSON.stringify({action:'stop'}),keepalive:true});}catch{}finally{if(expected===generation)pending=false;render();}}
  }
  function status(data){
    if(data.frameAt&&Date.now()-data.frameAt<8000){get('livePhoto').hidden=false;get('liveEmpty').hidden=true;get('liveStatus').textContent='Video activo. Ajusta la posición de la cámara; estos cuadros no se analizan ni guardan.';}
    else{get('livePhoto').hidden=true;get('liveEmpty').hidden=false;get('liveStatus').textContent=data.device?.online&&data.device.protocol!==2?
      'La placa necesita el firmware nuevo con video. Consérvalo junto con tu config.h y vuelve a cargarla.':'Esperando imágenes de la XIAO. Comprueba que esté conectada y tenga el firmware nuevo con video.';}
  }
  async function renew(expected){
    if(!viewing||!enabled||expected!==generation)return;
    if(doc.hidden||!isAuthenticated())return stop(true);
    try{const data=await request('live',{method:'PUT',body:JSON.stringify({action:'keepalive'})});if(viewing&&expected===generation)status(data);}
    catch(error){if(expected===generation){await stop(true,error.message);onError(error.message);}}
    finally{if(viewing&&expected===generation)timer=schedule(()=>renew(expected),5000);}
  }
  get('toggleLive').addEventListener('click',async()=>{
    if(!enabled||pending||isBusy())return;
    if(viewing)return stop(true);
    pending=true;const expected=++generation;render();onError('');
    try{
      const data=await request('live',{method:'PUT',body:JSON.stringify({action:'start'})});
      if(!enabled||expected!==generation||doc.hidden){if(isAuthenticated())request('live',{method:'PUT',body:JSON.stringify({action:'stop'}),keepalive:true}).catch(()=>{});return;}
      viewing=true;get('livePhoto').setAttribute('src','/api/admin/live/stream?t='+Date.now());status(data);
      timer=schedule(()=>renew(expected),5000);
    }catch(error){if(expected===generation){get('liveStatus').textContent=error.message;onError(error.message);}}
    finally{pending=false;render();}
  });
  get('livePhoto').addEventListener('load',()=>{if(viewing){get('livePhoto').hidden=false;get('liveEmpty').hidden=true;get('liveStatus').textContent='Video activo. Estos cuadros no se analizan ni guardan.';}});
  get('livePhoto').addEventListener('error',()=>{if(viewing)stop(true,'La conexión de video se cerró. Pulsa Iniciar video para reconectar.');});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stop(true);});
  page?.addEventListener('pagehide',()=>{stop(true);});
  return {enable(){enabled=true;render();},disable(){enabled=false;pending=false;stop(false);},render};
}
