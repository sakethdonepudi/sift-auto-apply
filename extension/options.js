const ids=["name","email","phone","linkedinUrl","role","location","maxApplications","yearsExperience","workAuthorized","needsSponsorship","salary","noticePeriod"];
const resumeInput=document.getElementById("resume"),resumeStatusEl=document.getElementById("resumeStatus"),saveButton=document.getElementById("save"),messageEl=document.getElementById("message");
chrome.storage.local.get("profile",({profile={}})=>{ids.forEach(id=>{if(profile[id]!=null)document.getElementById(id).value=profile[id]});if(profile.resumeName)resumeStatusEl.textContent="Saved: "+profile.resumeName});
saveButton.onclick=async()=>{
  const stored=await chrome.storage.local.get("profile"),profile={...(stored.profile||{})};
  ids.forEach(id=>profile[id]=document.getElementById(id).value.trim());
  const file=resumeInput.files[0];
  if(file){profile.resumeName=file.name;profile.resumeType=file.type;profile.resumeData=await toDataUrl(file)}
  await chrome.storage.local.set({profile});messageEl.textContent="Saved. SIFT is ready.";resumeStatusEl.textContent="Saved: "+(profile.resumeName||"no resume");setTimeout(()=>messageEl.textContent="",2500)
};
function toDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)})}
