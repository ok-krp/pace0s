
export const MAX_CUSTOM_WALLPAPER_BYTES = 20 * 1024 * 1024;
const DB_NAME="pace-local-cache", DB_VERSION=1, STORE_NAME="assets";
const SELECTION_KEY="wallpaper:selection", CUSTOM_KEY="wallpaper:custom";
export type CachedWallpaper = {kind:"preset";id:string} | {kind:"custom";blob:Blob};
export function isCustomWallpaperFileAllowed(file:Pick<Blob,"size"|"type">):boolean {
  return file.size>0 && file.size<=MAX_CUSTOM_WALLPAPER_BYTES && (!file.type || file.type.startsWith("image/"));
}
function openCacheDatabase():Promise<IDBDatabase>{
  if(typeof indexedDB==="undefined")return Promise.reject(new Error("IndexedDB is unavailable on this device."));
  return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME);};request.onerror=()=>reject(request.error??new Error("Unable to open local cache."));request.onblocked=()=>reject(new Error("Local cache is blocked by another Pace tab."));request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};});
}
export async function readCachedWallpaper():Promise<CachedWallpaper|null>{
  const db=await openCacheDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,"readonly"),store=tx.objectStore(STORE_NAME),req=store.get(SELECTION_KEY);
    req.onerror=()=>{db.close();reject(req.error??new Error("Unable to read wallpaper cache."));};
    req.onsuccess=()=>{const selection=req.result as {kind?:unknown;id?:unknown}|undefined;if(!selection){db.close();resolve(null);return;}if(selection.kind==="preset"&&typeof selection.id==="string"){db.close();resolve({kind:"preset",id:selection.id});return;}if(selection.kind!=="custom"){db.close();resolve(null);return;}const blobReq=store.get(CUSTOM_KEY);blobReq.onerror=()=>{db.close();reject(blobReq.error??new Error("Unable to read cached image."));};blobReq.onsuccess=()=>{const blob=blobReq.result;db.close();resolve(blob instanceof Blob&&isCustomWallpaperFileAllowed(blob)?{kind:"custom",blob}:null);};};
    tx.onerror=()=>{db.close();reject(tx.error??new Error("Local cache read failed."));};
  });
}
function writeCache(mutator:(store:IDBObjectStore)=>void):Promise<void>{
  return openCacheDatabase().then((db)=>new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,"readwrite");tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{const error=tx.error??new Error("Local cache write failed.");db.close();reject(error);};tx.onabort=()=>{const error=tx.error??new Error("Local cache write aborted.");db.close();reject(error);};try{mutator(tx.objectStore(STORE_NAME));}catch(error){tx.abort();db.close();reject(error);}}));
}
export function saveWallpaperPreset(id:string):Promise<void>{if(!id.trim())return Promise.reject(new Error("Invalid wallpaper preset."));return writeCache((store)=>{store.put({kind:"preset",id},SELECTION_KEY);store.delete(CUSTOM_KEY);});}
export function saveCustomWallpaper(blob:Blob):Promise<void>{if(!isCustomWallpaperFileAllowed(blob))return Promise.reject(new Error("Image invalide ou supérieure à 20 Mo."));return writeCache((store)=>{store.put({kind:"custom"},SELECTION_KEY);store.put(blob,CUSTOM_KEY);});}


/** Remove the wallpaper selection and image from this device cache. */
export function clearWallpaperCache(): Promise<void> {
  return writeCache((store) => {
    store.delete(SELECTION_KEY);
    store.delete(CUSTOM_KEY);
  });
}
