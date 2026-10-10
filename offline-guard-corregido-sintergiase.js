
(function(){
  'use strict';

  var MODE='sintergia_offline_biometric_mode';
  var BIO='sintergia_biometric_auth';
  var LOCK='sintergia_offline_biometric_lockdown_v1';
  var GRANT='sintergia_biometric_last_online_ok_v1';
  var MAX_AGE=7*24*60*60*1000;

  function get(store,key){
    try{return store.getItem(key)}catch(_){return null}
  }

  function restricted(){
    return get(sessionStorage,MODE)==='restricted'||
      get(localStorage,LOCK)==='restricted';
  }

  function urlOf(input){
    try{
      return new URL(
        typeof input==='string'||input instanceof URL
          ?String(input):(input&&input.url)||'',
        location.href
      );
    }catch(_){return null}
  }

  function isBackend(u){
    if(!u)return false;
    var p=u.pathname.toLowerCase();
    var apiPath=/^\/(?:functions|rest|auth|storage|realtime)\/v1\//.test(p);
    return apiPath&&(/\.supabase\.co$/i.test(u.hostname)||
      u.origin===location.origin);
  }

  function allowedWhileRestricted(u){
    if(!u)return false;
    var p=u.pathname.toLowerCase();
    return /\/functions\/v1\/health\/?$/.test(p)||
      /\/functions\/v1\/authenticate-biometric\/?$/.test(p);
  }

  var baseFetch=window.fetch.bind(window);

  window.fetch=function(input,init){
    var u=urlOf(input);

    if(restricted()&&navigator.onLine&&isBackend(u)&&
       !allowedWhileRestricted(u)){
      try{
        window.dispatchEvent(new CustomEvent(
          'sintergia-offline-remote-blocked',
          {detail:{url:u.href}}
        ));
      }catch(_){}

      return Promise.reject(new TypeError(
        'Operación remota bloqueada: SintergiaSE está en modo sin conexión limitado. Valida la biometría online para continuar.'
      ));
    }

    var request=baseFetch(input,init);

    /* Guarda autorización solo tras recibir un token real del servidor. */
    if(u&&/\/functions\/v1\/authenticate-biometric\/?$/.test(u.pathname)){
      return request.then(function(response){
        if(response&&response.ok){
          try{
            response.clone().json().then(function(data){
              if(data&&data.ok===true&&
                 typeof data.token==='string'&&
                 data.token.length>20&&
                 !data.token.startsWith('local-')){
                try{
                  localStorage.setItem(GRANT,String(Date.now()));
                }catch(_){}
              }
            }).catch(function(){});
          }catch(_){}
        }
        return response;
      });
    }

    return request;
  };

  function sessionToken(){
    try{
      if(window.SintergiaAuthToken&&
         !String(window.SintergiaAuthToken).startsWith('local-')){
        return String(window.SintergiaAuthToken);
      }

      var s=JSON.parse(
        sessionStorage.getItem('sintergia_auth_token')||'null'
      );

      return s&&typeof s.token==='string'&&
        !s.token.startsWith('local-')?s.token:'';
    }catch(_){return ''}
  }

  function offlineGrantValid(){
    var t=Number(get(localStorage,GRANT)||0);
    return Number.isFinite(t)&&t>0&&
      Date.now()>=t&&Date.now()-t<=MAX_AGE;
  }

  function pauseProtectedOperations(){
    try{
      if(window.SintergiaOffline&&
         typeof window.SintergiaOffline.pauseSyncForAuth==='function'){
        window.SintergiaOffline.pauseSyncForAuth(
          'offline-biometric-restricted'
        );
      }
    }catch(_){}
  }

  function applyAuthorizationState(){
    var localMode=
      get(sessionStorage,MODE)==='restricted'||
      get(sessionStorage,BIO)==='offline-restricted';

    if(localMode){
      try{localStorage.setItem(LOCK,'restricted')}catch(_){}

      try{
        window.SintergiaAuthToken='';
        sessionStorage.removeItem('sintergia_auth_token');
        window.__SINTERGIA_RUNTIME_AUTH__=null;
      }catch(_){}

      pauseProtectedOperations();
      return;
    }

    if(get(sessionStorage,BIO)==='1'&&sessionToken()){
      try{localStorage.removeItem(LOCK)}catch(_){}

      try{
        if(window.SintergiaOffline&&
           typeof window.SintergiaOffline.resumeSyncAfterAuth==='function'){
          var r=window.SintergiaOffline.resumeSyncAfterAuth();

          if(r&&r.ok&&typeof window.SintergiaOffline.flush==='function'){
            window.SintergiaOffline.flush().catch(function(){});
          }
        }
      }catch(_){}

      return;
    }

    if(get(localStorage,LOCK)==='restricted'){
      pauseProtectedOperations();
    }
  }

  function expireOfflineGrant(){
    if(!restricted()||offlineGrantValid())return;

    try{
      sessionStorage.setItem(
        'sintergia_offline_biometric_expiry_enforced_v1','1'
      );
    }catch(_){}

    pauseProtectedOperations();

    try{sessionStorage.setItem(BIO,'offline-expired')}catch(_){}

    try{
      var sec=window.SintergiaSecurity;

      if(sec&&typeof sec.bloquear==='function'&&
         get(sessionStorage,
         'sintergia_offline_biometric_expiry_lock_called_v1')!=='1'){

        sessionStorage.setItem(
          'sintergia_offline_biometric_expiry_lock_called_v1','1'
        );

        Promise.resolve(sec.bloquear()).catch(function(){});
      }
    }catch(_){}

    try{
      if(typeof window.mostrarToast==='function'){
        window.mostrarToast(
          'La autorización biométrica sin conexión ha caducado. Conéctate y valida la biometría online.'
        );
      }
    }catch(_){}
  }

  window.addEventListener(
    'sintergia-biometric-unlock',applyAuthorizationState
  );

  window.addEventListener('focus',expireOfflineGrant);

  window.addEventListener('pageshow',function(){
    applyAuthorizationState();
    expireOfflineGrant();
  });

  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)expireOfflineGrant();
  });

  window.addEventListener('online',expireOfflineGrant);

  setInterval(expireOfflineGrant,60000);

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      applyAuthorizationState();
      expireOfflineGrant();
    },{once:true});
  }else{
    setTimeout(function(){
      applyAuthorizationState();
      expireOfflineGrant();
    },0);
  }
})();
