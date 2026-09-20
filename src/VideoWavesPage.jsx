import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Heart, MessageCircle, MoreHorizontal, Play, Share2, Volume2, VolumeX } from 'lucide-react'
import { supabase } from './supabaseClient'
import { reactToPost } from './wavoData'
import './video-waves.css'

const PAGE_SIZE = 50
function initial(name){return (name?.trim()?.[0] || 'W').toUpperCase()}
function Avatar({profile}){return <div className="video-wave-avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : initial(profile?.username)}</div>}
async function signMedia(path){if(!path)return null;const {data}=await supabase.storage.from('wave-media').createSignedUrl(path,15*60);return data?.signedUrl||null}
async function loadVideoWaves(){
 const {data:posts,error}=await supabase.from('posts').select('*').eq('media_type','video').order('created_at',{ascending:false}).limit(PAGE_SIZE);
 if(error)throw error;if(!posts?.length)return [];
 const authorIds=[...new Set(posts.map(p=>p.author_id).filter(Boolean))];const postIds=posts.map(p=>p.id);
 const [profiles,reactions]=await Promise.all([supabase.from('profiles').select('id,username,avatar_url,status').in('id',authorIds),supabase.from('post_reactions').select('*').in('post_id',postIds)]);
 const profileMap=Object.fromEntries((profiles.data||[]).map(p=>[p.id,p]));const reactionRows=reactions.data||[];
 return Promise.all(posts.map(async post=>({...post,author:profileMap[post.author_id],reactions:reactionRows.filter(r=>r.post_id===post.id),media_url_signed:await signMedia(post.media_path)}))).then(rows=>rows.filter(p=>p.media_url_signed));
}
function count(value){if(value<1000)return String(value);if(value<1000000)return (value/1000).toFixed(value<10000?1:0)+'K';return (value/1000000).toFixed(1)+'M'}
function relativeTime(value){const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));if(minutes<1)return 'now';if(minutes<60)return minutes+'m';const hours=Math.floor(minutes/60);if(hours<24)return hours+'h';return Math.floor(hours/24)+'d'}

function VideoCard({post,userId,active,onLike,onShare,onSave,onOpenComments}){
 const videoRef=useRef(null);const [muted,setMuted]=useState(true);const [playing,setPlaying]=useState(active);const [saved,setSaved]=useState(false);
 const myReaction=(post.reactions||[]).find(r=>r.user_id===userId);const liked=Boolean(myReaction);const likeCount=(post.reactions||[]).length;
 useEffect(()=>{const video=videoRef.current;if(!video)return;if(active){video.currentTime=0;video.muted=muted;video.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false))}else{video.pause();setPlaying(false)}},[active,muted]);
 function togglePlay(){const video=videoRef.current;if(!video)return;if(video.paused){video.play().catch(()=>{});setPlaying(true)}else{video.pause();setPlaying(false)}}
 async function share(){const url=window.location.origin+'/waves/video?wave='+post.id;if(navigator.share){await navigator.share({title:'Wave by @'+(post.author?.username||'user'),text:post.body||'Watch this Wave',url}).catch(()=>{})}else{await navigator.clipboard?.writeText(url);onShare()}}
 return <article className="video-wave-card">
  <video ref={videoRef} className="video-wave-player" src={post.media_url_signed} playsInline loop muted={muted} preload={active?'auto':'metadata'} onClick={togglePlay} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} aria-label={post.body||'Wave video'}/>
  <div className="video-wave-scrim"/>
  <button className="video-wave-sound" onClick={()=>setMuted(v=>!v)} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button>
  <div className="video-wave-meta"><div className="video-wave-author"><Avatar profile={post.author}/><strong>@{post.author?.username||'wavo'}</strong><span>· {relativeTime(post.created_at)}</span></div>{post.body&&<p>{post.body}</p>}<span className="video-wave-audio">♫ Original Wave audio</span></div>
  <aside className="video-wave-actions">
   <button className={liked?'active':''} onClick={()=>onLike(post,liked?null:'❤️')} aria-label="Like"><Heart size={28} fill={liked?'currentColor':'none'}/><span>{count(likeCount)}</span></button>
   <button onClick={()=>onOpenComments(post)} aria-label="Comments"><MessageCircle size={28}/><span>Comments</span></button>
   <button onClick={share} aria-label="Share"><Share2 size={28}/><span>Share</span></button>
   <button className={saved?'active':''} onClick={()=>{setSaved(v=>!v);onSave(post,!saved)}} aria-label="Save"><Bookmark size={28} fill={saved?'currentColor':'none'}/><span>Save</span></button>
   <button onClick={()=>navigator.clipboard?.writeText(window.location.origin+'/waves/video?wave='+post.id)} aria-label="More"><MoreHorizontal size={28}/><span>More</span></button>
  </aside>
 </article>
}

export default function VideoWavesPage(){
 const [session,setSession]=useState(null);const [posts,setPosts]=useState([]);const [activeId,setActiveId]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [toast,setToast]=useState('');const [commentsPost,setCommentsPost]=useState(null);
 const userId=session?.user?.id;
 useEffect(()=>{let alive=true;supabase.auth.getSession().then(({data})=>{if(alive)setSession(data.session||null)});const {data}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>{alive=false;data.subscription.unsubscribe()}},[]);
 useEffect(()=>{if(!userId)return;setLoading(true);loadVideoWaves().then(rows=>{setPosts(rows);setActiveId(rows[0]?.id||null)}).catch(err=>{console.error('[wavo] video waves',err);setError('Could not load Waves right now.')}).finally(()=>setLoading(false))},[userId]);
 useEffect(()=>{if(!posts.length)return;const cards=[...document.querySelectorAll('[data-video-wave-id]')];const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible?.target?.dataset?.videoWaveId)setActiveId(visible.target.dataset.videoWaveId)},{threshold:[0.55,0.8]});cards.forEach(card=>observer.observe(card));return()=>observer.disconnect()},[posts]);
 async function like(post,emoji){if(!userId)return;await reactToPost(userId,post.id,emoji);setPosts(current=>current.map(item=>item.id===post.id?{...item,reactions:emoji?[...(item.reactions||[]).filter(r=>r.user_id!==userId),{user_id:userId,emoji}]:(item.reactions||[]).filter(r=>r.user_id!==userId)}:item))}
 if(!userId)return <div className="video-wave-gate">Sign in to open Waves.</div>;
 return <main className="video-waves-shell"><header className="video-waves-topbar"><button onClick={()=>window.history.length>1?window.history.back():window.location.assign('/')}><ArrowLeft size={20}/></button><strong>Waves</strong><span>For You</span></header>
  {loading&&<div className="video-waves-loading">Loading Waves…</div>}{error&&<div className="video-waves-error">{error}</div>}{!loading&&!posts.length&&<div className="video-waves-empty"><strong>No video Waves yet.</strong><span>Post the first one.</span></div>}
  <section className="video-waves-feed">{posts.map(post=><div key={post.id} data-video-wave-id={post.id} className="video-wave-snap"><VideoCard post={post} userId={userId} active={activeId===post.id} onLike={like} onShare={()=>setToast('Link copied')} onSave={()=>{}} onOpenComments={post=>{setCommentsPost(post);setToast('Comments panel is next in the video-feed pass.')}}/></div>)}</section>
  {commentsPost&&<div className="video-wave-modal" onClick={()=>setCommentsPost(null)}><div onClick={e=>e.stopPropagation()} className="video-wave-comments"><strong>Comments</strong><p>Comment threads are being added in the next pass.</p><button onClick={()=>setCommentsPost(null)}>Close</button></div></div>}
  {toast&&<button className="video-wave-toast" onClick={()=>setToast('')}>{toast}</button>}</main>
}