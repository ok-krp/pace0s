
import test from "node:test";
import assert from "node:assert/strict";
import { isCustomWallpaperFileAllowed, MAX_CUSTOM_WALLPAPER_BYTES } from "./wallpaper-cache.ts";
test("accepts an image exactly at the 20 MiB limit",()=>{assert.equal(MAX_CUSTOM_WALLPAPER_BYTES,20*1024*1024);assert.equal(isCustomWallpaperFileAllowed({size:MAX_CUSTOM_WALLPAPER_BYTES,type:"image/webp"}),true);});
test("rejects an image one byte above the 20 MiB limit",()=>{assert.equal(isCustomWallpaperFileAllowed({size:MAX_CUSTOM_WALLPAPER_BYTES+1,type:"image/jpeg"}),false);});
test("rejects empty files and known non-image types",()=>{assert.equal(isCustomWallpaperFileAllowed({size:0,type:"image/png"}),false);assert.equal(isCustomWallpaperFileAllowed({size:1024,type:"application/pdf"}),false);});
test("allows browsers that do not provide a MIME type",()=>{assert.equal(isCustomWallpaperFileAllowed({size:1024,type:""}),true);});
