const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const jitter=()=>wait(1200+Math.random()*1100);
const text=el=>(el?.innerText||el?.textContent||"").trim();
const visible=el=>!!el&&el.getBoundingClientRect().height>0;
let stopped=false,running=false;

chrome.runtime.onMessage.addListener(message=>{
  if(message.type==="SIFT_RUN")start();
});
chrome.storage.local.get(["status"],data=>{if(data.status?.active)start()});

async function start(){
  if(running)return;running=true;
  try{
    const data=await chrome.storage.local.get(["status","profile"]);
    if(!data.status?.active||!data.profile)return;
    if(location.pathname.includes("/jobs/view/")){await processStandalone(data.profile,data.status);return}
    await run(data.profile,data.status);
  }catch(error){
    const status=await currentStatus();
    if(status){status.active=false;status.message="Stopped after an unexpected LinkedIn page error. Reload the extension and retry.";status.debug=String(error?.message||error);await update(status)}
  }finally{running=false}
}
async function update(status){status.lastHeartbeat=Date.now();await chrome.storage.local.set({status})}
async function currentStatus(){return (await chrome.storage.local.get("status")).status}
function record(status,job,reason){status.events=[{job:job||"Job",reason},...(status.events||[])].slice(0,12)}
function exactMatch(card,profile){
  const normalize=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  return normalize(text(card)).includes(normalize(profile.role));
}
function findButton(pattern,root=document){
  return [...root.querySelectorAll("button")].find(b=>visible(b)&&(pattern.test(text(b))||pattern.test(b.getAttribute("aria-label")||"")));
}
function jobId(card){
  const direct=card?.getAttribute?.("data-job-id")||card?.getAttribute?.("data-occludable-job-id");
  if(direct)return String(direct);
  const href=card?.matches?.('a[href*="/jobs/view/"]')?card.href:card?.querySelector?.('a[href*="/jobs/view/"]')?.href;
  return href?.match(/\/jobs\/view\/(\d+)/)?.[1]||"";
}
function findEasyApply(){
  const detail=document.querySelector(".jobs-search__job-details--container, .scaffold-layout__detail, .jobs-details, [class*=job-details]");
  if(!detail)return null;
  const candidates=[...detail.querySelectorAll('.jobs-apply-button, button[aria-label*="Easy Apply"], button')];
  return candidates.find(button=>visible(button)&&/\beasy apply\b/i.test(text(button)+" "+(button.getAttribute("aria-label")||"")));
}
function alreadyApplied(){
  const detail=document.querySelector(".jobs-search__job-details--container, .scaffold-layout__detail, .jobs-details, [class*=job-details]");
  if(!detail)return false;
  return [...detail.querySelectorAll("button, span, div")].some(el=>visible(el)&&/^applied(?:\s|$)/i.test(text(el)));
}
function resultsRoot(){
  return document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*=jobs-search-results-list]")||document;
}
function searchBatchUrl(status){
  const url=new URL(status.searchUrl||"https://www.linkedin.com/jobs/search/");
  if(status.nextStart>0)url.searchParams.set("start",String(status.nextStart));
  return url.href;
}
async function returnToSearchIfNeeded(status){
  const hasList=document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*=jobs-search-results-list]");
  if(!location.pathname.includes("/jobs/view/")||hasList)return false;
  status.message="Returning to search results for the next job…";await update(status);
  location.assign(searchBatchUrl(status));
  return true;
}
async function processStandalone(profile,status){
  status.message="Checking standalone job page…";await update(status);
  const titleSelector=".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title-link, [class*=job-title], h1";
  await waitFor(()=>document.querySelector(titleSelector),15000);
  const heading=text(document.querySelector(titleSelector))||profile.role,id=location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]||location.href;
  status.seenJobIds=[...new Set([...(status.seenJobIds||[]),id])];
  if(alreadyApplied()){status.skipped++;record(status,heading,"Already applied")}
  else{
    const easy=await waitFor(findEasyApply,10000);
    if(!easy){status.skipped++;record(status,heading,"Company does not offer Easy Apply")}
    else{
      easy.click();await jitter();
      const result=await completeApplication(profile);
      if(result.ok){
        status.applied++;record(status,heading,"Application submitted");
        const stored=await chrome.storage.local.get("submittedJobIds"),ids=new Set(stored.submittedJobIds||[]);ids.add(id);await chrome.storage.local.set({submittedJobIds:[...ids]});
      }else{status.skipped++;record(status,heading,result.reason);await closeModal()}
    }
  }
  status.message="Returning to search results for the next job…";await update(status);
  location.assign(searchBatchUrl(status));
}
function getScroller(card){
  let node=card;
  while(node&&node!==document.body){
    const style=getComputedStyle(node);
    if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+20)return node;
    node=node.parentElement;
  }
  const candidates=[...document.querySelectorAll(".jobs-search-results-list, .scaffold-layout__list, [class*=jobs-search-results], [class*=scaffold-layout__list]")];
  return candidates.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]||document.scrollingElement;
}
async function run(profile,status){
  if(/login|checkpoint|challenge/.test(location.pathname))return stop(status,"Stopped: sign in to LinkedIn, then start again.");
  if(document.body.innerText.toLowerCase().includes("security verification"))return stop(status,"Stopped: LinkedIn security verification detected.");
  status.message="Waiting for LinkedIn results…";await update(status);
  const ready=await waitFor(()=>document.querySelector('a[href*="/jobs/view/"], li.jobs-search-results__list-item, .job-card-container, [data-job-id], [data-occludable-job-id]'),30000);
  if(!ready)return stop(status,"No job cards loaded after 30 seconds. Refresh LinkedIn and retry.");
  const stored=await chrome.storage.local.get("submittedJobIds"),submitted=new Set(stored.submittedJobIds||[]);
  const seen=new Set(status.seenJobIds||[]);
  let emptyRounds=0,processedThisBatch=0;
  for(let round=0;round<40;round++){
    const live=await currentStatus();if(!live?.active){stopped=true;break}
    const links=[...resultsRoot().querySelectorAll('a[href*="/jobs/view/"]')].filter(visible);
    let cards=links.map(link=>link.closest("li, .jobs-search-results__list-item, .job-card-container, [data-job-id], [data-occludable-job-id]")||link);
    cards=[...new Set(cards)].filter(card=>visible(card)&&exactMatch(card,profile)&&!seen.has(jobId(card)||card.querySelector?.("a")?.href));
    if(!cards.length)emptyRounds++;else emptyRounds=0;
    for(const card of cards){
      const id=jobId(card)||card.querySelector?.("a")?.href||String(seen.size);seen.add(id);
      processedThisBatch++;
      const current=await currentStatus();if(!current?.active){stopped=true;break}
      current.seenJobIds=[...seen];
      const cardTitle=text(card).split("\n")[0]||profile.role;
      if(/\bapplied\b/i.test(text(card))||submitted.has(id)){current.skipped++;record(current,cardTitle,"Already applied");await update(current);continue}
      try{
        current.message="Checking fresh match "+seen.size+"…";await update(current);
        card.scrollIntoView({block:"center"});
        const clickTarget=card.querySelector?.(".job-card-container--clickable, .job-card-list__entity-lockup, [data-view-name='job-card']")||card;
        clickTarget.dispatchEvent(new MouseEvent("click",{view:window,bubbles:true,cancelable:true,button:0}));
        await jitter();
        const titleSelector=".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title-link, [class*=job-title], h1";
        await waitFor(()=>document.querySelector(titleSelector),12000);await wait(700);
        const heading=text(document.querySelector(titleSelector))||cardTitle;
        if(alreadyApplied()){current.skipped++;record(current,heading,"Already applied");await update(current);continue}
        const easy=findEasyApply();
        if(!easy){current.skipped++;record(current,heading,"Company does not offer Easy Apply");await update(current);continue}
        easy.click();await jitter();
        const result=await completeApplication(profile);
        if(result.ok){current.applied++;current.message="Submitted application to "+heading;record(current,heading,"Application submitted");submitted.add(id);await chrome.storage.local.set({submittedJobIds:[...submitted]})}
        else{current.skipped++;record(current,heading,result.reason);await closeModal()}
        await update(current);await jitter();
      }catch(error){
        current.skipped++;record(current,cardTitle,"Page error: "+String(error?.message||error).slice(0,70));await update(current);await closeModal();
      }finally{
        const after=await currentStatus();if(after&&await returnToSearchIfNeeded(after))return;
      }
    }
    const scroller=getScroller(cards[cards.length-1]);
    const before=scroller.scrollTop,step=Math.max(scroller.clientHeight*.8,500);
    scroller.scrollTop=before+step;scroller.dispatchEvent(new Event("scroll",{bubbles:true}));
    const loading=await currentStatus();loading.message="Loading more LinkedIn results…";await update(loading);await wait(1200);
    if(scroller.scrollTop===before)emptyRounds++;
    if(emptyRounds>=3)break;
  }
  const final=await currentStatus();
  if(!final||!final.active)return;
  final.emptyBatches=processedThisBatch?0:(final.emptyBatches||0)+1;
  if(final.emptyBatches>=3){
    final.active=false;final.message="All available result batches checked: "+final.applied+" submitted, "+final.skipped+" skipped";await update(final);return;
  }
  final.nextStart=(final.nextStart||0)+(processedThisBatch||1);
  final.batch=(final.batch||1)+1;
  final.message="Loading LinkedIn result batch "+final.batch+"…";await update(final);
  location.assign(searchBatchUrl(final));
}
async function waitFor(test,timeout){
  const started=Date.now();
  while(Date.now()-started<timeout){const result=test();if(result)return result;await wait(400)}
  return null;
}
async function completeApplication(profile){
  for(let step=0;step<12;step++){
    await jitter();
    const modal=document.querySelector('[role="dialog"], .jobs-easy-apply-modal');
    if(!modal)return {ok:false,reason:"application dialog closed"};
    if(/captcha|security verification/i.test(text(modal)))return {ok:false,reason:"security check"};
    await attachResume(modal,profile);
    const answerResult=fillKnownFields(modal,profile);
    if(!answerResult.ok)return answerResult;
    const submit=findButton(/^submit application$/i,modal);
    if(submit&&!submit.disabled){submit.click();const confirmed=await dismissConfirmation();return confirmed?{ok:true}:{ok:false,reason:"submission was not confirmed"}}
    const review=findButton(/^review( application)?$/i,modal);
    const next=findButton(/^(next|continue)$/i,modal);
    const advance=review||next;
    if(!advance||advance.disabled)return {ok:false,reason:"unknown required question"};
    advance.click();
  }
  return {ok:false,reason:"too many form steps"};
}
async function attachResume(root,profile){
  const input=root.querySelector('input[type="file"]');
  if(!input||input.files?.length)return;
  const raw=atob(profile.resumeData.split(",").pop());const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const file=new File([bytes],profile.resumeName||"resume.pdf",{type:profile.resumeType||"application/pdf"});
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));await wait(700);
}
function fillKnownFields(root,profile){
  const radioGroups=[...root.querySelectorAll("fieldset, .fb-dash-form-element")].filter(group=>group.querySelector('input[type="radio"]'));
  for(const group of radioGroups){
    const question=text(group).toLowerCase();
    const wanted=/authorized|legally.*work/.test(question)?profile.workAuthorized:/sponsor/.test(question)?profile.needsSponsorship:"";
    if(!wanted)continue;
    const radios=[...group.querySelectorAll('input[type="radio"]')];
    const choice=radios.find(radio=>text(radio.closest("label")||radio.parentElement).toLowerCase().includes(wanted.toLowerCase()));
    if(choice&&!choice.checked)choice.click();
  }
  const controls=[...root.querySelectorAll("input:not([type=file]):not([type=hidden]), select, textarea")].filter(visible);
  for(const el of controls){
    if(el.disabled||el.readOnly||el.type==="radio")continue;
    if(el.type==="checkbox"){if(el.checked)continue;if(el.required||el.getAttribute("aria-required")==="true")return {ok:false,reason:"required checkbox needs a saved answer"};continue}
    const answered=el.tagName==="SELECT"?el.selectedIndex>0:String(el.value||"").trim()!=="";
    if(answered)continue;
    const wrap=el.closest(".jobs-easy-apply-form-section__grouping, .fb-dash-form-element, label, fieldset")||el.parentElement;
    const label=text(wrap).toLowerCase();
    let value="";
    if(/phone|mobile/.test(label))value=profile.phone||"";
    else if(/email/.test(label))value=profile.email||"";
    else if(/city|location/.test(label))value=profile.location||"";
    else if(/years.*experience|experience.*years/.test(label))value=profile.yearsExperience||"";
    else if(/salary|compensation/.test(label))value=profile.salary||"";
    else if(/notice period/.test(label))value=profile.noticePeriod||"";
    else if(/linkedin/.test(label))value=profile.linkedinUrl||"";
    if(el.tagName==="SELECT"){
      const wanted=/authorized|legally.*work/.test(label)?profile.workAuthorized:/sponsor/.test(label)?profile.needsSponsorship:"";
      const option=[...el.options].find(o=>wanted&&text(o).toLowerCase()===wanted.toLowerCase());
      if(option){setControlValue(el,option.value);continue}
    }
    if(value){setControlValue(el,value);continue}
    if(el.required||el.getAttribute("aria-required")==="true")return {ok:false,reason:"missing saved answer: "+label.replace(/\s+/g," ").slice(0,80)};
  }
  return {ok:true};
}
function setControlValue(el,value){
  const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
  if(setter)setter.call(el,value);else el.value=value;
  el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));el.dispatchEvent(new Event("blur",{bubbles:true}));
}
async function closeModal(){const modal=document.querySelector('[role="dialog"], .jobs-easy-apply-modal');if(!modal)return;const dismiss=findButton(/^(dismiss|close)$/i,modal)||modal.querySelector('button[aria-label*="Dismiss"],button[aria-label*="Close"]');dismiss?.click();await wait(350);findButton(/^(discard|dismiss)$/i)?.click()}
async function dismissConfirmation(){
  await wait(900);
  const success=await waitFor(()=>{
    const modal=document.querySelector('[role="dialog"], .jobs-easy-apply-modal');
    if(!modal)return true;
    return /application (was )?(sent|submitted)|thank you|you applied/i.test(text(modal))?modal:null;
  },10000);
  const modal=document.querySelector('[role="dialog"], .jobs-easy-apply-modal');
  let confirmed=!!success;
  if(modal){
    const done=findButton(/^(done|close|dismiss)$/i,modal)||modal.querySelector('button[aria-label*="Dismiss"],button[aria-label*="Close"]');
    if(done||/application (was )?(sent|submitted)|thank you|you applied/i.test(text(modal)))confirmed=true;
    done?.click();
    await waitFor(()=>!document.querySelector('[role="dialog"], .jobs-easy-apply-modal'),6000);
  }
  return confirmed;
}
async function stop(status,message){status.active=false;status.message=message;await update(status)}
