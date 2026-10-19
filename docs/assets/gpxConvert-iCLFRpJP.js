import{t as d,F as h}from"./index-CemX9WV2.js";function w(t){return String(t??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[n])}function u(t){const n=t instanceof Date?t:t?new Date(t):null;return n&&!isNaN(n)?n.toISOString():null}function l(t){return Number.isFinite(t)?t:null}async function T(t){const n=t.buffer.slice(t.byteOffset,t.byteOffset+t.byteLength),e=await new h({force:!0,mode:"list",lengthUnit:"m",elapsedRecordField:!1}).parseAsync(n),a=[];for(const r of(e==null?void 0:e.records)||[]){const i=l(r.position_lat),s=l(r.position_long);i==null||s==null||a.push({lat:i,lon:s,ele:l(r.enhanced_altitude)??l(r.altitude),time:u(r.timestamp),hr:l(r.heart_rate),cad:l(r.cadence),temp:l(r.temperature)})}return[a]}function k(t){var i;const n=new TextDecoder("utf-8").decode(t),o=new DOMParser().parseFromString(n,"application/xml");if(o.getElementsByTagName("parsererror").length)throw new Error("TCX malformado");const e=(s,c)=>s.getElementsByTagName(c)[0],a=s=>s?l(parseFloat(s.textContent)):null,r=[];for(const s of o.getElementsByTagName("Track")){const c=[];for(const m of s.getElementsByTagName("Trackpoint")){const p=e(m,"Position");if(!p)continue;const f=a(e(p,"LatitudeDegrees")),g=a(e(p,"LongitudeDegrees"));if(f==null||g==null)continue;const x=e(m,"HeartRateBpm");c.push({lat:f,lon:g,ele:a(e(m,"AltitudeMeters")),time:u((i=e(m,"Time"))==null?void 0:i.textContent),hr:x?a(e(x,"Value")):null,cad:a(e(m,"Cadence")),temp:null})}c.length&&r.push(c)}return r}function $(t){const n=[];t.ele!=null&&n.push(`<ele>${t.ele}</ele>`),t.time&&n.push(`<time>${t.time}</time>`);const o=[];return t.temp!=null&&o.push(`<gpxtpx:atemp>${t.temp}</gpxtpx:atemp>`),t.hr!=null&&o.push(`<gpxtpx:hr>${Math.round(t.hr)}</gpxtpx:hr>`),t.cad!=null&&o.push(`<gpxtpx:cad>${Math.round(t.cad)}</gpxtpx:cad>`),o.length&&n.push(`<extensions><gpxtpx:TrackPointExtension>${o.join("")}</gpxtpx:TrackPointExtension></extensions>`),`      <trkpt lat="${t.lat}" lon="${t.lon}">${n.join("")}</trkpt>`}async function F(t,n,o){let e;if(n==="fit")e=await T(t);else if(n==="tcx")e=k(t);else throw new Error(d("err.noConvert",{ext:n}));if(e=e.filter(s=>s.length),!e.length)return null;const a=w((o==null?void 0:o.name)||d("common.activity")),r=u(o==null?void 0:o.date)||e[0][0].time,i=e.map(s=>`    <trkseg>
${s.map($).join(`
`)}
    </trkseg>`).join(`
`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="activities-heatmap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>${r?`<time>${r}</time>`:""}</metadata>
  <trk>
    <name>${a}</name>
${i}
  </trk>
</gpx>
`}export{F as convertToGpx,T as readFit,k as readTcx};
//# sourceMappingURL=gpxConvert-iCLFRpJP.js.map
