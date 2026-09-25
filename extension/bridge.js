window.addEventListener("message",event=>{
  if(event.source!==window||event.data?.type!=="SIFT_AUTO_APPLY_START")return;
  const runtime=globalThis.chrome?.runtime;
  window.postMessage({type:"SIFT_EXTENSION_ACK"},"*");
  if(!runtime?.sendMessage){
    window.postMessage({
      type:"SIFT_AUTO_APPLY_RESULT",
      ok:false,
      error:"The extension was reloaded while this SIFT tab was open. Refresh this page once, then click Auto Apply again."
    },"*");
    return;
  }
  try{
    runtime.sendMessage({type:"SIFT_START",brief:event.data.brief},response=>{
      const runtimeError=runtime.lastError;
      window.postMessage({
        type:"SIFT_AUTO_APPLY_RESULT",
        ok:!runtimeError&&!!response?.ok,
        error:runtimeError?.message||response?.error||"Could not start the extension. Reload the extension and refresh SIFT."
      },"*");
    });
  }catch(error){
    window.postMessage({
      type:"SIFT_AUTO_APPLY_RESULT",
      ok:false,
      error:"Extension context expired. Reload the extension, then refresh this SIFT page."
    },"*");
  }
});
