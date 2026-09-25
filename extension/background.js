const DEFAULT_STATUS={active:false,applied:0,skipped:0,message:"Ready"};

chrome.runtime.onInstalled.addListener(()=>{
  chrome.storage.local.get(["status"],r=>{if(!r.status)chrome.storage.local.set({status:DEFAULT_STATUS})});
});

chrome.tabs.onUpdated.addListener(async(tabId,changeInfo,tab)=>{
  let page;
  try{page=new URL(tab.url||"")}catch(error){return}
  if(changeInfo.status!=="complete"||page.protocol!=="https:"||!/(^|\.)linkedin\.com$/.test(page.hostname)||!page.pathname.startsWith("/jobs/"))return;
  const {status}=await chrome.storage.local.get("status");
  if(!status?.active||status.tabId!==tabId)return;
  for(let attempt=0;attempt<5;attempt++){
    try{await chrome.tabs.sendMessage(tabId,{type:"SIFT_RUN"});return}catch(error){await new Promise(r=>setTimeout(r,1000))}
  }
  status.active=false;status.message="Could not connect to the LinkedIn tab. Reload the SIFT extension and try again.";
  await chrome.storage.local.set({status});
});

chrome.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name!=="sift-watchdog")return;
  const {status}=await chrome.storage.local.get("status");
  if(status?.active&&Date.now()-(status.lastHeartbeat||status.startedAt||0)>90000){
    status.active=false;status.message="Stopped: LinkedIn did not respond for 90 seconds. Reload the page and retry.";
    await chrome.storage.local.set({status});
  }
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message.type==="SIFT_START"){
    startRun(message.brief).then(sendResponse);
    return true;
  }
  if(message.type==="SIFT_STOP"){
    chrome.storage.local.set({status:{...DEFAULT_STATUS,message:"Stopped by user"}});
    sendResponse({ok:true});
  }
  if(message.type==="SIFT_STATUS"){
    chrome.storage.local.get(["status","profile"],r=>sendResponse({ok:true,...r}));
    return true;
  }
  if(message.type==="SIFT_UPDATE_STATUS"){
    chrome.storage.local.set({status:message.status});
    sendResponse({ok:true});
  }
});

async function startRun(brief){
  const stored=await chrome.storage.local.get(["profile"]);
  if(!stored.profile?.resumeData)return {ok:false,error:"Open extension settings and add your resume first."};
  const role=(stored.profile.role||brief?.role||"").trim();
  const location=(stored.profile.location||brief?.location||"Worldwide").trim();
  if(!role||!location)return {ok:false,error:"Role and location are required."};
  const profile={...stored.profile,role,location};
  const remoteWorldwide=/remote.*(worldwide|global|anywhere)|(worldwide|global|anywhere).*remote/i.test(location);
  const worldwide=/^(worldwide|global|anywhere|any|all locations)$/i.test(location);
  const place=remoteWorldwide?"&geoId=92000000&f_WT=2":worldwide?"&geoId=92000000":"&location="+encodeURIComponent(location);
  const url="https://www.linkedin.com/jobs/search/?keywords="+encodeURIComponent(role)+place+"&f_AL=true&f_TPR=r604800&sortBy=DD";
  const tab=await chrome.tabs.create({url:"about:blank"});
  const status={active:true,applied:0,skipped:0,message:"Opening exact LinkedIn search…",events:[],seenJobIds:[],searchUrl:url,nextStart:0,batch:1,emptyBatches:0,startedAt:Date.now(),lastHeartbeat:Date.now(),tabId:tab.id};
  await chrome.storage.local.set({profile,status});
  chrome.alarms.create("sift-watchdog",{periodInMinutes:1});
  await chrome.tabs.update(tab.id,{url});
  return {ok:true};
}
