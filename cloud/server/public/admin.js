const $ = s => document.querySelector(s);
let token = localStorage.getItem('ec_audio_admin_token') || '';
let socket;
const api = async (url, options={}) => {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json');
  const response = await fetch(url,{...options,headers});
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000)}
function showDashboard(){ $('#login').hidden=true;$('#dashboard').hidden=false;loadPlugins();connectLive(); }
function showLogin(){ $('#dashboard').hidden=true;$('#login').hidden=false; }
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#loginError').textContent='';
 const form=new FormData(e.currentTarget);
 try{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:form.get('email'),password:form.get('password')})});token=data.token;localStorage.setItem('ec_audio_admin_token',token);showDashboard();}
 catch(err){$('#loginError').textContent=err.message;}
});
$('#logout').addEventListener('click',()=>{token='';localStorage.removeItem('ec_audio_admin_token');if(socket)socket.close();showLogin()});
$('#uploadForm').addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget;const button=form.querySelector('button');button.disabled=true;$('#uploadStatus').textContent='Subiendo instalador...';
 try{const data=new FormData(form);await api('/api/admin/plugins',{method:'POST',body:data});form.reset();form.elements.manufacturer.value='EC Audio';form.elements.version.value='1.0.0';$('#uploadStatus').textContent='Publicado correctamente.';toast('Plugin publicado. Clientes conectados recibirán el cambio.');await loadPlugins();}
 catch(err){$('#uploadStatus').textContent=err.message;}
 finally{button.disabled=false;}
});
async function loadPlugins(){
 try{const data=await api('/api/admin/plugins');const items=data.plugins||[];$('#total').textContent=items.length;$('#published').textContent=items.filter(p=>p.published).length;
 $('#list').innerHTML=items.length?items.map(p=>`<article class="release"><div class="info"><b>${escapeHTML(p.name)} <small>v${escapeHTML(p.version)}</small></b><small>${escapeHTML(p.manufacturer)} · ${escapeHTML(p.category)} · ${formatBytes(p.sizeBytes)}</small></div><span class="tag ${p.published?'':'draft'}">${p.published?'LIVE':'HIDDEN'}</span><button data-toggle="${p.id}" data-published="${p.published}">${p.published?'Ocultar':'Publicar'}</button><button class="danger" data-delete="${p.id}">Quitar</button></article>`).join(''):'<div class="empty">Todavía no has publicado plugins.</div>';
 }catch(err){toast(err.message)}
}
$('#list').addEventListener('click',async e=>{
 const toggle=e.target.closest('[data-toggle]'),del=e.target.closest('[data-delete]');
 try{if(toggle){await api('/api/admin/plugins/'+encodeURIComponent(toggle.dataset.toggle),{method:'PATCH',body:JSON.stringify({published:toggle.dataset.published!=='true'})});toast('Catálogo actualizado.');}
 if(del&&confirm('¿Ocultar este plugin del catálogo de clientes?')){await api('/api/admin/plugins/'+encodeURIComponent(del.dataset.delete),{method:'DELETE'});toast('Plugin ocultado.');}
 await loadPlugins();
 }catch(err){toast(err.message)}
});
function connectLive(){if(!token)return;const scheme=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(scheme+'//'+location.host+'/api/live?token='+encodeURIComponent(token));socket.onmessage=e=>{try{if(JSON.parse(e.data).type==='catalog.changed'){loadPlugins();toast('Catálogo sincronizado.')}}catch{}};socket.onclose=()=>{if(token)setTimeout(connectLive,4000)};}
function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function formatBytes(n){return n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB'}
if(token){api('/api/auth/me').then(showDashboard).catch(()=>{token='';localStorage.removeItem('ec_audio_admin_token');showLogin()})}else showLogin();
