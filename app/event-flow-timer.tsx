"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AlarmClock, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Circle, Clock3, Copy, Fullscreen, Link2, LogOut, MessageSquareText, Minus, Pause, Pencil, Play, Plus, Radio, RotateCcw, Send, Settings2, SkipForward, Sparkles, Trash2, Users, Wifi, WifiOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computeRemainingSeconds, formatTime, pause as pauseTimer, resume as resumeTimer } from "@/lib/timer-engine";
import { supabase } from "@/lib/supabase";

type Segment = { id:string; time:string; title:string; person:string; duration:number; type:string; notes?:string };
// timerDuration and timerStartedAt are the authoritative timer state stored in the DB.
// remaining is derived from these via computeRemainingSeconds and re-calculated on every tick.
type EventData = { id:string; name:string; date:string; venue:string; segments:Segment[]; active:number; remaining:number; timerDuration:number; timerStartedAt:string|null; running:boolean; message:string; updatedAt:number };
type Screen = "live"|"events"|"displays"|"account";
type Connection = "live"|"reconnecting"|"offline";
type AuthMode = "login"|"signup"|"reset"|"update";
type RuntimeRow = { event_id:string; current_agenda_item_id:string|null; duration_seconds:number; manual_offset_seconds:number; timer_status:string; started_at:string|null; updated_at:string };
type MessageRow = { body?:string; cleared_at?:string|null };

const initialSegments: Omit<Segment,"id">[] = [
  {time:"09:00",title:"Doors open",person:"Front of house",duration:15,type:"OPEN"},
  {time:"09:15",title:"Welcome & opening",person:"Host",duration:10,type:"LIVE"},
  {time:"09:25",title:"Keynote",person:"Speaker",duration:25,type:"NEXT"},
];
const uid=()=>crypto.randomUUID();
const localTime=(v:string|null)=>v?new Date(v).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:false}):"09:00";
const authErrorMessage=(reason:unknown)=>{
  const message=reason instanceof Error?reason.message:"Authentication failed.";
  if(message.toLowerCase().includes("email rate limit")){
    return "Event Timer's confirmation-email service is at its Supabase sending limit. Retrying immediately will not work. Custom production email delivery must be configured before signup can continue.";
  }
  return message;
};

export default function EventTimerApp(){
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(false);
  const [recovery,setRecovery]=useState(false);
  useEffect(()=>{
    let mounted=true;
    supabase.auth.getSession().then(({data})=>{if(mounted){setSession(data.session);setReady(true)}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{if(event==="PASSWORD_RECOVERY")setRecovery(true);setSession(next);setReady(true)});
    return()=>{mounted=false;subscription.unsubscribe()};
  },[]);
  if(!ready)return <main className="loading-state">Connecting…</main>;
  if(!session)return <AuthScreen initialMode={recovery?"update":"login"}/>;
  return <EventFlowTimer session={session} accountOnly={location.pathname==="/account"}/>;
}

function AuthScreen({initialMode}:{initialMode:AuthMode}){
  const [mode,setMode]=useState<AuthMode>(initialMode);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const submit=async(ev:FormEvent<HTMLFormElement>)=>{
    ev.preventDefault();setBusy(true);setError("");setNotice("");
    const data=new FormData(ev.currentTarget);
    const email=String(data.get("email")||"").trim();
    const password=String(data.get("password")||"");
    try{
      if(mode==="signup"){
        const fullName=String(data.get("name")||"").trim();
        const {data:result,error:authError}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:`${location.origin}/dashboard`}});
        if(authError)throw authError;
        setNotice(result.session?"Account created. You are signed in.":"Account created. Check your email and confirm your address before signing in.");
      }else if(mode==="login"){
        const {error:authError}=await supabase.auth.signInWithPassword({email,password});if(authError)throw authError;
      }else if(mode==="reset"){
        const {error:authError}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/?recovery=1`});if(authError)throw authError;
        setNotice("Password reset email sent. Use the link in that email to choose a new password.");
      }else{
        const {error:authError}=await supabase.auth.updateUser({password});if(authError)throw authError;
        setNotice("Password updated. You can continue to Event Timer.");
      }
    }catch(reason){setError(authErrorMessage(reason))}
    finally{setBusy(false)}
  };
  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><span className="brand-mark"><span/></span><strong>Event Timer</strong></div>
    <p className="eyebrow">LIVE EVENT CONTROL</p>
    <h1>{mode==="signup"?"Create your account":mode==="reset"?"Reset your password":mode==="update"?"Choose a new password":"Sign in to Event Timer"}</h1>
    <p className="auth-copy">Secure cloud events, run-of-show timing, and synchronized production displays.</p>
    <form onSubmit={submit} className="auth-form">
      {mode==="signup"&&<label>Full name<input name="name" type="text" required autoComplete="name"/></label>}
      {mode!=="update"&&<label>Email<input name="email" type="email" required autoComplete="email"/></label>}
      {mode!=="reset"&&<label>{mode==="update"?"New password":"Password"}<input name="password" type="password" minLength={8} required autoComplete={mode==="login"?"current-password":"new-password"}/></label>}
      {error&&<div className="auth-error" role="alert">{error}</div>}
      {notice&&<div className="auth-notice" role="status">{notice}</div>}
      <button className="button primary auth-submit" type="submit" disabled={busy}>{busy?"Please wait…":mode==="signup"?"Create account":mode==="reset"?"Send reset email":mode==="update"?"Update password":"Sign in"}</button>
    </form>
    {mode==="login"&&<div className="auth-links"><button onClick={()=>setMode("signup")}>Create account</button><button onClick={()=>setMode("reset")}>Forgot password?</button></div>}
    {mode!=="login"&&mode!=="update"&&<button className="auth-back" onClick={()=>{setMode("login");setError("");setNotice("")}}>Back to sign in</button>}
    <small>Event Timer cloud</small>
  </section></main>;
}

function EventFlowTimer({session,accountOnly}:{session:Session;accountOnly:boolean}){
  const [events,setEvents]=useState<EventData[]>([]);
  const [currentId,setCurrentId]=useState("");
  const [screen,setScreen]=useState<Screen>(accountOnly?"account":"live");
  const [hydrated,setHydrated]=useState(false);
  const [displayMode,setDisplayMode]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [editing,setEditing]=useState<Segment|null>(null);
  const [draftMessage,setDraftMessage]=useState("");
  const [feedback,setFeedback]=useState("");
  const [connection,setConnection]=useState<Connection>(navigator.onLine?"reconnecting":"offline");
  const displayOnly=useRef(false);
  const current=events.find(e=>e.id===currentId)??events[0];
  const segment=current?.segments[current.active];
  const next=current?.segments[current.active+1];
  const updateCurrent=(nextEvent:EventData)=>setEvents(all=>all.map(e=>e.id===nextEvent.id?nextEvent:e));

  const mapRuntime=(event:EventData,runtime:RuntimeRow|null|undefined)=>{
    if(!runtime)return event;
    const found=event.segments.findIndex(s=>s.id===runtime.current_agenda_item_id);
    const active=found<0?0:found;
    const timerState={durationSeconds:runtime.duration_seconds,manualOffsetSeconds:runtime.manual_offset_seconds,status:runtime.timer_status as "running"|"paused",startedAt:runtime.started_at};
    const remaining=computeRemainingSeconds(timerState,Date.now());
    return {...event,active,remaining,timerDuration:runtime.duration_seconds,timerStartedAt:runtime.started_at,running:runtime.timer_status==="running",updatedAt:new Date(runtime.updated_at).getTime()};
  };

  const loadCloud=useCallback(async()=>{
    setConnection(navigator.onLine?"reconnecting":"offline");
    const {data:eventRows,error:eventError}=await supabase.from("events").select("id,name,event_date,venue,updated_at").order("created_at",{ascending:true});
    if(eventError){setFeedback(`Cloud load failed: ${eventError.message}`);setHydrated(true);setConnection("offline");return}
    const ids=(eventRows??[]).map(row=>row.id);
    if(!ids.length){setEvents([]);setCurrentId("");setScreen("events");setHydrated(true);setConnection("live");return}
    const [{data:agendaRows,error:agendaError},{data:runtimeRows,error:runtimeError},{data:messages}]=await Promise.all([
      supabase.from("agenda_items").select("*").in("event_id",ids).order("position"),
      supabase.from("event_runtime").select("*").in("event_id",ids),
      supabase.from("event_messages").select("event_id,body,cleared_at,created_at").in("event_id",ids).is("cleared_at",null).order("created_at",{ascending:false}),
    ]);
    if(agendaError||runtimeError){setFeedback(`Cloud load failed: ${(agendaError??runtimeError)!.message}`);setHydrated(true);setConnection("offline");return}
    const mapped=(eventRows??[]).map(row=>{
      const segments=(agendaRows??[]).filter(item=>item.event_id===row.id).map(item=>({id:item.id,time:localTime(item.scheduled_start),title:item.title,person:item.speaker||"Unassigned",duration:Math.max(1,Math.round(item.planned_duration_seconds/60)),type:"PLANNED",notes:item.notes||""}));
      const base:EventData={id:row.id,name:row.name,date:row.event_date||"",venue:row.venue||"Main Stage",segments,active:0,remaining:(segments[0]?.duration??10)*60,timerDuration:(segments[0]?.duration??10)*60,timerStartedAt:null,running:false,message:(messages??[]).find(m=>m.event_id===row.id)?.body??"",updatedAt:new Date(row.updated_at).getTime()};
      return mapRuntime(base,(runtimeRows??[]).find(r=>r.event_id===row.id));
    });
    setEvents(mapped);setCurrentId(id=>mapped.some(e=>e.id===id)?id:mapped[0].id);setHydrated(true);setConnection("live");
  },[]);

  useEffect(()=>{
    displayOnly.current=new URLSearchParams(location.search).get("display")==="1";setDisplayMode(displayOnly.current);
    const requested=new URLSearchParams(location.search).get("event");if(requested)setCurrentId(requested);
    void loadCloud();
    const online=()=>{setConnection("reconnecting");void loadCloud()};const offline=()=>setConnection("offline");
    window.addEventListener("online",online);window.addEventListener("offline",offline);
    return()=>{window.removeEventListener("online",online);window.removeEventListener("offline",offline)};
  },[loadCloud]);

  useEffect(()=>{
    if(!currentId)return;
    const channel=supabase.channel(`event-timer-${currentId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"event_runtime",filter:`event_id=eq.${currentId}`},payload=>{const runtime=payload.new as RuntimeRow;if(runtime?.event_id)setEvents(all=>all.map(e=>e.id===runtime.event_id?mapRuntime(e,runtime):e))})
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"event_messages",filter:`event_id=eq.${currentId}`},payload=>{const message=payload.new as MessageRow;if(message?.body)setEvents(all=>all.map(e=>e.id===currentId?{...e,message:message.body??""}:e))})
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"event_messages",filter:`event_id=eq.${currentId}`},payload=>{const message=payload.new as MessageRow;if(message?.cleared_at)setEvents(all=>all.map(e=>e.id===currentId?{...e,message:""}:e))})
      .subscribe(status=>setConnection(status==="SUBSCRIBED"?"live":navigator.onLine?"reconnecting":"offline"));
    return()=>{void supabase.removeChannel(channel)};
  },[currentId]);

  useEffect(()=>{if(!current?.running)return;const id=window.setInterval(()=>setEvents(all=>all.map(e=>{if(e.id!==currentId||!e.running)return e;const remaining=computeRemainingSeconds({durationSeconds:e.timerDuration,manualOffsetSeconds:0,status:"running",startedAt:e.timerStartedAt},Date.now());return {...e,remaining}})),500);return()=>clearInterval(id)},[current?.running,currentId]);
  useEffect(()=>{if(!feedback)return;const id=setTimeout(()=>setFeedback(""),3000);return()=>clearTimeout(id)},[feedback]);

  const persistRuntime=async(e:EventData)=>{
    const active=e.segments[e.active];
    const {error}=await supabase.from("event_runtime").upsert({event_id:e.id,current_agenda_item_id:active?.id??null,timer_mode:"countdown",timer_status:e.running?"running":"paused",duration_seconds:e.timerDuration,started_at:e.timerStartedAt,paused_at:e.running?null:new Date().toISOString(),accumulated_paused_seconds:0,manual_offset_seconds:0,updated_by:session.user.id,updated_at:new Date().toISOString()},{onConflict:"event_id"});
    if(error)setFeedback(`Timer sync failed: ${error.message}`);
  };
  const commitRuntime=(fn:(event:EventData)=>EventData)=>{if(!current)return;const changed=fn(current);updateCurrent(changed);void persistRuntime(changed)};
  const setTimer=(seconds:number,running=current?.running??false)=>{const now=Date.now();commitRuntime(e=>({...e,remaining:seconds,timerDuration:seconds,timerStartedAt:running?new Date(now).toISOString():null,running,updatedAt:now}))};
  const jump=(index:number,run=true)=>{if(!current?.segments[index])return;const now=Date.now();const dur=current.segments[index].duration*60;commitRuntime(e=>({...e,active:index,remaining:dur,timerDuration:dur,timerStartedAt:run?new Date(now).toISOString():null,running:run,updatedAt:now}))};
  const toggleTimer=()=>{const now=Date.now();commitRuntime(e=>{const ts={durationSeconds:e.timerDuration,manualOffsetSeconds:0,status:e.running?"running" as const:"paused" as const,startedAt:e.timerStartedAt};const next=e.running?pauseTimer(ts,now):resumeTimer(ts,now);const remaining=computeRemainingSeconds(next,now);return {...e,running:!e.running,remaining,timerDuration:next.durationSeconds,timerStartedAt:next.startedAt,updatedAt:now}})};

  const savePositions=async(segments:Segment[])=>{
    if(!current)return;
    const {error}=await supabase.from("agenda_items").upsert(segments.map((s,i)=>({id:s.id,event_id:current.id,position:i,title:s.title,speaker:s.person,notes:s.notes||null,planned_duration_seconds:s.duration*60,scheduled_start:`${current.date}T${s.time}:00`,warning_seconds:120,urgent_seconds:30})));
    if(error)setFeedback(`Agenda save failed: ${error.message}`);
  };
  const move=(from:number,to:number)=>{if(!current||to<0||to>=current.segments.length)return;const a=[...current.segments];const [item]=a.splice(from,1);a.splice(to,0,item);updateCurrent({...current,segments:a,active:current.active===from?to:current.active,updatedAt:Date.now()});void savePositions(a)};
  const remove=async(id:string)=>{if(!current||current.segments.length===1)return;const {error}=await supabase.from("agenda_items").delete().eq("id",id);if(error){setFeedback(`Delete failed: ${error.message}`);return}const a=current.segments.filter(s=>s.id!==id);updateCurrent({...current,segments:a,active:Math.min(current.active,a.length-1),updatedAt:Date.now()});setFeedback("Segment deleted")};
  const duplicate=async(s:Segment,i:number)=>{if(!current)return;const copy={...s,id:uid(),title:`${s.title} copy`};const a=[...current.segments.slice(0,i+1),copy,...current.segments.slice(i+1)];updateCurrent({...current,segments:a,updatedAt:current.updatedAt+1});await savePositions(a);setFeedback("Segment duplicated")};

  const displayUrl=()=>`${location.origin}/dashboard?display=1&event=${current?.id}`;
  const copyDisplay=async()=>{try{await navigator.clipboard.writeText(displayUrl());setFeedback("Secure display link copied — sign-in required")}catch{setFeedback("Copy failed — use Open display")}};
  const openDisplay=()=>window.open(displayUrl(),"_blank","noopener,noreferrer");
  const status=(current?.remaining??0)<=0?"OVERTIME":(current?.remaining??0)<=30?"URGENT":(current?.remaining??0)<=120?"WRAP SOON":"ON TIME";
  const statusClass=(current?.remaining??0)<=0?"overtime":(current?.remaining??0)<=30?"urgent":(current?.remaining??0)<=120?"warning":"normal";
  const projected=useMemo(()=>{const d=new Date();if(current)d.setMinutes(d.getMinutes()+current.segments.slice(current.active).reduce((a,s)=>a+s.duration,0));return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})},[current]);

  const saveEvent=async(ev:FormEvent<HTMLFormElement>)=>{
    ev.preventDefault();const data=new FormData(ev.currentTarget);const name=String(data.get("name")||"").trim();if(!name)return;
    const date=String(data.get("date"));const venue=String(data.get("venue")||"Main Stage");
    const {data:created,error}=await supabase.from("events").insert({owner_id:session.user.id,name,event_date:date,venue,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,status:"draft"}).select("id,name,event_date,venue,updated_at").single();
    if(error||!created){setFeedback(`Event create failed: ${error?.message??"No event returned"}`);return}
    const segments=initialSegments.map(s=>({...s,id:uid()}));
    const {error:agendaError}=await supabase.from("agenda_items").insert(segments.map((s,i)=>({id:s.id,event_id:created.id,position:i,title:s.title,speaker:s.person,planned_duration_seconds:s.duration*60,scheduled_start:`${date}T${s.time}:00`,warning_seconds:120,urgent_seconds:30})));
    if(agendaError){await supabase.from("events").delete().eq("id",created.id);setFeedback(`Event create failed: ${agendaError.message}`);return}
    const fresh:EventData={id:created.id,name,date,venue,segments,active:0,remaining:segments[0].duration*60,timerDuration:segments[0].duration*60,timerStartedAt:null,running:false,message:"",updatedAt:Date.now()};
    setEvents(a=>[...a,fresh]);setCurrentId(fresh.id);setCreateOpen(false);setScreen("live");await persistRuntime(fresh);setFeedback("Event saved to Event Timer cloud");
  };
  const saveSegment=async(ev:FormEvent<HTMLFormElement>)=>{
    ev.preventDefault();if(!current)return;const data=new FormData(ev.currentTarget);
    const item:Segment={id:editing?.id??uid(),time:String(data.get("time")),title:String(data.get("title")).trim(),person:String(data.get("person")).trim(),duration:Math.max(1,Number(data.get("duration"))),type:"PLANNED",notes:String(data.get("notes")||"").trim()};if(!item.title)return;
    const a=editing?current.segments.map(s=>s.id===editing.id?item:s):[...current.segments,item];
    const {error}=await supabase.from("agenda_items").upsert({id:item.id,event_id:current.id,position:a.findIndex(s=>s.id===item.id),title:item.title,speaker:item.person,notes:item.notes||null,planned_duration_seconds:item.duration*60,scheduled_start:`${current.date}T${item.time}:00`,warning_seconds:120,urgent_seconds:30});
    if(error){setFeedback(`Segment save failed: ${error.message}`);return}
    updateCurrent({...current,segments:a,updatedAt:Date.now()});setEditOpen(false);setEditing(null);setFeedback(editing?"Segment saved to cloud":"Segment added to cloud");
  };
  const deleteEvent=async(id:string)=>{if(!confirm("Delete this event and its run of show? This cannot be undone."))return;const {error}=await supabase.from("events").delete().eq("id",id);if(error){setFeedback(`Delete failed: ${error.message}`);return}const rest=events.filter(e=>e.id!==id);setEvents(rest);if(id===currentId)setCurrentId(rest[0]?.id??"");if(!rest.length)setScreen("events");setFeedback("Event deleted")};
  const sendMessage=async(body:string)=>{if(!current)return;const text=body.trim();if(!text)return;const {error}=await supabase.from("event_messages").insert({event_id:current.id,body:text,priority:"normal",created_by:session.user.id});if(error){setFeedback(`Message failed: ${error.message}`);return}updateCurrent({...current,message:text});setDraftMessage("");setFeedback("Message sent")};
  const clearMessage=async()=>{if(!current)return;const {error}=await supabase.from("event_messages").update({cleared_at:new Date().toISOString()}).eq("event_id",current.id).is("cleared_at",null);if(error){setFeedback(`Clear failed: ${error.message}`);return}updateCurrent({...current,message:""})};

  if(!hydrated)return <main className="loading-state">Loading your events…</main>;
  if(displayMode&&current&&segment)return <main className={`display-view ${statusClass}`}><button className="exit-display" onClick={()=>{location.href="/dashboard"}}>Exit display</button><div className="display-kicker"><Radio size={16}/> {connection==="live"?"LIVE CLOUD":"NOT SYNCHRONIZED"} · {current.venue.toUpperCase()}</div><div className="display-title">{segment.title}</div><div className="display-clock" aria-live="polite">{formatTime(current.remaining)}</div><div className="display-status">{connection==="offline"?"OFFLINE":current.running?status:"PAUSED"}</div>{current.message&&<div className="display-message">{current.message}</div>}<div className="display-next">NEXT&nbsp;&nbsp; {next?.title??"End of show"}</div></main>;

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={()=>setScreen(current?"live":"events")}><span className="brand-mark"><span/></span><strong>Event Timer</strong></button><div className="event-switcher"><span>{current?.name??"No event selected"}</span><small>{current?`${current.date} · ${current.venue}`:"Create an event to begin"}</small></div><div className="top-actions"><span className={`sync ${connection}`}>{connection==="offline"?<WifiOff size={14}/>:<Wifi size={14}/>} {connection==="live"?"Cloud live":connection==="offline"?"Offline":"Reconnecting"}</span><button className="icon-button" disabled title="Global settings are not available in this release" aria-label="Settings unavailable"><Settings2 size={18}/></button><button className="avatar" onClick={()=>setScreen("account")} title="Account">{(session.user.email?.[0]??"E").toUpperCase()}</button></div></header>
    <nav className="rail" aria-label="Primary"><button className={screen==="live"?"rail-active":""} onClick={()=>setScreen(current?"live":"events")}><AlarmClock size={20}/><span>Live</span></button><button className={screen==="events"?"rail-active":""} onClick={()=>setScreen("events")}><Clock3 size={20}/><span>Events</span></button><button className={screen==="displays"?"rail-active":""} disabled={!current} onClick={()=>setScreen("displays")}><Users size={20}/><span>Displays</span></button><button disabled title="Import is not available yet"><Sparkles size={20}/><span>Import soon</span></button><div className="rail-bottom"><button className={screen==="account"?"rail-active":""} onClick={()=>setScreen("account")}><Settings2 size={20}/><span>Account</span></button></div></nav>
    <section className="workspace" id="top">
      {feedback&&<div className="feedback" role="status">{feedback}</div>}
      {screen==="account"&&<AccountView session={session}/>}
      {screen==="events"&&<EventsView events={events} currentId={currentId} onOpen={id=>{setCurrentId(id);setScreen("live")}} onCreate={()=>setCreateOpen(true)} onDelete={deleteEvent}/>}
      {screen==="displays"&&current&&<DisplaysView current={current} onOpen={openDisplay} onCopy={copyDisplay}/>}
      {screen==="live"&&!current&&<EmptyState onCreate={()=>setCreateOpen(true)}/>}
      {screen==="live"&&current&&segment&&<>
        <div className="workspace-heading"><div><div className="eyebrow"><span className="live-dot"/> LIVE CONTROL</div><h1>{current.name}</h1></div><div className="heading-actions"><button className="button secondary" onClick={openDisplay}><Fullscreen size={16}/> Open display</button><button className="button secondary" onClick={copyDisplay}><Link2 size={16}/> Share</button></div></div>
        <div className="status-strip"><div><span>EVENT STATUS</span><strong className="green"><Circle size={9} fill="currentColor"/> {current.running?"Running":"Ready / paused"}</strong></div><div><span>DATE</span><strong>{current.date}</strong></div><div><span>PROJECTED FINISH</span><strong>{projected}</strong></div><div><span>STORAGE</span><strong>Cloud saved</strong></div><div className="connection-label"><span className={connection==="live"?"pulse":"offline"}/>{connection==="live"?"Realtime connected":connection==="offline"?"Offline — state may be stale":"Reconnecting"}</div></div>
        <div className="console-grid"><section className={`timer-card ${statusClass}`}><div className="timer-meta"><span><Radio size={14}/> {current.running?"NOW LIVE":"READY"}</span><button disabled title="Countdown mode only in this release">COUNTDOWN</button></div><div className="segment-title">{segment.title}</div><div className="speaker">{segment.person}</div><div className="timer" aria-live="polite">{formatTime(current.remaining)}</div><div className="timer-state"><span>{current.running?status:"PAUSED"}</span><small>Warning at 02:00 · Urgent at 00:30</small></div>
          <div className="controls"><button onClick={()=>setTimer(current.remaining-30)} aria-label="Subtract 30 seconds"><Minus size={20}/><span>30 SEC</span></button><button className="primary-control" onClick={toggleTimer}>{current.running?<Pause size={30} fill="currentColor"/>:<Play size={30} fill="currentColor"/>}<span>{current.running?"PAUSE":"START / RESUME"}</span></button><button onClick={()=>setTimer(current.remaining+60)} aria-label="Add one minute"><Plus size={20}/><span>1 MIN</span></button><button className="reset" onClick={()=>setTimer(segment.duration*60,false)}><RotateCcw size={19}/><span>RESET</span></button></div>
          <div className="segment-nav"><button disabled={current.active===0} onClick={()=>jump(current.active-1,false)}><ArrowLeft size={16}/> Previous</button><button onClick={()=>setTimer(segment.duration*60,true)}><RotateCcw size={16}/> Restart</button><button disabled={!next} onClick={()=>next&&jump(current.active+1,true)}><SkipForward size={16}/> Skip / next</button></div>
          <button className="next-button" onClick={()=>next&&jump(current.active+1,true)} disabled={!next}><span>NEXT</span><strong>{next?.title??"Show complete"}</strong><ArrowRight size={20}/></button></section>
          <aside className="comms-card"><div className="panel-title"><div><MessageSquareText size={18}/><span>Message to stage</span></div><small>{current.venue.toUpperCase()}</small></div><div className="presets">{["2 MINUTES","WRAP UP","SLOW DOWN","PLEASE WAIT"].map(p=><button key={p} onClick={()=>setDraftMessage(p)}>{p}</button>)}</div><div className="message-compose"><input value={draftMessage} onChange={e=>setDraftMessage(e.target.value)} placeholder="Type a private message…" maxLength={80}/><button disabled={!draftMessage.trim()} onClick={()=>void sendMessage(draftMessage)} aria-label="Send"><Send size={18}/></button></div>{current.message&&<div className="sent-preview"><span>DISPLAYING NOW</span><strong>{current.message}</strong><button onClick={()=>void clearMessage()}>Clear</button></div>}<div className="cue-section"><div className="panel-title"><div><Bell size={18}/><span>Quick cues</span></div></div><div className="cue-grid">{["GO","HOLD","STANDBY","MIC LIVE"].map(c=><button key={c} onClick={()=>void sendMessage(c)}>{c}</button>)}</div></div><div className="display-health"><span><span className={connection==="live"?"pulse":"offline"}/> Realtime channel</span><small>{connection}</small></div></aside></div>
        <section className="rundown"><div className="rundown-head"><div><span>RUN OF SHOW</span><strong>{current.segments.length} segments · {current.segments.reduce((a,s)=>a+s.duration,0)} min planned</strong></div><div className="variance"><small>PERSISTENCE</small><strong>CLOUD SAVED</strong></div><button className="button secondary" onClick={()=>{setEditing(null);setEditOpen(true)}}><Plus size={15}/> Add segment</button></div><div className="table-head"><span>TIME</span><span>SEGMENT</span><span>PERSON / LOCATION</span><span>DURATION</span><span>ACTIONS</span></div>{current.segments.map((s,i)=><div className={`run-row ${i===current.active?"active":""}`} key={s.id}><button className="row-jump" onClick={()=>jump(i,false)}><span>{s.time}</span><span><b>{s.title}</b></span><span>{s.person}</span><span>{s.duration} min</span></button><div className="row-actions"><button disabled={i===0} onClick={()=>move(i,i-1)} aria-label="Move up"><ArrowUp size={14}/></button><button disabled={i===current.segments.length-1} onClick={()=>move(i,i+1)} aria-label="Move down"><ArrowDown size={14}/></button><button onClick={()=>{setEditing(s);setEditOpen(true)}} aria-label="Edit"><Pencil size={14}/></button><button onClick={()=>void duplicate(s,i)} aria-label="Duplicate"><Copy size={14}/></button><button disabled={current.segments.length===1} onClick={()=>void remove(s.id)} aria-label="Delete"><Trash2 size={14}/></button></div></div>)}</section>
      </>}
    </section>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><form onSubmit={saveEvent} className="dialog-form"><DialogHeader><DialogTitle>Create event</DialogTitle><DialogDescription>This event and its run of show will be saved to your Event Timer cloud account.</DialogDescription></DialogHeader><label>Event name<input name="name" required placeholder="Annual conference"/></label><label>Date<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label>Venue / room<input name="venue" required defaultValue="Main Stage"/></label><DialogFooter><button type="button" className="button secondary" onClick={()=>setCreateOpen(false)}>Cancel</button><button className="button primary" type="submit">Create event</button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={editOpen} onOpenChange={o=>{setEditOpen(o);if(!o)setEditing(null)}}><DialogContent><form onSubmit={saveSegment} className="dialog-form"><DialogHeader><DialogTitle>{editing?"Edit segment":"Add segment"}</DialogTitle><DialogDescription>Changes save immediately to Event Timer cloud.</DialogDescription></DialogHeader><label>Title<input name="title" required defaultValue={editing?.title}/></label><div className="form-grid"><label>Start time<input name="time" type="time" required defaultValue={editing?.time??"11:10"}/></label><label>Duration (minutes)<input name="duration" type="number" min="1" max="480" required defaultValue={editing?.duration??10}/></label></div><label>Person / location<input name="person" required defaultValue={editing?.person??"Unassigned"}/></label><label>Notes<input name="notes" defaultValue={editing?.notes??""}/></label><DialogFooter><button type="button" className="button secondary" onClick={()=>setEditOpen(false)}>Cancel</button><button className="button primary" type="submit">Save segment</button></DialogFooter></form></DialogContent></Dialog>
  </main>;
}

function EmptyState({onCreate}:{onCreate:()=>void}){return <section className="empty-cloud"><p className="eyebrow">EVENT TIMER CLOUD</p><h1>Create your first live event</h1><p>Build a run of show, control the timer, and reopen the event from any authenticated browser.</p><button className="button primary" onClick={onCreate}><Plus size={16}/> Create event</button></section>}
function EventsView({events,currentId,onOpen,onCreate,onDelete}:{events:EventData[];currentId:string;onOpen:(id:string)=>void;onCreate:()=>void;onDelete:(id:string)=>void}){return <><div className="workspace-heading"><div><div className="eyebrow">EVENT TIMER CLOUD</div><h1>Events</h1></div><button className="button primary" onClick={onCreate}><Plus size={16}/> Create event</button></div>{events.length?<div className="event-list">{events.map(e=><article className="event-card" key={e.id}><div><span>{e.date}</span><h2>{e.name}</h2><p>{e.venue} · {e.segments.length} segments</p></div><div><button className="button secondary" onClick={()=>onOpen(e.id)}>{e.id===currentId?"Open current":"Open event"}</button><button className="icon-button danger" onClick={()=>onDelete(e.id)} aria-label="Delete event"><Trash2 size={16}/></button></div></article>)}</div>:<EmptyState onCreate={onCreate}/>}</>}
function DisplaysView({current,onOpen,onCopy}:{current:EventData;onOpen:()=>void;onCopy:()=>void}){return <><div className="workspace-heading"><div><div className="eyebrow">SECURE CLOUD DISPLAY</div><h1>Displays</h1></div></div><article className="display-card"><div className="display-preview"><span>{current.segments[current.active]?.title}</span><strong>{formatTime(current.remaining)}</strong><small>{current.running?"LIVE":"PAUSED"}</small></div><div><h2>Speaker display</h2><p>Opens on another browser and synchronizes through Event Timer cloud. The display must sign in to an authorized account.</p><div className="display-actions"><button className="button primary" onClick={onOpen}><Fullscreen size={16}/> Open display</button><button className="button secondary" onClick={onCopy}><Copy size={16}/> Copy secure link</button></div></div></article><article className="unavailable-card"><div><h3>Public token pairing</h3><p>Unavailable until a display-token policy is deployed. Secure authenticated displays are available now.</p></div><button disabled className="button secondary">Setup required</button></article></>}
function AccountView({session}:{session:Session}){const logout=async()=>{await supabase.auth.signOut();location.href="/"};return <section className="account-panel"><p className="eyebrow">ACCOUNT</p><h1>Event Timer account</h1><dl><div><dt>Email</dt><dd>{session.user.email}</dd></div><div><dt>Session</dt><dd>Secure Supabase session · refresh enabled</dd></div><div><dt>Plan</dt><dd>Cloud beta</dd></div></dl><button className="button secondary" onClick={()=>void logout()}><LogOut size={16}/> Log out</button></section>}
