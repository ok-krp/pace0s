package com.paceos.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object BleSyncStore {
    private const val PREFS="pace_ble"; private const val QUEUE="queue"; private const val ADDRESS="address"; private const val NAME="name"
    @Synchronized fun enqueue(ctx:Context,sample:JSONObject){val p=ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE);val a=JSONArray(p.getString(QUEUE,"[]"));a.put(sample);p.edit().putString(QUEUE,a.toString()).apply()}
    fun peek(ctx:Context):JSONArray=JSONArray(ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(QUEUE,"[]"))
    fun clear(ctx:Context){ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().remove(QUEUE).apply()}
    fun saveDevice(ctx:Context,address:String,name:String){ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(ADDRESS,address).putString(NAME,name).apply()}
    fun device(ctx:Context):Pair<String,String>?{val p=ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE);val a=p.getString(ADDRESS,null)?:return null;return a to (p.getString(NAME,"Montre")?:"Montre")}
    fun clearDevice(ctx:Context){ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().remove(ADDRESS).remove(NAME).apply()}
}