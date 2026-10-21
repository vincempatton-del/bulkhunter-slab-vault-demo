// The normal app always uses its shared server. Only the separately built,
// clearly labelled browser demo runs a private sample vault on this device.
export const browserDemo=typeof document!=='undefined'&&document.querySelector('meta[name="slab-vault-mode"]')?.content==='browser-demo';
const databaseName='the-bulk-hunter-browser-demo-v1';
const lockName=`${databaseName}:${typeof location==='undefined'?'':location.pathname.replace(/[^/]*$/,'')}`;
let sqlPromise,storagePromise,localQueue=Promise.resolve();
const reverseImages=new Map();

function database(){
  return storagePromise??=new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('vault');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('This browser could not save your demo. Allow website storage and reload.'));
    request.onblocked=()=>reject(new Error('Close other demo tabs and reload to finish opening your sample vault.'));
  });
}
async function readState(){
  const db=await database();
  return new Promise((resolve,reject)=>{const request=db.transaction('vault').objectStore('vault').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function saveState(state){
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite');tx.objectStore('vault').put(state,'state');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Your demo could not be saved.'));tx.onabort=()=>reject(tx.error||new Error('Your demo could not be saved.'));});
}
function serial(operation){
  if(navigator.locks?.request)return navigator.locks.request(lockName,operation);
  const next=localQueue.then(operation,operation);localQueue=next.catch(()=>{});return next;
}
async function libraries(){
  return sqlPromise??=(async()=>{
    const [{default:initSqlJs},{createSandboxRuntime}]=await Promise.all([import('./sql-runtime.js'),import('./sandbox-core.js')]);
    const SQL=await initSqlJs({locateFile:()=>new URL('../assets/sql-wasm.wasm',import.meta.url).href});
    return {SQL,createSandboxRuntime};
  })().catch(error=>{sqlPromise=null;throw new Error(`The browser demo could not start. Reload this page. ${error.message}`);});
}
async function imageData(runtime,path){
  const response=await runtime.fetch(path);
  if(!response.ok)return path;
  const bytes=new Uint8Array(await response.arrayBuffer());let raw='';
  for(let index=0;index<bytes.length;index+=8192)raw+=String.fromCharCode(...bytes.subarray(index,index+8192));
  const value=`data:${response.headers.get('content-type')};base64,${btoa(raw)}`;
  reverseImages.set(value,path);return value;
}
async function renderImages(value,runtime,cache=new Map()){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=await renderImages(value[i],runtime,cache);return value;}
  for(const key of Object.keys(value)){
    const item=value[key];
    if(key==='image'&&typeof item==='string'&&/^\/api\/images\/[a-f0-9-]{36}$/.test(item)){
      if(!cache.has(item))cache.set(item,await imageData(runtime,item));value[key]=cache.get(item);
    }else if(key==='image'&&typeof item==='string'&&item.startsWith('/assets/'))value[key]='.'+item;
    else if(item&&typeof item==='object')value[key]=await renderImages(item,runtime,cache);
  }
  return value;
}
export async function request(path,options={}){
  if(!browserDemo)return fetch(path,options);
  return serial(async()=>{
    const {SQL,createSandboxRuntime}=await libraries();
    const stored=await readState();
    const runtime=createSandboxRuntime({SQL,bytes:stored?.bytes,cookie:stored?.cookie});
    try{
      let body=options.body;
      if(typeof body==='string'){
        try{const parsed=JSON.parse(body);if(parsed&&typeof parsed==='object'&&typeof parsed.image==='string'&&reverseImages.has(parsed.image)){parsed.image=reverseImages.get(parsed.image);body=JSON.stringify(parsed);}}catch{/* The actual API validates malformed JSON. */}
      }
      const response=await runtime.fetch(new URL(path,document.baseURI).href,{...options,body});
      let output=response;
      if(response.headers.get('content-type')?.includes('application/json')){
        const data=await renderImages(await response.json(),runtime);
        if(data&&typeof data==='object'){if('sharedInventory'in data)data.sharedInventory=false;data.browserDemo=true;}
        const headers=new Headers(response.headers);headers.delete('set-cookie');
        output=new Response(JSON.stringify(data),{status:response.status,headers});
      }
      await saveState({bytes:runtime.exportBytes(),cookie:runtime.cookie});
      return output;
    }finally{runtime.close();}
  });
}
export async function resetDemo(){
  if(!browserDemo)return;
  return serial(async()=>{
    const {SQL,createSandboxRuntime}=await libraries();const runtime=createSandboxRuntime({SQL});
    try{await saveState({bytes:runtime.exportBytes(),cookie:''});reverseImages.clear();}finally{runtime.close();}
  });
}
