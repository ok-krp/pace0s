export type NativeWatchSample={ts:number;type:string;value:number;source:string};
export type NativeWatchStatus={status:string;message:string;name?:string};
export type NativeWatchDevice={address:string;name:string;rssi?:number};
type NativeWatch={requestBluetoothPermissions:()=>void;startScan?:()=>void;stopScan?:()=>void;connect:(address:string,name:string)=>void;disconnect:()=>void;pendingCount?:()=>number;_receive?:(json:string)=>void};
declare global{interface Window{PaceWatch?:NativeWatch}}
let initialized=false;
export function isNativeWatchAvailable(){return typeof window!=="undefined"&&typeof window.PaceWatch?.connect==="function"}
export function initNativeWatchBridge(onSample?:(s:NativeWatchSample)=>void,onStatus?:(s:NativeWatchStatus)=>void,onDevice?:(d:NativeWatchDevice)=>void,onScanStatus?:(s:NativeWatchStatus)=>void){if(typeof window==="undefined"||initialized)return()=>{};const native=window.PaceWatch;if(!native)return()=>{};initialized=true;native._receive=(json:string)=>{try{const e=JSON.parse(json) as {kind:string;sample?:NativeWatchSample;status?:NativeWatchStatus;device?:NativeWatchDevice};if(e.kind==="sample"&&e.sample)onSample?.(e.sample);if(e.kind==="status"&&e.status)onStatus?.(e.status);if(e.kind==="device"&&e.device)onDevice?.(e.device);if(e.kind==="scan_status"&&e.status)onScanStatus?.(e.status)}catch{}};return()=>{if(window.PaceWatch)window.PaceWatch._receive=undefined;initialized=false}}
export function startNativeWatchScan(){if(!isNativeWatchAvailable()||!window.PaceWatch!.startScan)return false;window.PaceWatch!.startScan();return true}
export function stopNativeWatchScan(){if(!isNativeWatchAvailable()||!window.PaceWatch!.stopScan)return false;window.PaceWatch!.stopScan();return true}
export function connectNativeWatch(address:string,name:string){if(!isNativeWatchAvailable())return false;window.PaceWatch!.connect(address,name);return true}
export function disconnectNativeWatch(){if(!isNativeWatchAvailable())return false;window.PaceWatch!.disconnect();return true}
export function requestNativeBluetoothPermissions(){if(!isNativeWatchAvailable())return false;window.PaceWatch!.requestBluetoothPermissions();return true}
export function getPendingNativeWatchCount(){return window.PaceWatch?.pendingCount?.()??0}