const $ = id => document.getElementById(id);
let csrfToken = null, camera = null, latest = null, authenticated = false, busy = false, timer;
const percent = value => `${Math.round(value * 100)} %`;
function setSession(data) {
  authenticated = !!data.authenticated; csrfToken = data.csrfToken || null;
  $('loginPanel').hidden = authenticated; $('adminPanel').hidden = !authenticated;
  if (!authenticated) {
    clearTimeout(timer); camera = null; latest = null; $('adminPhoto').removeAttribute('src');
    $('adminStatus').textContent = data.configured === false ? 'El administrador todavía no está configurado en el servidor.' : 'Inicia sesión para cambiar los ajustes.';
  } else $('adminStatus').textContent = 'Solo tu sesión puede guardar cambios. El monitor público sigue disponible.';
}
async function request(path, options = {}) {
  const mutation = options.method && options.method !== 'GET';
  const response = await fetch('/api/admin/' + path, {cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000),...options,
    headers:{...(mutation ? {'Content-Type':'application/json'} : {}),...(csrfToken ? {'X-CSRF-Token':csrfToken} : {}),...options.headers}});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') setSession({authenticated:false});
    throw new Error(data.error || 'No se pudo completar la solicitud.');
  }
  return data;
}
function setBusy(value) {
  busy=value; $('loginButton').disabled=value; $('logoutButton').disabled=value;
  $('reloadSettings').disabled=value; $('cameraRotation').disabled=value;
  $('thresholdPercent').disabled=value; $('thresholdSlider').disabled=value; renderDraft();
}
function renderDraft() {
  const threshold = Number($('thresholdPercent').value), rotation = Number($('cameraRotation').value);
  const valid = $('thresholdPercent').value.trim() !== '' && Number.isInteger(threshold) && threshold >= 60 && threshold <= 95;
  const dirty = !!camera && (rotation !== camera.rotation || Math.abs(threshold / 100 - camera.threshold) > .00001);
  $('trashLimit').textContent=valid ? threshold + ' %' : '—'; $('clearLimit').textContent=valid ? (100-threshold) + ' %' : '—';
  $('saveSettings').disabled=busy || !valid || !dirty;
  $('draftStatus').textContent=!valid ? 'Elige una exigencia entera entre 60 y 95 %.' : dirty ? 'Tienes cambios sin guardar. La vista previa todavía no cambia el análisis.' : 'No hay cambios pendientes.';
  if (latest?.preview) {
    $('adminPhoto').hidden=false; $('adminPhotoEmpty').hidden=true;
    $('adminPhoto').classList.toggle('rotated',rotation !== (latest.rotation ?? 0));
    $('previewStatus').textContent='Vista previa del giro seleccionado · captura del ' + new Date(latest.receivedAt).toLocaleString('es-CL');
  }
}
function applyConfiguration(data) {
  camera=data.camera; $('cameraRotation').value=String(camera.rotation);
  $('thresholdPercent').value=String(Math.round(camera.threshold*100)); $('thresholdSlider').value=$('thresholdPercent').value;
  $('savedSettings').textContent=`Guardado: ${camera.rotation === 180 ? 'giro de 180°' : 'orientación normal (0°)'} · exigencia ${percent(camera.threshold)}.`;
  $('adminDecisionPolicy').textContent=`${data.decision.profile === 'demo' ? 'Modo demo' : 'Modo estable'}: promedio de hasta ${data.decision.windowSize} capturas y ${data.decision.confirmationsRequired} evaluaciones seguidas para confirmar.`;
  renderDraft();
}
async function preview() {
  clearTimeout(timer);
  if (!authenticated || document.hidden) return;
  try {
    const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error();
    const data=await response.json();
    if (!authenticated) return;
    latest=data.state;
    if(latest?.preview) {
      const src='data:image/jpeg;base64,'+latest.preview;
      if($('adminPhoto').getAttribute('src')!==src)$('adminPhoto').src=src;
    }else{
      $('adminPhoto').hidden=true;$('adminPhotoEmpty').hidden=false;$('previewStatus').textContent='Todavía no hay una captura.';
    }
    renderDraft();
  }catch{if(authenticated)$('previewStatus').textContent='No se pudo actualizar la vista previa. Se volverá a intentar.';}
  finally{if(authenticated&&!document.hidden)timer=setTimeout(preview,5000);}
}
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(busy)return; setBusy(true); $('adminError').textContent='';
  try {
    const password=$('adminPassword').value; $('adminPassword').value='';
    setSession(await request('login',{method:'POST',body:JSON.stringify({password})}));
    applyConfiguration(await request('settings')); preview();
  }catch(error){$('adminError').textContent=error.message;}
  finally{setBusy(false);}
});
$('settingsForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||$('saveSettings').disabled)return;setBusy(true);$('adminError').textContent='';
  try{
    const data=await request('settings',{method:'PUT',body:JSON.stringify({rotation:Number($('cameraRotation').value),threshold:Number($('thresholdPercent').value)/100,expectedVersion:camera.version})});
    applyConfiguration(data);$('adminStatus').textContent=data.message;preview();
  }catch(error){$('adminError').textContent=error.message;}
  finally{setBusy(false);}
});
$('reloadSettings').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);$('adminError').textContent='';
  try{applyConfiguration(await request('settings'));$('adminStatus').textContent='Ajustes guardados recargados. Se descartó el borrador de esta pestaña.';}
  catch(error){$('adminError').textContent=error.message;}finally{setBusy(false);}
});
$('logoutButton').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);$('adminError').textContent='';
  try{await request('logout',{method:'POST',body:'{}'});setSession({authenticated:false});$('adminStatus').textContent='Sesión cerrada.';}
  catch(error){$('adminError').textContent=error.message;}finally{setBusy(false);}
});
$('thresholdPercent').addEventListener('input',()=>{$('thresholdSlider').value=$('thresholdPercent').value;renderDraft();});
$('thresholdSlider').addEventListener('input',()=>{$('thresholdPercent').value=$('thresholdSlider').value;renderDraft();});
$('cameraRotation').addEventListener('change',renderDraft);
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&authenticated)preview();});
async function start(){
  setBusy(true);
  try{setSession(await request('session'));if(authenticated){applyConfiguration(await request('settings'));preview();}}
  catch(error){setSession({authenticated:false});$('adminError').textContent=error.message;}
  finally{setBusy(false);}
}
start();
