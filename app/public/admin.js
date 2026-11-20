const form = document.getElementById('adminForm');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const enter = document.getElementById('enter'), password = document.getElementById('password'), error = document.getElementById('adminError');
  enter.disabled = true; error.textContent = '';
  try {
    const response = await fetch('/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ password:password.value }), signal:AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la administración.');
    password.value = ''; window.location.replace('/');
  } catch (cause) { error.textContent = cause.message || 'No se pudo conectar. Intenta nuevamente.'; }
  finally { enter.disabled = false; }
});
