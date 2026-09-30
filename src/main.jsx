import React,{useEffect,useMemo,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{BookOpen,Brain,ChevronLeft,ChevronRight,Clock3,FileText,Folder,FolderPlus,History,Home as HomeIcon,ListChecks,Minus,Plus,Search,Sparkles,Target,Trash2,Upload,X,Highlighter,Lock,Unlock,Palette,PenLine,Eraser,ExternalLink,ArrowLeft}from"lucide-react";
import pdfWorkerUrl from"pdfjs-dist/build/pdf.worker.min.js?url";
import"./styles.css";


const demo={id:"demo",title:"Mitose — cours de démonstration",kind:"demo",pages:[
{id:"p1",n:1,text:"Le centrosome est le principal centre organisateur des microtubules. Il est constitué de deux centrioles disposés perpendiculairement, entourés de matériel péricentriolaire."},
{id:"p2",n:2,text:"Aurora B participe au dispositif de contrôle des accrochages des kinétochores. La mise sous tension du centromère réduit l'activité de ce dispositif de contrôle."},
{id:"p3",n:3,text:"Les microtubules du fuseau sont constitués de tubuline. Leur extrémité + présente une dynamique importante au cours de la mitose."}]};

const levels=[["again","🔴","Pas du tout",10],["hard","🟠","Difficile",1440],["medium","🟡","Moyen",4320],["good","🟢","Bien acquis",10080],["perfect","🔵","Parfait",30240]];
const load=(k,d)=>{
 try{
   const raw=window.localStorage?.getItem(k);
   return raw?JSON.parse(raw):d;
 }catch{return d}
};
const save=(k,v)=>{
 try{window.localStorage?.setItem(k,JSON.stringify(v))}catch{}
};
function getAIEndpoint(){
 try{
  const saved=window.localStorage?.getItem("rmed_ai_api_url")?.trim();
  if(saved)return saved;
 }catch{}
 const env=import.meta.env?.VITE_RMED_AI_URL?.trim();
 if(env)return env;
 return "https://r-med.vercel.app/api/ai";
}
async function callRMedAI({action,text,context=""}){
 const endpoint=getAIEndpoint();
 if(!endpoint)throw new Error("IA non connectée : le backend RMed doit être configuré.");
 const controller=new AbortController();
 const timeoutMs=action==="qcm_session"?90000:45000;
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},signal:controller.signal,body:JSON.stringify({action,text:String(text||"").slice(0,12000),context:String(context||"").slice(0,30000)})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||"Le service IA a refusé la demande.");
  return data;
 }catch(err){
  if(err?.name==="AbortError")throw new Error("L’IA met trop de temps à répondre.");
  throw err;
 }finally{clearTimeout(timer)}
}

const uid=()=>{
 try{return window.crypto?.randomUUID?.()||String(Date.now())+Math.random().toString(16).slice(2)}
 catch{return String(Date.now())+Math.random().toString(16).slice(2)}
};
let pdfjsPromise=null;
async function getPdfjs(){
 if(!pdfjsPromise)pdfjsPromise=import("pdfjs-dist");
 return pdfjsPromise;
}
async function openPdfDocument(data){
 const pdfjsLib=await getPdfjs();
 pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
 const source=data instanceof ArrayBuffer?data.slice(0):data;
 const bytes=source instanceof Uint8Array?new Uint8Array(source):new Uint8Array(source);
 return await pdfjsLib.getDocument({data:bytes.slice(0),isEvalSupported:false,useSystemFonts:true,verbosity:0}).promise;
}

const dbPromise=(()=>{
 if(typeof indexedDB==="undefined")return Promise.resolve(null);
 try{
   return new Promise((resolve,reject)=>{
     const req=indexedDB.open("rmed-files",1);
     req.onupgradeneeded=()=>{try{req.result.createObjectStore("pdfs")}catch{}};
     req.onsuccess=()=>resolve(req.result);
     req.onerror=()=>reject(req.error);
   });
 }catch{return Promise.resolve(null)}
})();
async function savePdf(id,data){
 try{
   const db=await dbPromise;if(!db)return;
   await new Promise((res,rej)=>{const tx=db.transaction("pdfs","readwrite");tx.objectStore("pdfs").put(data,id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
 }catch(err){console.warn("PDF storage unavailable",err)}
}
async function getPdf(id){
 try{
   const db=await dbPromise;if(!db)return null;
   return await new Promise((res,rej)=>{const tx=db.transaction("pdfs","readonly");const r=tx.objectStore("pdfs").get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)});
 }catch(err){console.warn("PDF storage unavailable",err);return null}
}

const resourceChunkCache=new Map();

function aiTokens(value){
 return String(value||"")
  .toLowerCase()
  .normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")
  .replace(/[^a-z0-9'-]+/g," ")
  .split(/\\s+/)
  .filter(w=>w.length>2&&!/^(les|des|une|dans|avec|pour|sur|par|que|qui|est|sont|aux|plus|moins|cette|ces|son|ses|leur|leurs|entre|vers|comme|mais|donc|ainsi|elle|elles|ils|nous|vous|etre|avoir|faire|tres|aussi|puis)$/.test(w));
}

function splitResourceText(text,maxChars=1500,overlap=180){
 const value=String(text||"").replace(/\\s+/g," ").trim();
 if(!value)return [];
 if(value.length<=maxChars)return [value];
 const out=[];let start=0;
 while(start<value.length&&out.length<80){
  let end=Math.min(value.length,start+maxChars);
  if(end<value.length){
   const cut=value.lastIndexOf(". ",end);
   if(cut>start+700)end=cut+1;
  }
  const piece=value.slice(start,end).trim();
  if(piece)out.push(piece);
  if(end>=value.length)break;
  start=Math.max(start+1,end-overlap);
 }
 return out;
}

async function getCourseResourceChunks(course){
 if(!course)return [];
 if(resourceChunkCache.has(course.id))return resourceChunkCache.get(course.id);
 const chunks=[];
 if(course.kind==="demo"){
  for(const p of course.pages||[]){
   const text=String(p.text||"").trim();
   if(text)chunks.push({courseId:course.id,title:course.title,page:p.n,text});
  }
  resourceChunkCache.set(course.id,chunks);
  return chunks;
 }
 try{
  const data=await getPdf(course.id);
  if(!data){resourceChunkCache.set(course.id,[]);return []}
  const doc=await openPdfDocument(data);
  for(let i=1;i<=doc.numPages;i++){
   const page=await doc.getPage(i);
   const content=await page.getTextContent();
   const pageText=content.items.map(x=>x.str||"").join(" ").replace(/\\s+/g," ").trim();
   splitResourceText(pageText).forEach((text,index)=>chunks.push({courseId:course.id,title:course.title,page:i,chunk:index,text}));
  }
  resourceChunkCache.set(course.id,chunks);
  return chunks;
 }catch(err){
  console.warn("RMed resource extraction error",err);
  resourceChunkCache.set(course.id,[]);
  return [];
 }
}

async function retrieveResourceContext(courses,{courseId=null,query="",limit=18000,maxChunks=14}={}){
 const all=[];
 for(const course of courses||[])all.push(...await getCourseResourceChunks(course));
 if(!all.length)return "";
 const q=String(query||"").trim();
 const qTokens=[...new Set(aiTokens(q))];
 const scored=all.map((chunk,index)=>{
  const lower=chunk.text.toLowerCase();
  const tokenHits=qTokens.reduce((sum,t)=>sum+(lower.includes(t)?1:0),0);
  const exact=qTokens.filter(t=>t.length>5&&lower.includes(t)).length;
  const phrase=q.length>10&&lower.includes(q.toLowerCase())?8:0;
  const courseBoost=courseId&&chunk.courseId===courseId?5:0;
  const titleBoost=q&&qTokens.some(t=>t.length>3&&chunk.title.toLowerCase().includes(t))?2:0;
  return {...chunk,score:tokenHits*2+exact+phrase+courseBoost+titleBoost,index};
 }).sort((a,b)=>b.score-a.score||a.page-b.page||a.index-b.index);
 const selected=[];
 const perCourse=new Map();
 const perPage=new Map();
 for(const chunk of scored){
  if(selected.length>=maxChunks)break;
  const courseCount=perCourse.get(chunk.courseId)||0;
  const pageKey=chunk.courseId+"::"+chunk.page;
  const pageCount=perPage.get(pageKey)||0;
  if(courseCount>=5||pageCount>=2)continue;
  selected.push(chunk);
  perCourse.set(chunk.courseId,courseCount+1);
  perPage.set(pageKey,pageCount+1);
 }
 if(q&&selected.length<Math.min(6,maxChunks)){
  for(const chunk of all){
   if(selected.some(x=>x.courseId===chunk.courseId&&x.page===chunk.page&&x.text===chunk.text))continue;
   selected.push(chunk);
   if(selected.length>=Math.min(6,maxChunks))break;
  }
 }
 let remaining=limit;const parts=[];
 for(const chunk of selected){
  if(remaining<120)break;
  const header="=== COURS: "+chunk.title+" — PAGE "+chunk.page+" ===\\n";
  const body=chunk.text.slice(0,Math.max(200,remaining-header.length));
  parts.push(header+body);
  remaining-=header.length+body.length+2;
 }
 return parts.join("\\n\\n").slice(0,limit);
}

async function buildStudyContext(courses,{courseId=null,limit=30000,maxChunks=24}={}){
 const all=[];
 for(const course of courses||[])all.push(...await getCourseResourceChunks(course));
 if(!all.length)return "";
 const ordered=[...all].sort((a,b)=>{
  const ac=courseId&&a.courseId===courseId?0:1;
  const bc=courseId&&b.courseId===courseId?0:1;
  return ac-bc||a.courseId.localeCompare(b.courseId)||a.page-b.page||((a.chunk||0)-(b.chunk||0));
 });
 const picks=[];const seenPages=new Set();
 const addOne=(c)=>{
  const key=c.courseId+"::"+c.page;
  if(seenPages.has(key)||picks.length>=maxChunks)return false;
  seenPages.add(key);picks.push(c);return true;
 };
 if(courseId)for(const c of ordered)if(c.courseId===courseId){addOne(c);if(picks.length>=maxChunks)break;}
 for(let i=0;picks.length<maxChunks&&i<ordered.length;i++)addOne(ordered[i]);
 let remaining=limit;const parts=[];
 for(const c of picks){
  if(remaining<120)break;
  const header="=== COURS: "+c.title+" — PAGE "+c.page+" ===\\n";
  const body=c.text.slice(0,Math.max(200,remaining-header.length));
  parts.push(header+body);
  remaining-=header.length+body.length+2;
 }
 return parts.join("\\n\\n").slice(0,limit);
}

async function deletePdf(id){
 const db=await dbPromise;if(!db)return;
 await new Promise((res,rej)=>{const tx=db.transaction("pdfs","readwrite");tx.objectStore("pdfs").delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
}

function folderPath(folders,id){
 const out=[];let cursor=folders.find(f=>f.id===id)||null;
 while(cursor){out.unshift(cursor.name);cursor=folders.find(f=>f.id===cursor.parentId)||null;}
 return out;
}
function descendantFolderIds(folders,id){
 if(!id)return [];
 const out=[id],queue=[id];
 while(queue.length){
  const parent=queue.shift();
  for(const f of folders)if((f.parentId||null)===parent&&!out.includes(f.id)){out.push(f.id);queue.push(f.id);}
 }
 return out;
}
function scopedCards(cards,courses,folders,scope){
 if(!scope||scope.type==="all")return cards;
 if(scope.type==="course")return cards.filter(c=>c.courseId===scope.id);
 const ids=descendantFolderIds(folders,scope.id);
 return cards.filter(c=>{
   const co=courses.find(x=>x.id===c.courseId);
   return ids.includes(co?.folderId||null);
 });
}

function Root(){
 const params=new URLSearchParams(window.location.search);
 const readerId=params.get("reader");
 if(readerId)return <ExternalPdfReader courseId={readerId} initialPage={Number(params.get("page")||1)}/>;
 return <App/>;
}

function App(){
 const[courses,setCourses]=useState(()=>load("rmed_courses",[demo]));
 const[folders,setFolders]=useState(()=>load("rmed_folders",[]));
 const[cards,setCards]=useState(()=>load("rmed_cards",[]));
 const[reviewScope,setReviewScope]=useState({type:"all",id:null});
 const[moveCourseId,setMoveCourseId]=useState(null);
 const[batchCreated,setBatchCreated]=useState(null);
 const[batchBusy,setBatchBusy]=useState(false);
 const[highlights,setHighlights]=useState(()=>load("rmed_highlights",[]));
 const[history,setHistory]=useState(()=>load("rmed_history",[]));
 const[tab,setTab]=useState("home");
 const[activeFolderId,setActiveFolderId]=useState(null);
 const[course,setCourse]=useState(demo);
 const[pageNumber,setPageNumber]=useState(1);
 const[pdfDoc,setPdfDoc]=useState(null);
 const[pdfLoading,setPdfLoading]=useState(false);
 const[pdfError,setPdfError]=useState("");
 const[pdfNativeUrl,setPdfNativeUrl]=useState("");
 const[pdfBlobRef]=useState(()=>({url:""}));
 const[zoom,setZoom]=useState(1.25);
 const[sel,setSel]=useState(null);
 const[focusHighlightId,setFocusHighlightId]=useState(null);
 const[search,setSearch]=useState("");
 const[modal,setModal]=useState(false);
 const[draft,setDraft]=useState(null);
 const[suggestions,setSuggestions]=useState([]);
 const[revealed,setRevealed]=useState(false);
 const[ri,setRi]=useState(0);
 const[qcm,setQcm]=useState(null);
 const[pdfLocked,setPdfLocked]=useState(false);
 const[uploadOpen,setUploadOpen]=useState(false);
 const[aiOpen,setAiOpen]=useState(false);
 const pdfCache=useRef(new Map());

 useEffect(()=>save("rmed_courses",courses),[courses]);
 useEffect(()=>save("rmed_folders",folders),[folders]);
 useEffect(()=>save("rmed_cards",cards),[cards]);
 useEffect(()=>save("rmed_highlights",highlights),[highlights]);
 useEffect(()=>save("rmed_history",history),[history]);

 const allDue=useMemo(()=>cards.filter(c=>!c.next||c.next<=Date.now()),[cards,history]);
 const reviewPool=useMemo(()=>scopedCards(cards,courses,folders,reviewScope),[cards,courses,folders,reviewScope]);
 const due=useMemo(()=>reviewPool.filter(c=>!c.next||c.next<=Date.now()),[reviewPool]);
 const rc=due[ri];

 async function loadPdf(c){
   if(c.kind!=="pdf"){setPdfDoc(null);setPdfError("");return}
   setPdfLoading(true);setPdfError("");setPdfDoc(null);
   try{
     if(pdfCache.current.has(c.id)){setPdfDoc(pdfCache.current.get(c.id));setPdfLoading(false);return}
     const data=await getPdf(c.id);
     if(!data)throw new Error("PDF introuvable dans le stockage de cet appareil.");
     try{
       const doc=await openPdfDocument(data);
       const pages=c.pages?.length?c.pages:Array.from({length:doc.numPages},(_,i)=>({id:uid(),n:i+1}));
       const hydrated={...c,pages};
       pdfCache.current.set(c.id,doc);
       setPdfDoc(doc);
       setCourse(hydrated);
       if(!c.pages?.length)setCourses(x=>x.map(v=>v.id===c.id?hydrated:v));
       setPdfNativeUrl("");
       return;
     }catch(pdfJsError){
       if(!isAppleMobile())throw pdfJsError;
       const url=URL.createObjectURL(new Blob([data],{type:"application/pdf"}));
       if(pdfBlobRef.url)URL.revokeObjectURL(pdfBlobRef.url);
       pdfBlobRef.url=url;
       setPdfNativeUrl(url);
     }
   }catch(err){
     console.error("RMed PDF open error:",err);
     setPdfDoc(null);
     setPdfError(err?.message||"Impossible d’ouvrir le PDF.");
   }finally{setPdfLoading(false)}
 }

 function createFolder(name,parentId=null){
   const clean=String(name||"").trim();
   if(!clean)return;
   setFolders(x=>[...x,{id:uid(),name:clean,parentId:parentId||null,created:Date.now()}]);
 }

 async function open(c,pg=1,focus=null){
   setCourse(c);
   setActiveFolderId(c.folderId||null);
   setPageNumber(typeof pg==="number"?pg:1);
   setFocusHighlightId(focus);
   setSel(null);
   setTab("course");
   if(c.kind==="pdf")await loadPdf(c);else setPdfDoc(null);
 }

 function nav(t){setTab(t);if(t==="review"){setReviewScope({type:"all",id:null});setRi(0);setRevealed(false)}}
 function navReview(type="all",id=null){setReviewScope({type,id});setRi(0);setRevealed(false);setTab("review")}
 function moveCurrentCourse(folderId){
   if(!course?.id)return;
   const target=folderId||null;
   setCourses(x=>x.map(c=>c.id===course.id?{...c,folderId:target}:c));
   setActiveFolderId(target);
   setMoveCourseId(null);
 }
 async function createBatchFlashcards(targetCourse){
   if(!targetCourse||batchBusy)return;
   setBatchBusy(true);
   try{
    const context=await buildStudyContext([targetCourse],{courseId:targetCourse.id,limit:30000,maxChunks:24});
    if(!context.trim())throw new Error("Aucun texte exploitable dans ce cours.");
    const data=await callRMedAI({action:"flashcard_batch",text:"Crée exactement 8 flashcards de PASS à partir uniquement de ce cours. Varie les formulations et couvre les notions les plus importantes.",context});
    if(!Array.isArray(data?.cards)||!data.cards.length)throw new Error("RMed n’a pas généré de flashcards.");
    const now=Date.now();
    const created=data.cards.slice(0,8).filter(c=>c?.front&&c?.back).map((c,i)=>{
      const pageNumber=Number(c.page)||1;
      const page=targetCourse.pages.find(p=>p.n===pageNumber)||targetCourse.pages[0];
      return {
       id:uid(),courseId:targetCourse.id,pageId:page?.id||null,page:page?.n||1,highlightId:null,
       source:String(c.source|| (targetCourse.title+" — page "+(page?.n||1))),type:c.type||"basic",
       front:String(c.front).trim(),back:String(c.back).trim(),level:null,next:now,created:now+i
      };
    });
    setCards(x=>[...x,...created]);
    setBatchCreated({course:targetCourse,cards:created});
   }catch(err){alert(err?.message||"Impossible de créer les flashcards.");}
   finally{setBatchBusy(false)}
 }

 async function addPdf(file,folderId=activeFolderId){
   if(!file)return;
   if(file.type&&file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("Choisis un fichier PDF.");return}
   setPdfLoading(true);setPdfError("");
   try{
     const buffer=await file.arrayBuffer();
     if(!buffer||buffer.byteLength<5)throw new Error("Fichier vide ou illisible");
     const id=uid();
     const title=file.name.replace(/\.pdf$/i,"");
     const c={id,title,kind:"pdf",pages:[],folderId:folderId||null,created:Date.now()};
     await savePdf(id,buffer);
     setCourses(x=>[...x,c]);
     setCourse(c);setPageNumber(1);setPdfDoc(null);setTab("course");setUploadOpen(false);
     let doc=null;
     try{
       doc=await openPdfDocument(buffer.slice(0));
       setPdfNativeUrl("");
     }catch(e){
       if(!isAppleMobile())throw e;
       const url=URL.createObjectURL(new Blob([buffer],{type:"application/pdf"}));
       if(pdfBlobRef.url)URL.revokeObjectURL(pdfBlobRef.url);
       pdfBlobRef.url=url;
       setPdfNativeUrl(url);
     }
     if(doc){
       const pages=Array.from({length:doc.numPages},(_,i)=>({id:uid(),n:i+1}));
       const hydrated={...c,pages};
       pdfCache.current.set(id,doc);
       setPdfDoc(doc);
       setCourse(hydrated);
       setCourses(x=>x.map(v=>v.id===id?hydrated:v));
     }
     return;
   }catch(err){
     console.error("PDF import error:",err);
     setPdfError(err?.message||"Impossible d’ouvrir le PDF.");
   }finally{setPdfLoading(false)}
 }

 function importPdf(e){const file=e.target.files?.[0];if(file)addPdf(file);e.target.value=""}

 function currentPage(){return course.pages.find(x=>x.n===pageNumber)||course.pages[0]}

 function addHighlight(selection){
   if(!selection?.text)return null;
   const pg=currentPage();
   const existing=highlights.find(h=>h.courseId===course.id&&h.pageId===pg.id&&h.text===selection.text);
   if(existing)return existing.id;
   const h={id:uid(),courseId:course.id,pageId:pg.id,page:pg.n,text:selection.text,rects:selection.rects||[],context:selection.context||selection.text,color:selection.color||"#ffe66d99",created:Date.now()};
   setHighlights(x=>[...x,h]);
   return h.id;
 }

 function eraseHighlight(id){
 if(!id)return;
 setHighlights(x=>x.filter(h=>h.id!==id));
 setCards(x=>x.filter(c=>c.highlightId!==id));
 setSel(current=>current?.highlightId===id?null:current);
 setSuggestions([]);
}

 function makeSuggestions(selection){
   const text=selection.text.trim();
   const ctx=selection.context?.trim()||text;
   const safeText=text.replace(/\s+/g," ").slice(0,180);
   const clozeContext=ctx.includes(text)?ctx.replace(text,"{{"+text+"}}"):("Retrouve l’information manquante : {{"+text+"}}");
   setSuggestions([
     {type:"basic",icon:"❓",title:"Question → réponse",front:"Que faut-il retenir concernant « "+safeText+" » ?",back:text},
     {type:"cloze",icon:"🧩",title:"Texte à trous",front:clozeContext,back:text},
     {type:"concept",icon:"💡",title:"Concept → définition",front:"Qu’est-ce que « "+safeText+" » ?",back:text}
   ]);
 }

 function onSelection(selection){
   if(!selection?.text)return;
   const hId=selection.highlightId||addHighlight(selection);
   const next={...selection,highlightId:hId};
   setSel(next);
   makeSuggestions(next);
 }

 async function openCreator(selection=sel){
   if(!selection)return;
   const hId=selection.highlightId||addHighlight(selection);
   const first=(suggestions[0])||{type:"basic",front:"Que faut-il retenir ?",back:selection.text};
   setDraft({...first,highlightId:hId,source:selection.text,page:pageNumber,aiGenerating:true,aiError:""});
   setModal(true);
   try{
    const data=await callRMedAI({action:"flashcard",text:selection.text,context:selection.context||selection.text});
    if(data?.front&&data?.back){
      setDraft(d=>d?{...d,type:data.type||"basic",front:data.front,back:data.back,aiGenerating:false,aiError:""}:d);
    }else throw new Error("Réponse IA incomplète.");
   }catch(err){
    setDraft(d=>d?{...d,aiGenerating:false,aiError:err?.message||"IA indisponible"}:d);
   }
 }

 function applySuggestion(s){
   setDraft({...s,highlightId:sel?.highlightId||addHighlight(sel),source:sel?.text||s.back,page:pageNumber,aiGenerating:false,aiError:""});
   setModal(true);
 }

 function saveCard(){
   if(!draft?.front?.trim()||!draft?.back?.trim())return;
   if(draft.editingId){
    setCards(x=>x.map(c=>c.id===draft.editingId?{...c,front:draft.front.trim(),back:draft.back.trim(),type:draft.type||c.type||"basic"}:c));
   }else{
    const hId=draft.highlightId;
    setCards(x=>[...x,{
     id:uid(),courseId:course.id,pageId:currentPage().id,page:pageNumber,highlightId:hId,
     source:draft.source||draft.back,type:draft.type||"basic",front:draft.front.trim(),back:draft.back.trim(),
     level:null,next:Date.now(),created:Date.now()
    }]);
   }
   setModal(false);setDraft(null);setSuggestions([]);setSel(null);
 }

 function deleteCard(id){setCards(x=>x.filter(c=>c.id!==id))}
 function editCard(c){
   setDraft({editingId:c.id,type:c.type||"basic",front:c.front,back:c.back,source:c.source||"",page:c.page,highlightId:c.highlightId});
   setSuggestions([]);
   setModal(true);
 }
 function rate(level){
   if(!rc)return;
   const mins=levels.find(x=>x[0]===level)[3];
   setCards(x=>x.map(c=>c.id===rc.id?{...c,level,next:Date.now()+mins*60000,last:Date.now()}:c));
   setHistory(x=>[{id:uid(),card:rc.front,level,date:Date.now()},...x]);
   setRevealed(false);setRi(i=>i+1);
 }

 async function openCardSource(c){
   const co=courses.find(x=>x.id===c.courseId);if(!co)return;
   await open(co,c.page,c.highlightId);
   requestAnimationFrame(()=>document.querySelector(".pdf-reader")?.scrollIntoView({behavior:"smooth",block:"center"}));
 }

 return <div className="app">
  <aside>
   <div className="logo">R</div><h2>RMed</h2><small>PASS • révision active</small>
   <Nav icon={<HomeIcon/>} t="Accueil" a={tab==="home"} f={()=>nav("home")}/>
   <Nav icon={<BookOpen/>} t="Cours" a={tab==="course"} f={()=>nav("course")}/>
   <Nav icon={<Brain/>} t="Flashcards" a={tab==="cards"} f={()=>nav("cards")}/>
   <Nav icon={<Target/>} t="Réviser" a={tab==="review"} f={()=>nav("review")}/>
   <Nav icon={<ListChecks/>} t="QCM" a={tab==="qcm"} f={()=>nav("qcm")}/>
   <Nav icon={<Sparkles/>} t="Assistant IA" a={tab==="ai"} f={()=>nav("ai")}/>
   <Nav icon={<History/>} t="Historique" a={tab==="history"} f={()=>nav("history")}/>
   <button className="dog" onClick={()=>nav("ai")} title="Ouvrir l’assistant IA">🐶<span>Parler à RMed</span></button>
  </aside>

  <main>
   <header><b className="mobile">RMed</b><div className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…"/></div><div className="avatar">R</div></header>

   {tab==="home"&&<Home cards={cards} due={due.length} courses={courses} nav={nav} open={open}/>}
   {tab==="course"&&<Course openUpload={()=>setUploadOpen(true)} course={course} pageNumber={pageNumber} setPageNumber={setPageNumber} pdfDoc={pdfDoc} pdfNativeUrl={pdfNativeUrl} pdfLoading={pdfLoading} pdfError={pdfError} zoom={zoom} setZoom={setZoom} sel={sel} suggestions={suggestions} onSelection={onSelection} openCreator={openCreator} applySuggestion={applySuggestion} pdfLocked={pdfLocked} setPdfLocked={setPdfLocked} highlights={highlights.filter(h=>h.courseId===course.id&&h.page===pageNumber)} focusHighlightId={focusHighlightId} clearFocus={()=>setFocusHighlightId(null)} importPdf={file=>addPdf(file,activeFolderId)} courses={courses} folders={folders} activeFolderId={activeFolderId} setActiveFolderId={setActiveFolderId} onCreateFolder={createFolder} open={open} onEraseHighlight={eraseHighlight} onAskAI={()=>setAiOpen(true)} onReviewCourse={()=>navReview("course",course.id)} onReviewFolder={()=>activeFolderId&&navReview("folder",activeFolderId)} onMoveCourse={()=>setMoveCourseId(course.id)} onCreateBatch={()=>createBatchFlashcards(course)} batchBusy={batchBusy}/>}
   {tab==="cards"&&<Cards cards={cards} search={search} open={openCardSource} del={deleteCard} edit={editCard} courses={courses} folders={folders} onReviewCourse={id=>navReview("course",id)}/>}
   {tab==="review"&&<Review rc={rc} revealed={revealed} setRevealed={setRevealed} rate={rate} total={due.length} i={ri} courses={courses} folders={folders} course={course} activeFolderId={activeFolderId} scope={reviewScope} setScope={s=>{setReviewScope(s);setRi(0);setRevealed(false)}} onReviewAll={()=>navReview("all",null)}/>} 
   {tab==="qcm"&&<QCM courses={courses} course={course} cards={cards} qcm={qcm} setQcm={setQcm}/>}
   {tab==="ai"&&<AIChat courses={courses} course={course} selection={sel}/>}
   {tab==="history"&&<HistoryPage h={history}/>}
  </main>

  {uploadOpen&&<UploadModal onClose={()=>setUploadOpen(false)} onFile={file=>addPdf(file,activeFolderId)}/>}
  {batchCreated&&<FlashcardBatchModal data={batchCreated} onClose={()=>setBatchCreated(null)} onOpenCards={()=>{setBatchCreated(null);nav("cards")}}/>}
  {moveCourseId&&<MoveCourseModal course={courses.find(c=>c.id===moveCourseId)||course} folders={folders} onMove={moveCurrentCourse} onClose={()=>setMoveCourseId(null)}/>}
  {aiOpen&&<AIAssistant selection={sel} courses={courses} course={course} onClose={()=>setAiOpen(false)}/>} 
  {modal&&<CardModal draft={draft} setDraft={setDraft} suggestions={suggestions} onUse={applySuggestion} onClose={()=>{setModal(false);setDraft(null)}} onSave={saveCard}/>}
 </div>
}

function Nav({icon,t,a,f}){return <button className={a?"nav active":"nav"} onClick={f}>{icon}<span>{t}</span></button>}
function Home({cards,due,courses,nav,open}){return <div className="page"><section className="hero"><div><small>TON ESPACE DE RÉVISION</small><h1>Travaille ton cours au moment où tu le lis.</h1><p>Surligne → crée ta flashcard → garde le lien vers le passage exact → révise.</p><button className="primary" onClick={()=>nav("course")}>Ouvrir un cours <ChevronRight/></button></div><div className="bigdog">🐶</div></section><div className="stats"><Stat n={courses.length} t="Cours"/><Stat n={cards.length} t="Flashcards"/><Stat n={due} t="À réviser"/><Stat n={cards.filter(c=>c.level==="perfect"||c.level==="good").length} t="Bien acquis"/></div><div className="grid"><section className="panel"><h3>Continuer</h3>{courses.map(c=><button className="course" key={c.id} onClick={()=>open(c)}><FileText/><div><b>{c.title}</b><small>{c.pages.length} page(s){c.kind==="pdf"?" • PDF réel":""}</small></div><ChevronRight/></button>)}</section><section className="panel"><h3>Actions rapides</h3><div className="quick"><button onClick={()=>nav("review")}><Brain/>Réviser</button><button onClick={()=>nav("qcm")}><ListChecks/>Faire un QCM</button><button onClick={()=>nav("cards")}><Target/>Mes flashcards</button></div></section></div></div>}
function Stat({n,t}){return <div className="stat"><strong>{n}</strong><span>{t}</span></div>}

function Course({course,pageNumber,setPageNumber,pdfDoc,pdfNativeUrl,pdfLoading,pdfError,zoom,setZoom,sel,suggestions,onSelection,openCreator,applySuggestion,pdfLocked,setPdfLocked,highlights,focusHighlightId,clearFocus,importPdf,courses,folders,activeFolderId,setActiveFolderId,onCreateFolder,open,openUpload,onEraseHighlight,onAskAI,onReviewCourse,onReviewFolder,onMoveCourse,onCreateBatch,batchBusy}){
 const pg=course.pages.find(x=>x.n===pageNumber)||course.pages[0];
 const[markColor,setMarkColor]=useState("#ffe66d99");
 const[markTool,setMarkTool]=useState("highlight");
 const prev=()=>setPageNumber(Math.max(1,pageNumber-1));
 const next=()=>setPageNumber(Math.min(course.pages.length,pageNumber+1));
 const currentFolder=folders.find(f=>f.id===activeFolderId)||null;
 const visibleFolders=folders.filter(f=>(f.parentId||null)===(activeFolderId||null));
 const visibleCourses=courses.filter(c=>(c.folderId||null)===(activeFolderId||null));
 const breadcrumbs=[];
 let cursor=currentFolder;
 while(cursor){
  breadcrumbs.unshift(cursor);
  cursor=folders.find(f=>f.id===cursor.parentId)||null;
 }
 function createNamedFolder(){
  const name=window.prompt(activeFolderId?"Nom du sous-dossier":"Nom du dossier");
  if(name?.trim())onCreateFolder?.(name,activeFolderId);
 }
 function goRoot(){
  setActiveFolderId?.(null);
 }
 function openFolder(id){
  setActiveFolderId?.(id);
  setPageNumber(1);
 }
 return <div className="page"><div className="title"><div><small>LECTEUR DE COURS</small><h1>{course.title}</h1></div><div className="title-actions">
 <button className="secondary-action" onClick={onMoveCourse} disabled={!course?.id}><Folder size={16}/> Ranger</button>
 <button className="secondary-action" onClick={onReviewCourse} disabled={!course?.id}><Brain size={16}/> Réviser ce cours</button>
 <button className="primary ai-create-course" onClick={onCreateBatch} disabled={batchBusy||!course?.id}><Sparkles size={16}/>{batchBusy?"Création…":"Créer 8 flashcards avec ce cours"}</button>
 <button className="upload" onClick={()=>openUpload?.()}><Upload/>Importer un PDF</button>
</div></div>

 <section className="library-browser panel">
  <div className="library-browser-head">
   <div>
    <small className="eyebrow">MA BIBLIOTHÈQUE</small>
    <b>{currentFolder?.name||"Tous les cours"}</b>
   </div>
   <div className="library-browser-actions">
    {activeFolderId&&<button onClick={goRoot} title="Retourner à la racine"><ArrowLeft size={15}/> Racine</button>}
    <button onClick={createNamedFolder}><FolderPlus size={15}/> {activeFolderId?"Sous-dossier":"Nouveau dossier"}</button>
{activeFolderId&&<button className="review-folder-action" onClick={onReviewFolder}><Brain size={15}/> Réviser ce dossier</button>}
    <button className="primary" onClick={()=>openUpload?.()}><Upload size={15}/> Ajouter un PDF</button>
   </div>
  </div>
  <div className="library-breadcrumbs">
   <button onClick={goRoot} className={!activeFolderId?"current":""}>Tous les cours</button>
   {breadcrumbs.map((f,i)=><React.Fragment key={f.id}><span>/</span><button onClick={()=>setActiveFolderId?.(f.id)} className={i===breadcrumbs.length-1?"current":""}>{f.name}</button></React.Fragment>)}
  </div>

  {visibleFolders.length>0&&<div className="library-section">
   <div className="library-section-title"><Folder size={16}/> Dossiers</div>
   <div className="folder-grid">{visibleFolders.map(f=>{
    const count=courses.filter(c=>(c.folderId||null)===f.id).length;
    const childCount=folders.filter(x=>(x.parentId||null)===f.id).length;
    return <button className="folder-card" key={f.id} onClick={()=>openFolder(f.id)}>
      <div className="folder-icon"><Folder/></div>
      <div><b>{f.name}</b><small>{count} cours • {childCount} sous-dossier(s)</small></div>
      <ChevronRight size={17}/>
    </button>
   })}</div>
  </div>}

  <div className="library-section">
   <div className="library-section-title"><FileText size={16}/> {visibleCourses.length?"Cours dans ce dossier":"Cours"}</div>
   {visibleCourses.length?<div className="course-grid">{visibleCourses.map(c=>
    <div className={"course-file "+(c.id===course.id?"selected":"")} key={c.id}>
      <button className="course-file-main" onClick={()=>open(c)}>
        <div className="course-file-icon"><FileText/></div>
        <div className="course-file-body"><b>{c.title}</b><small>{c.pages.length} page(s){c.kind==="pdf"?" • PDF":" • Démo"}</small></div>
        <ChevronRight size={17}/>
      </button>
    </div>
   )}</div>:<div className="library-empty">Aucun cours ici. Ajoute un PDF ou crée un dossier.</div>}
  </div>
 </section>

 <div className="reader split-reader">
  <aside className="notes-pane">
   <div className="notes-head"><div><small>NOTES & FLASHCARDS</small><b>{course.title}</b></div><span>{highlights.length} surlignage(s)</span></div>
   <div className="notes-list">{highlights.length?highlights.map(h=><div className="note-card" key={h.id}><div className="marker"></div><p>« {h.text} »</p><button className="note-create-card" onClick={()=>openCreator({text:h.text,rects:h.rects,context:h.context,highlightId:h.id})}><Sparkles size={13}/> Créer la flashcard avec l’IA</button></div>):<div className="notes-empty"><Highlighter/><p>Surligne un élément important dans le PDF.<br/>Tes passages apparaîtront ici.</p></div>}</div>
  </aside>
  <section className="pdf-reader">
   <div className="pdf-toolbar"><button className={"tool-label "+(pdfLocked?"locked":"")} onClick={()=>setPdfLocked(v=>!v)} title={pdfLocked?"Déverrouiller le déplacement du PDF":"Verrouiller le déplacement du PDF"}>{pdfLocked?<Lock/>:<Unlock/>}<span>{pdfLocked?"PDF verrouillé":"Verrouiller PDF"}</span></button><button onClick={prev} disabled={pageNumber<=1}><ChevronLeft/></button><span>Page <b>{pageNumber}</b> / {course.pages.length}</span><button onClick={next} disabled={pageNumber>=course.pages.length}><ChevronRight/></button><button className="ai-toolbar-button" onClick={onAskAI} title="Ouvrir RMed IA"><Sparkles size={16}/><span>Assistant IA</span></button><button className="external-reader-button" onClick={()=>window.open(window.location.pathname+"?reader="+encodeURIComponent(course.id)+"&page="+pageNumber,"_blank")} title="Ouvrir le PDF dans le lecteur externe"><ExternalLink size={16}/><span>Lecteur PDF</span></button><AnnotationPalette color={markColor} tool={markTool} setColor={setMarkColor} setTool={setMarkTool}/><span className="spacer"/><button onClick={()=>setZoom(z=>Math.max(.75,z-.1))}><Minus/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(2.5,z+.1))}><Plus/></button></div>
   {pdfLoading&&<div className="pdf-state">Ouverture du PDF…</div>}
   {pdfError&&<div className="pdf-state pdf-error"><b>Impossible d’ouvrir ce PDF</b><br/>{pdfError}<br/><button className="primary" onClick={openUpload}>Réimporter le PDF</button></div>}
   {!pdfLoading&&!pdfError ? (course.kind==="pdf" ? (pdfNativeUrl&&isAppleMobile() ? <iframe className="native-pdf" title="PDF" src={pdfNativeUrl}/> : pdfDoc ? <PDFPage courseId={course.id} pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} highlights={highlights} focusHighlightId={focusHighlightId} clearFocus={clearFocus} onSelection={onSelection} locked={pdfLocked} markTool={markTool} markColor={markColor} onEraseHighlight={onEraseHighlight}/> : <div className="pdf-state">Préparation du PDF…</div>) : course.kind==="demo" ? <DemoPage pg={pg} onSelection={onSelection}/> : <div className="pdf-state">PDF indisponible. Réimporte-le pour continuer.</div>) : null}
   {sel&&<SelectionBar sel={sel} suggestions={suggestions} onHighlight={()=>{}} onCreate={()=>openCreator(sel)} onUse={applySuggestion} onAskAI={onAskAI}/>}
  </section>
 </div></div>
}

function DemoPage({pg,onSelection}){
 const ref=useRef(null);
 function getSelection(){
  const s=window.getSelection();if(!s||s.isCollapsed)return;
  const t=s.toString().trim();if(!t||!ref.current.contains(s.anchorNode))return;
  onSelection({text:t,rects:[],context:pg.text});
  s.removeAllRanges();
 }
 return <div className="demo-paper" ref={ref} onMouseUp={getSelection} onTouchEnd={getSelection}><small>PAGE {pg.n}</small><p>{pg.text}</p><p className="hint">Sélectionne un passage comme dans un vrai PDF pour créer une carte.</p></div>
}

function PDFPage({courseId,pdfDoc,pageNumber,scale,highlights,focusHighlightId,clearFocus,onSelection,locked,markTool,markColor,onPinchZoom,onEraseHighlight}){
 const pageRef=useRef(null),canvasRef=useRef(null),textRef=useRef(null),contextRef=useRef("");
 const penRef=useRef({active:false,points:[],pointerId:null,scrollLeft:0,scrollTop:0,stage:null,start:null,mode:"highlight",color:"#ffe66d99",raf:null});
 const touchRef=useRef(new Map());
 const panRef=useRef({active:false,lastX:0,lastY:0});
 const pinchRef=useRef({active:false,startDistance:0,startScale:scale});
 const[height,setHeight]=useState(800);
 const[penTrace,setPenTrace]=useState([]);
 const[tempRects,setTempRects]=useState([]);
 const[drawings,setDrawings]=useState(()=>load("rmed_drawings_"+courseId+"_"+pageNumber,[]));
 const drawKey="rmed_drawings_"+courseId+"_"+pageNumber;

 useEffect(()=>{setDrawings(load(drawKey,[]));},[drawKey]);
 useEffect(()=>{save(drawKey,drawings);},[drawKey,drawings]);

 useEffect(()=>{
  let cancelled=false;
  async function render(){
   try{
    const pdfjsLib=await getPdfjs();
    const page=await pdfDoc.getPage(pageNumber);
    const viewport=page.getViewport({scale});
    const dpr=window.devicePixelRatio||1;
    const canvas=canvasRef.current;if(!canvas)return;
    canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
    canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";
    const ctx=canvas.getContext("2d");
    await page.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
    if(cancelled)return;
    setHeight(viewport.height);
    const text=await page.getTextContent();
    if(cancelled)return;
    contextRef.current=text.items.map(i=>i.str).join(" ");
    const layer=textRef.current;if(!layer)return;
    layer.innerHTML="";
    layer.classList.add("textLayer");
    layer.style.setProperty("--scale-factor",viewport.scale);
    const textDivs=[];
    const textTask=pdfjsLib.renderTextLayer({textContentSource:text,container:layer,viewport,textDivs});
    await textTask.promise;
    if(cancelled)return;
    layer.querySelectorAll("span").forEach(span=>span.classList.add("pdf-word"));
    requestAnimationFrame(()=>{
     if(focusHighlightId){
      const el=document.getElementById("hl-"+focusHighlightId);
      el?.scrollIntoView({behavior:"smooth",block:"center"});
      clearFocus();
     }
    });
   }catch(err){console.error("PDF render error",err)}
  }
  render();
  return()=>{
   cancelled=true;
   const p=penRef.current;
   if(p.raf)cancelAnimationFrame(p.raf);
   p.active=false;
   setPenTrace([]);
   setTempRects([]);
  };
 },[pdfDoc,pageNumber,scale]);

 function pointInsidePdf(clientX,clientY){
  const root=pageRef.current?.getBoundingClientRect();
  if(!root)return null;
  return {x:clientX-root.left,y:clientY-root.top,root};
 }

 function getSpanAtClientPoint(clientX,clientY){
  const els=document.elementsFromPoint?.(clientX,clientY)||[];
  const span=els.find(el=>el.classList?.contains("pdf-word"));
  if(span)return span;
  const range=document.caretRangeFromPoint?.(clientX,clientY);
  const node=range?.startContainer;
  return node?.parentElement?.closest?.(".pdf-word")||null;
 }

 function getCaretAtPoint(clientX,clientY){
  try{
   const direct=document.caretRangeFromPoint?.(clientX,clientY);
   if(direct)return direct;
   const pos=document.caretPositionFromPoint?.(clientX,clientY);
   if(pos){
    const r=document.createRange();
    r.setStart(pos.offsetNode,pos.offset);
    r.collapse(true);
    return r;
   }
  }catch{}
  return null;
 }

 function caretOffsetInSpan(span,range){
  if(!span||!range)return 0;
  try{
   const endNode=range.startContainer;
   const endOffset=range.startOffset;
   if(endNode===span.firstChild&&endNode?.nodeType===3)return Math.max(0,Math.min(endNode.textContent?.length||0,endOffset));
   const probe=document.createRange();
   probe.selectNodeContents(span);
   probe.setEnd(endNode,endOffset);
   return probe.toString().length;
  }catch{return 0}
 }

 function getPointInfo(clientX,clientY){
  const caret=getCaretAtPoint(clientX,clientY);
  const span=getSpanAtClientPoint(clientX,clientY);
  const children=[...textRef.current?.children||[]];
  const index=span?children.indexOf(span):-1;
  const offset=caret&&span?caretOffsetInSpan(span,caret):0;
  return {caret,span,index,offset};
 }

 function buildPencilRange(start,end){
  if(!textRef.current||!start||!end)return null;
  const a=getPointInfo(start.clientX,start.clientY);
  const b=getPointInfo(end.clientX,end.clientY);
  if(!a.span&&!b.span)return null;

  let forward=true;
  if(a.index>=0&&b.index>=0){
   if(a.index>b.index)forward=false;
   else if(a.index===b.index&&a.offset>b.offset)forward=false;
  }

  const range=document.createRange();
  try{
   const first=forward?a:b;
   const last=forward?b:a;
   if(first.caret&&last.caret){
    range.setStart(first.caret.startContainer,first.caret.startOffset);
    range.setEnd(last.caret.startContainer,last.caret.startOffset);
    if(!range.collapsed&&range.toString().trim())return range;
   }
  }catch{}

  if(a.index>=0&&b.index>=0){
   const children=[...textRef.current.children];
   const first=forward?a:b;
   const last=forward?b:a;
   const from=children[first.index],to=children[last.index];
   if(from&&to){
    try{
     const fromNode=from.firstChild||from;
     const toNode=to.firstChild||to;
     const toLen=to.textContent?.length||0;
     range.setStart(fromNode,0);
     range.setEnd(toNode,toLen);
     if(!range.collapsed&&range.toString().trim())return range;
    }catch{}
   }
  }
  return null;
 }

 function rectsFromRange(range){
  const root=pageRef.current?.getBoundingClientRect();
  if(!root||!range)return [];
  const direct=[...range.getClientRects()]
    .map(r=>({x:r.left-root.left,y:r.top-root.top,width:r.width,height:r.height}))
    .filter(r=>r.width>1&&r.height>3);
  if(direct.length)return direct;
  const words=[...textRef.current?.children||[]];
  return words.flatMap(word=>{
    try{
      if(!range.intersectsNode(word))return [];
      const r=word.getBoundingClientRect();
      return r.width>1&&r.height>3?[{x:r.left-root.left,y:r.top-root.top,width:r.width,height:r.height}]:[];
    }catch{return []}
  });
 }

 function updateLiveHighlight(){
  const p=penRef.current;
  if(!p.start||!p.points.length)return;
  const last=p.points[p.points.length-1];
  const root=pageRef.current?.getBoundingClientRect();
  if(!root)return;
  const end={clientX:last.x+root.left,clientY:last.y+root.top};
  const range=buildPencilRange(p.start,end);
  if(range){
   setTempRects(rectsFromRange(range));
   const txt=range.toString().replace(/\s+/g," ").trim();
   p.liveText=txt;
   p.liveRects=rectsFromRange(range);
  }else{
   setTempRects([]);
   p.liveText="";
   p.liveRects=[];
  }
 }

 function updateDrawVisual(e){
  const p=penRef.current;
  const local=pointInsidePdf(e.clientX,e.clientY);
  if(!local)return;
  p.points.push({x:local.x,y:local.y});
  setPenTrace(p.points.slice(-180));
 }

 function freezeScroll(p){
  if(!p.stage)return;
  const lock=()=>{
   if(!p.active)return;
   if(p.stage.scrollLeft!==p.scrollLeft)p.stage.scrollLeft=p.scrollLeft;
   if(p.stage.scrollTop!==p.scrollTop)p.stage.scrollTop=p.scrollTop;
   p.raf=requestAnimationFrame(lock);
  };
  p.raf=requestAnimationFrame(lock);
 }

 function penDown(e){
  if(e.pointerType!=="pen")return;
  if(!pageRef.current?.contains(e.target))return;
  e.preventDefault();
  e.stopPropagation();
  const local=pointInsidePdf(e.clientX,e.clientY);
  if(!local)return;
  const stage=pageRef.current?.parentElement;
  const p=penRef.current;
  if(p.active&&p.pointerId===e.pointerId)return;
  if(p.raf)cancelAnimationFrame(p.raf);
  penRef.current={
   active:true,
   points:[{x:local.x,y:local.y}],
   pointerId:e.pointerId,
   scrollLeft:stage?.scrollLeft||0,
   scrollTop:stage?.scrollTop||0,
   stage,
   start:{clientX:e.clientX,clientY:e.clientY},
   mode:markTool,
   color:markColor,
   liveText:"",
   liveRects:[],
   raf:null
  };
  if(stage){
   stage.classList.add("pencil-active");
   stage.scrollLeft=penRef.current.scrollLeft;
   stage.scrollTop=penRef.current.scrollTop;
  }
  pageRef.current?.setPointerCapture?.(e.pointerId);
  freezeScroll(penRef.current);
  if(markTool==="highlight")updateLiveHighlight();
  else if(markTool==="pen")updateDrawVisual(e);
  else if(markTool==="eraser")eraseAt(e);
 }

 function penMove(e){
  const p=penRef.current;
  if(!p.active||e.pointerType!=="pen"||e.pointerId!==p.pointerId)return;
  e.preventDefault();
  e.stopPropagation();
  if(p.stage){p.stage.scrollLeft=p.scrollLeft;p.stage.scrollTop=p.scrollTop;}
  const local=pointInsidePdf(e.clientX,e.clientY);
  if(local)p.points.push({x:local.x,y:local.y});
  if(p.mode==="highlight")updateLiveHighlight();
  else if(p.mode==="pen")setPenTrace(p.points.slice(-180));
  else if(p.mode==="eraser")eraseAt(e);
 }

 function penUp(e){
  const p=penRef.current;
  if(!p.active||e.pointerType!=="pen"||e.pointerId!==p.pointerId)return;
  e.preventDefault();
  e.stopPropagation();
  p.active=false;
  if(p.raf)cancelAnimationFrame(p.raf);
  if(p.stage){
   p.stage.classList.remove("pencil-active");
   p.stage.scrollLeft=p.scrollLeft;
   p.stage.scrollTop=p.scrollTop;
  }
  try{pageRef.current?.releasePointerCapture?.(p.pointerId)}catch{}
  if(p.mode==="pen"&&p.points.length>1){
   setDrawings(x=>[...x,{id:uid(),points:p.points.slice(),color:p.color,width:5}]);
  }
  setTempRects([]);
  setPenTrace([]);
  if(p.mode!=="highlight")return;

  const root=pageRef.current?.getBoundingClientRect();
  if(!root||!p.start)return;
  const end={clientX:e.clientX,clientY:e.clientY};
  const range=buildPencilRange(p.start,end);
  const text=(range?.toString()||p.liveText||"").replace(/\s+/g," ").trim();
  const rects=range?rectsFromRange(range):(p.liveRects||[]);
  if(!text)return;
  onSelection({text,rects,context:contextRef.current,autoHighlight:true,color:p.color});
 }

 useEffect(()=>{
  const down=e=>penDown(e);
  const move=e=>penMove(e);
  const up=e=>penUp(e);
  document.addEventListener("pointerdown",down,true);
  document.addEventListener("pointermove",move,true);
  document.addEventListener("pointerup",up,true);
  document.addEventListener("pointercancel",up,true);
  return()=>{
   document.removeEventListener("pointerdown",down,true);
   document.removeEventListener("pointermove",move,true);
   document.removeEventListener("pointerup",up,true);
   document.removeEventListener("pointercancel",up,true);
  };
 });

 function pointDistanceToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  if(dx===0&&dy===0)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
 }

 function eraseAt(e){
  const root=pageRef.current?.getBoundingClientRect();if(!root)return;
  const x=e.clientX-root.left,y=e.clientY-root.top;
  setDrawings(prev=>prev.filter(d=>{
   for(let i=1;i<d.points.length;i++){
    const a=d.points[i-1],b=d.points[i];
    if(pointDistanceToSegment(x,y,a.x,a.y,b.x,b.y)<22)return false;
   }
   return true;
  }));
  const hit=highlights.find(h=>(h.rects||[]).some(r=>x>=r.x-18&&x<=r.x+r.width+18&&y>=r.y-18&&y<=r.y+r.height+18));
  if(hit)onEraseHighlight?.(hit.id);
 }

 function touchStart(e){
  if(e.touches.length===2){
   e.preventDefault();
   const a=e.touches[0],b=e.touches[1];
   const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY;
   const distance=Math.hypot(dx,dy);
   pinchRef.current={active:!!onPinchZoom,startDistance:distance,startScale:scale};
   panRef.current={active:true,lastX:(a.clientX+b.clientX)/2,lastY:(a.clientY+b.clientY)/2};
  }else{
   panRef.current.active=false;
   pinchRef.current.active=false;
  }
 }

 function touchMoveNative(e){
  if(e.touches.length!==2)return;
  e.preventDefault();
  const a=e.touches[0],b=e.touches[1];
  const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY;
  const distance=Math.hypot(dx,dy);
  if(onPinchZoom&&pinchRef.current.active&&pinchRef.current.startDistance>1){
   const next=Math.max(.75,Math.min(3,pinchRef.current.startScale*(distance/pinchRef.current.startDistance)));
   onPinchZoom(next);
   return;
  }
  const cx=(a.clientX+b.clientX)/2,cy=(a.clientY+b.clientY)/2;
  const stage=pageRef.current?.parentElement;
  if(stage&&panRef.current.active){
   stage.scrollLeft-=cx-panRef.current.lastX;
   stage.scrollTop-=cy-panRef.current.lastY;
  }
  panRef.current.lastX=cx;panRef.current.lastY=cy;
 }

 function touchEnd(){
  const wasGesture=panRef.current.active;
  panRef.current.active=false;
  pinchRef.current.active=false;
  if(!wasGesture&&!penRef.current.active)window.setTimeout(select,60);
 }

 function select(){
  if(penRef.current.active||touchRef.current.size)return;
  const s=window.getSelection();if(!s||s.isCollapsed||!textRef.current)return;
  if(!textRef.current.contains(s.anchorNode))return;
  const t=s.toString().trim();if(!t)return;
  const root=pageRef.current.getBoundingClientRect();
  const rects=Array.from(s.getRangeAt(0).getClientRects()).map(r=>({x:r.left-root.left,y:r.top-root.top,width:r.width,height:r.height})).filter(r=>r.width>1&&r.height>1);
  onSelection({text:t,rects,context:contextRef.current});
  s.removeAllRanges();
 }

 return <div className={"pdf-stage "+(locked?"pdf-stage-locked":"")} onTouchStart={touchStart} onTouchMove={touchMoveNative} onTouchEnd={touchEnd} onTouchCancel={touchEnd}>
  <div className="pdf-page" ref={pageRef} style={{height}} onMouseUp={select}>
   <canvas ref={canvasRef}/>
   <div className="pdf-highlights">
    {drawings.length>0&&<svg className="drawings-layer" viewBox={"0 0 "+Math.max(1,pageRef.current?.clientWidth||1)+" "+Math.max(1,pageRef.current?.clientHeight||1)} preserveAspectRatio="none">{drawings.map(d=><polyline key={d.id} points={d.points.map(p=>p.x+","+p.y).join(" ")} fill="none" stroke={d.color} strokeWidth={d.width||5} strokeLinecap="round" strokeLinejoin="round"/>)}</svg>}
    {penTrace.length>1&&<svg className="pen-trace" viewBox={"0 0 "+Math.max(1,pageRef.current?.clientWidth||1)+" "+Math.max(1,pageRef.current?.clientHeight||1)} preserveAspectRatio="none"><polyline points={penTrace.map(p=>p.x+","+p.y).join(" ")} fill="none" stroke={markColor} strokeWidth={markTool==="pen"?5:14} strokeLinecap="round" strokeLinejoin="round"/></svg>}
    {tempRects.length>0&&<div className="highlight-group live-highlight">{tempRects.map((r,i)=><span key={"t"+i} style={{left:r.x,top:r.y,width:r.width,height:r.height,background:markColor}}/> )}</div>}
    {highlights.map(h=><div key={h.id} id={"hl-"+h.id} className="highlight-group" onClick={()=>onSelection({text:h.text,rects:h.rects,context:h.context,highlightId:h.id})}>{h.rects.map((r,i)=><span key={i} style={{left:r.x,top:r.y,width:r.width,height:r.height,background:h.color||"#ffe66d99"}}/> )}</div>)}
   </div>
   <div className="pdf-text" ref={textRef}/>
  </div>
 </div>
}

function ExternalPdfReader({courseId,initialPage=1}){
 const[courses]=useState(()=>load("rmed_courses",[demo]));
 const course=courses.find(c=>c.id===courseId);
 const[pageNumber,setPageNumber]=useState(Math.max(1,initialPage));
 const[pdfDoc,setPdfDoc]=useState(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState("");
 const[zoom,setZoom]=useState(1.25);
 const[highlights,setHighlights]=useState(()=>load("rmed_highlights",[]));
 const[sel,setSel]=useState(null);
 const[markColor,setMarkColor]=useState("#ffe66d99");
 const[markTool,setMarkTool]=useState("highlight");
 const[locked,setLocked]=useState(false);

 useEffect(()=>save("rmed_highlights",highlights),[highlights]);

 useEffect(()=>{
  let cancelled=false;
  async function open(){
   if(!course){setError("Cours introuvable.");setLoading(false);return}
   try{
    const data=await getPdf(course.id);
    if(!data)throw new Error("PDF introuvable dans le stockage de cet appareil.");
    const doc=await openPdfDocument(data);
    if(cancelled)return;
    setPdfDoc(doc);
    if(!course.pages?.length){
      const pages=Array.from({length:doc.numPages},(_,i)=>({id:course.id+"-p"+(i+1),n:i+1}));
      const updatedCourses=courses.map(c=>c.id===course.id?{...c,pages}:c);
      save("rmed_courses",updatedCourses);
    }
    setPageNumber(p=>Math.min(Math.max(1,p),doc.numPages));
   }catch(err){
    if(!cancelled)setError(err?.message||"Impossible d’ouvrir le PDF.");
   }finally{
    if(!cancelled)setLoading(false);
   }
  }
  open();
  return()=>{cancelled=true};
 },[course?.id]);

 useEffect(()=>{
  const bc=typeof BroadcastChannel!=="undefined"?new BroadcastChannel("rmed-highlights"):null;
  const onStorage=e=>{if(e.key==="rmed_highlights"&&e.newValue){try{setHighlights(JSON.parse(e.newValue))}catch{}}};
  window.addEventListener("storage",onStorage);
  return()=>{window.removeEventListener("storage",onStorage);bc?.close()};
 },[]);

 function eraseExternalHighlight(id){
  if(!id)return;
  setHighlights(x=>x.filter(h=>h.id!==id));
  setSel(current=>current?.highlightId===id?null:current);
 }
 function addExternalHighlight(selection){
  if(!selection?.text||!course)return;
  const pg=course.pages.find(x=>x.n===pageNumber)||{id:course.id+"-p"+pageNumber,n:pageNumber};
  const existing=highlights.find(h=>h.courseId===course.id&&h.pageId===pg.id&&h.text===selection.text);
  if(existing){setSel({...selection,highlightId:existing.id});return}
  const h={id:uid(),courseId:course.id,pageId:pg.id,page:pageNumber,text:selection.text,rects:selection.rects||[],context:selection.context||selection.text,color:selection.color||markColor,created:Date.now()};
  setHighlights(x=>[...x,h]);
  setSel({...selection,highlightId:h.id});
  try{new BroadcastChannel("rmed-highlights").postMessage(h)}catch{}
 }

 if(!course)return <div className="external-reader"><div className="external-reader-state">Cours introuvable.</div></div>;

 return <div className="external-reader">
  <div className="external-reader-toolbar">
   <button onClick={()=>window.close()} title="Fermer le lecteur"><ArrowLeft size={18}/><span>RMed</span></button>
   <div className="external-reader-title"><b>{course.title}</b><span>Page {pageNumber} / {pdfDoc?.numPages||course.pages.length||"…"}</span></div>
   <div className="external-reader-actions">
    <button onClick={()=>setPageNumber(p=>Math.max(1,p-1))} disabled={pageNumber<=1}><ChevronLeft/></button>
    <button onClick={()=>setPageNumber(p=>Math.min(pdfDoc?.numPages||course.pages.length,p+1))} disabled={pageNumber>=(pdfDoc?.numPages||course.pages.length)}><ChevronRight/></button>
    <button onClick={()=>setZoom(z=>Math.max(.75,z-.1))}><Minus/></button>
    <span>{Math.round(zoom*100)}%</span>
    <button onClick={()=>setZoom(z=>Math.min(3,z+.1))}><Plus/></button>
    <button className={locked?"locked":""} onClick={()=>setLocked(v=>!v)}>{locked?<Lock/>:<Unlock/>}</button>
    <AnnotationPalette color={markColor} tool={markTool} setColor={setMarkColor} setTool={setMarkTool}/>
   </div>
  </div>
  {loading&&<div className="external-reader-state">Ouverture du PDF…</div>}
  {error&&<div className="external-reader-state"><b>Impossible d’ouvrir le PDF</b><p>{error}</p></div>}
  {!loading&&!error&&pdfDoc&&<div className="external-reader-viewport">
    <div className="external-reader-page-wrap">
      <PDFPage courseId={course.id} pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} highlights={highlights.filter(h=>h.courseId===course.id&&h.page===pageNumber)} focusHighlightId={null} clearFocus={()=>{}} onSelection={addExternalHighlight} locked={locked} markTool={markTool} markColor={markColor} onPinchZoom={setZoom} onEraseHighlight={eraseExternalHighlight}/>
    </div>
  </div>}
  {sel&&<div className="external-selection">
    <div><Highlighter size={15}/><span>« {sel.text} »</span></div>
    <button onClick={()=>setSel(null)}>OK</button>
   </div>}
 </div>
}

function AnnotationPalette({color,tool,setColor,setTool}){
 const colors=[
  ["#ffe66d99","#FFD84D"],
  ["#ff9fb799","#FF6B9A"],
  ["#8fd8ff99","#39B8FF"],
  ["#9ee7b099","#42C878"],
  ["#ffc28a99","#FF9A3D"],
  ["#c7b5ff99","#8B6CFF"]
 ];
 const[open,setOpen]=useState(false);
 return <div className="annotation-tools">
  <button className={"annotation-tool "+(tool==="highlight"?"active":"")} title="Surligneur" onClick={()=>setTool("highlight")}><Highlighter size={16}/></button>
  <button className={"annotation-tool "+(tool==="pen"?"active":"")} title="Stylo / dessin" onClick={()=>setTool("pen")}><PenLine size={16}/></button>
  <button className={"annotation-tool "+(tool==="eraser"?"active":"")} title="Gomme" onClick={()=>setTool("eraser")}><Eraser size={16}/></button>
  <button className="annotation-palette-button" title="Palette de couleurs" onClick={()=>setOpen(v=>!v)}><span style={{background:color}}/><Palette size={15}/></button>
  {open&&<div className="annotation-palette">{colors.map(([rgba,solid])=><button key={rgba} className={color===rgba?"chosen":""} title="Choisir cette couleur de surlignage" onClick={()=>{setColor(rgba);setTool("highlight");setOpen(false)}}><span style={{background:solid}}/></button>)}</div>}
 </div>
}


function AIChat({courses,course,selection}){
 const[messages,setMessages]=useState(()=>load("rmed_ai_chat",[{
  role:"assistant",
  content:"Salut 👋 Je suis RMed. Je peux t’expliquer tes cours, retrouver une information dans tes ressources, créer des flashcards ou t’aider à préparer un QCM.",
  time:Date.now()
 }]));
 const[input,setInput]=useState("");
 const[scope,setScope]=useState("all");
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState("");
 const endRef=useRef(null);
 useEffect(()=>{save("rmed_ai_chat",messages.slice(-40));},[messages]);
 useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[messages,busy]);
 async function send(prefill=""){
  const q=(prefill||input).trim();
  if(!q||busy)return;
  setInput("");
  setError("");
  const user={role:"user",content:q,time:Date.now()};
  setMessages(x=>[...x,user]);
  setBusy(true);
  try{
   const context=await retrieveResourceContext(courses,{courseId:scope==="course"?course?.id:null,query:q,limit:18000,maxChunks:16});
   const conversation=messages.slice(-8).map(m=>(m.role==="user"?"Étudiant":"RMed")+": "+m.content).join("\n");
   const selectedText=selection?.text?"\n\nPASSAGE SÉLECTIONNÉ:\n"+selection.text:"";
   const data=await callRMedAI({
    action:"chat",
    text:q,
    context:"RESSOURCES DISPONIBLES:\n"+context+selectedText+"\n\nHISTORIQUE RÉCENT:\n"+conversation
   });
   setMessages(x=>[...x,{role:"assistant",content:data?.answer||"Je n’ai pas réussi à formuler une réponse.",time:Date.now()}]);
  }catch(err){
   const msg=err?.message||"Impossible de contacter RMed IA.";
   setError(msg);
   setMessages(x=>[...x,{role:"assistant",content:"Je n’ai pas pu répondre pour le moment. Vérifie la connexion IA puis réessaie.",time:Date.now(),error:true}]);
  }finally{setBusy(false)}
 }
 function clearChat(){
  setMessages([{role:"assistant",content:"Nouvelle conversation. Je suis prêt à travailler à partir de tes cours.",time:Date.now()}]);
  setError("");
 }
 return <div className="page ai-page">
  <div className="ai-chat-shell">
   <div className="ai-chat-header">
    <div className="ai-avatar">✨</div>
    <div><small className="eyebrow">RMed IA</small><h1>Ton assistant de cours</h1><p>Je réponds à partir de tes ressources déjà envoyées.</p></div>
    <div className="ai-chat-header-actions">
      <label><span>Ressources</span><select value={scope} onChange={e=>setScope(e.target.value)}><option value="all">Tous mes cours</option><option value="course" disabled={!course?.id}>Ce cours</option></select></label>
      <button onClick={clearChat}>Nouveau chat</button>
    </div>
   </div>
   <div className="ai-quick-actions">
    <button onClick={()=>send("Explique-moi simplement le cours que je révise en ce moment, puis donne-moi les 5 points à retenir.")}>📚 Expliquer le cours</button>
    <button onClick={()=>send("Trouve dans mes ressources la définition la plus importante à connaître et indique la page.")}>🔎 Retrouver une définition</button>
    <button onClick={()=>send("Donne-moi 3 pièges de QCM basés uniquement sur mes cours.")}>🎯 Pièges de QCM</button>
    <button onClick={()=>send("Crée-moi une flashcard recto-verso sur le point le plus important du cours.")}>🧠 Créer une flashcard</button>
   </div>
   <div className="ai-chat-messages">
    {messages.map((m,i)=><div key={i} className={"ai-bubble-wrap "+(m.role==="user"?"user":"assistant")}><div className={"ai-bubble "+(m.role==="user"?"user":"assistant")}>{m.content}</div></div>)}
    {busy&&<div className="ai-bubble-wrap assistant"><div className="ai-bubble assistant typing">RMed réfléchit…</div></div>}
    <div ref={endRef}/>
   </div>
   {error&&<div className="ai-chat-error">{error}</div>}
   <form className="ai-chat-compose" onSubmit={e=>{e.preventDefault();send()}}>
    <textarea rows="2" value={input} onChange={e=>setInput(e.target.value)} placeholder="Pose ta question à RMed…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}}/>
    <button className="primary" disabled={busy||!input.trim()}><Sparkles size={16}/>{busy?"Réponse…":"Envoyer"}</button>
   </form>
  </div>
 </div>
}

function AIAssistant({selection,courses,course,onClose}){
 const[q,setQ]=useState("");
 const[answer,setAnswer]=useState("");
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState("");
 async function ask(){
  const question=q.trim()||"Explique-moi ce passage simplement, au niveau PASS, puis donne-moi les points à retenir.";
  setBusy(true);setAnswer("");setError("");
  try{
   const resource=await retrieveResourceContext(courses,{courseId:course?.id||null,query:(selection?.text||"")+" "+question,limit:10000,maxChunks:10});
   const data=await callRMedAI({action:"explain",text:selection?.text||question,context:"RESSOURCES PERTINENTES :\n"+resource+"\n\nPASSAGE SÉLECTIONNÉ :\n"+(selection?.text||"")+"\n\nDEMANDE : "+question});
   setAnswer(data?.answer||"Réponse vide.");
  }catch(err){setError(err?.message||"Impossible de contacter l’IA.")}finally{setBusy(false)}
 }
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal ai-modal">
   <div className="mh"><div><small className="eyebrow">RMed IA</small><h2>Assistant du cours</h2></div><button onClick={onClose}><X size={18}/></button></div>
   <div className="ai-source"><small>PASSAGE SÉLECTIONNÉ</small><p>{selection?.text||"Aucun passage sélectionné."}</p></div>
   <div className="ai-mode-hint"><b>Mode compréhension</b><span>Je vais d’abord simplifier, puis revenir aux termes PASS.</span></div>
   <textarea rows="3" value={q} onChange={e=>setQ(e.target.value)} placeholder="Explique, vulgarise, donne-moi un piège de QCM…"/>
   <div className="ai-prompt-row">
    <button onClick={()=>setQ("Je ne comprends rien. Repars de zéro avec des mots très simples, une analogie si utile, puis reviens au vocabulaire PASS.")}>🧠 Je bloque</button>
    <button onClick={()=>setQ("Explique-moi autrement, avec d’autres mots que le cours, puis donne-moi l’idée à retenir.")}>🔄 Autrement</button>
   </div>
   <button className="primary" onClick={ask} disabled={busy}>{busy?"RMed réfléchit…":"Comprendre avec RMed"}</button>
   {error&&<div className="ai-error">{error}</div>}
   {answer&&<div className="ai-answer">{answer}</div>}
  </div>
 </div>
}

function SelectionBar({sel,suggestions,onCreate,onUse,onAskAI}){
 return <div className="selection-bar">
  <div className="selection-main">
   <span>« {sel.text} »</span>
   <button className="highlight-action done"><Highlighter size={15}/> Surligné</button>
   <button className="primary" onClick={onCreate}><Sparkles size={15}/> Créer la carte avec l’IA</button>
   <button className="ai-action" onClick={onAskAI}><Sparkles size={15}/> Assistant IA</button>
  </div>
  {suggestions?.length>0&&<><div className="suggestions-title"><Sparkles size={13}/> Formats proposés par RMed</div>
   <div className="suggestions-inline">{suggestions.map((s,i)=><button key={i} className="suggestion-mini" onClick={()=>onUse(s)}>{s.icon} {s.title}</button>)}</div>
  </>}
 </div>
}

function UploadModal({onClose,onFile}){
 const[busy,setBusy]=useState(false);
 const[fileName,setFileName]=useState("");
 async function picked(e){
   const file=e.target.files?.[0];
   if(!file)return;
   setBusy(true);setFileName(file.name);
   try{await onFile(file)}finally{setBusy(false);e.target.value=""}
 }
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
  <div className="modal upload-modal">
   <div className="mh"><div><small className="eyebrow">BIBLIOTHÈQUE</small><h2>Importer un cours</h2></div><button onClick={onClose} disabled={busy}><X size={18}/></button></div>
   <div className="upload-tabs"><button className="active">PDF</button><button disabled>Notes</button></div>
   <div className={"dropzone "+(busy?"busy":"")}>
    <Upload size={30}/>
    <b>{busy?"Ouverture du PDF…":"Choisir un PDF"}</b>
    <span>{fileName||"Appuie directement sur le bouton ci-dessous pour choisir ton fichier."}</span>
    <label className="pdf-picker-label">
      {busy?"Chargement…":"Sélectionner un PDF"}
      <input className="pdf-picker" type="file" accept=".pdf,application/pdf" onChange={picked} disabled={busy}/>
    </label>
    <small>PDF uniquement • Safari iPad compatible</small>
   </div>
   <div className="upload-note">Le PDF est enregistré dans le stockage local de ce navigateur.</div>
  </div>
 </div>
}

function CardModal({draft,setDraft,suggestions,onUse,onClose,onSave}){
 const[localAI,setLocalAI]=useState(false);
 async function regenerate(){
  if(!draft?.source)return;
  setLocalAI(true);setDraft(x=>x?{...x,aiGenerating:true,aiError:""}:x);
  try{
   const data=await callRMedAI({action:"flashcard",text:draft.source,context:draft.source});
   if(data?.front&&data?.back)setDraft(x=>x?{...x,type:data.type||"basic",front:data.front,back:data.back,aiGenerating:false,aiError:""}:x);
   else throw new Error("Réponse IA incomplète.");
  }catch(err){setDraft(x=>x?{...x,aiGenerating:false,aiError:err?.message||"IA indisponible"}:x)}
  finally{setLocalAI(false)}
 }
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal">
   <div className="mh"><div><small className="eyebrow">FLASHCARD</small><h2>{draft?.editingId?"Modifier ta carte":"Créer ta carte"}</h2></div><button onClick={onClose}><X size={18}/></button></div>
   {suggestions?.length>0&&!draft?.editingId&&<div className="suggestion-grid">{suggestions.map((s,i)=><button key={i} className={"suggestion-card "+(draft?.type===s.type?"chosen":"")} onClick={()=>onUse(s)}><span className="suggestion-icon">{s.icon}</span><b>{s.title}</b><small><strong>Recto :</strong> {s.front}</small><small><strong>Verso :</strong> {s.back}</small><em>Utiliser ce format</em></button>)}</div>}
   {!draft?.editingId&&<div className="ai-generate-row"><div><b>✨ RMed IA</b><small>{draft?.aiGenerating?"Génération du recto et du verso…":"L’IA transforme le passage en vraie question/réponse."}</small></div><button className="ai-action" onClick={regenerate} disabled={draft?.aiGenerating||localAI}>{draft?.aiGenerating||localAI?"Génération…":"Régénérer avec l’IA"}</button></div>}
   {draft?.aiError&&<div className="ai-error">{draft.aiError}</div>}
   <label>Recto<textarea rows="3" value={draft?.front||""} onChange={e=>setDraft(x=>({...x,front:e.target.value,aiError:""}))} placeholder="La question à laquelle tu dois répondre."/></label>
   <label>Verso<textarea rows="4" value={draft?.back||""} onChange={e=>setDraft(x=>({...x,back:e.target.value,aiError:""}))} placeholder="La réponse précise à mémoriser."/></label>
   <div className="source"><small>Source • page {draft?.page||"—"}</small><p>{draft?.source||"Passage sélectionné"}</p></div>
   <div className="ai"><Sparkles size={16}/><span>Le recto et le verso restent entièrement modifiables avant l’enregistrement.</span></div>
   <div className="actions"><button onClick={onClose}>Annuler</button><button className="primary" onClick={onSave} disabled={!draft?.front?.trim()||!draft?.back?.trim()}>Enregistrer la flashcard</button></div>
  </div>
 </div>
}

function Cards({cards,search,open,del,edit,courses,folders,onReviewCourse}){
 const filtered=cards.filter(c=>(c.front+" "+c.back+" "+(c.source||"")).toLowerCase().includes((search||"").toLowerCase()));
 const visibleCourses=filtered.map(c=>courses.find(x=>x.id===c.courseId)).filter(Boolean);
 const uniqueCourses=[...new Map(visibleCourses.map(c=>[c.id,c])).values()];
 return <div className="page"><div className="title"><div><small>MA BIBLIOTHÈQUE</small><h1>Mes flashcards</h1><p className="library-subtitle">Chaque carte reste rattachée à son cours et à son dossier.</p></div><span className="pill">{filtered.length} carte(s)</span></div>
  {filtered.length?<div className="cards-by-course">{uniqueCourses.map(co=>{
    const courseCards=filtered.filter(c=>c.courseId===co.id);
    const path=co.folderId?folderPath(folders,co.folderId).join(" / "):"Racine";
    return <section className="cards-course-group" key={co.id}>
      <div className="cards-course-head"><div><small>{path}</small><h3>{co.title}</h3></div><button onClick={()=>onReviewCourse?.(co.id)}><Brain size={15}/> Réviser ce cours</button></div>
      <div className="cards-library">{courseCards.map(c=><article className="flashcard-row" key={c.id}>
    <div className="flashcard-type">{c.type==="cloze"?"🧩":c.type==="concept"?"💡":"❓"}</div>
    <div className="flashcard-content">
      <div className="flashcard-side"><small>RECTO</small><strong>{c.front}</strong></div>
      <div className="flashcard-divider"/>
      <div className="flashcard-side back"><small>VERSO</small><p>{c.back}</p></div>
      <div className="flashcard-meta">Page {c.page} • {c.level||"À réviser"}</div>
    </div>
    <div className="flashcard-actions"><button onClick={()=>edit(c)}>Modifier</button><button onClick={()=>open(c)}>Source</button><button className="danger" onClick={()=>del(c.id)}><Trash2 size={16}/></button></div>
      </article>)}</div>
    </section>
  })}</div>:<div className="panel empty"><Brain size={35}/><p>Aucune flashcard pour l’instant.</p><p>Ouvre un cours, sélectionne un passage et appuie sur « Créer la carte avec l’IA ».</p></div>}
 </div>
}

function Review({rc,revealed,setRevealed,rate,total,i,courses,folders,course,activeFolderId,scope,setScope,onReviewAll}){
 const[help,setHelp]=useState("");
 const[helpBusy,setHelpBusy]=useState(false);
 const[helpError,setHelpError]=useState("");
 async function explain(){
  if(!rc||helpBusy)return;
  setHelpBusy(true);setHelp("");setHelpError("");
  try{
   const resource=await retrieveResourceContext(courses,{courseId:rc.courseId,query:rc.front+" "+rc.back,limit:9000,maxChunks:9});
   const data=await callRMedAI({
    action:"explain_error",
    text:"Je viens de voir cette flashcard. Explique-moi le concept sans simplement répéter la réponse.",
    context:"FLASHCARD :\nQuestion : "+rc.front+"\nRéponse attendue : "+rc.back+"\n\nRESSOURCES PERTINENTES :\n"+resource+"\n\nDemande : explique le point de blocage probable, avec d’autres mots, une analogie si utile, puis reviens au vocabulaire PASS."
   });
   setHelp(data?.answer||"Je n’ai pas réussi à formuler l’explication.");
  }catch(err){setHelpError(err?.message||"Impossible de contacter RMed IA.")}finally{setHelpBusy(false)}
 }
 const currentFolder=folders.find(f=>f.id===activeFolderId);
 const currentFolderName=currentFolder?.name||"Dossier actuel";
 const currentCourseName=course?.title||"Cours actuel";
 if(!rc)return <div className="page review"><div className="title"><div><small>RÉVISION ACTIVE</small><h1>Réviser</h1></div><span className="pill">0 carte</span></div><div className="panel empty"><div className="review-scope-bar"><b>Périmètre</b><button className={scope.type==="all"?"chosen":""} onClick={onReviewAll}>Toute la bibliothèque</button>{activeFolderId&&<button className={scope.type==="folder"?"chosen":""} onClick={()=>setScope({type:"folder",id:activeFolderId})}>{currentFolderName}</button>} {course?.id&&<button className={scope.type==="course"?"chosen":""} onClick={()=>setScope({type:"course",id:course.id})}>{currentCourseName}</button>}</div><Brain size={40}/><h2>Tout est à jour 🎉</h2><p>Aucune carte à réviser dans ce périmètre.</p></div></div>;
 return <div className="page review"><div className="title"><div><small>RÉVISION ACTIVE</small><h1>Réviser</h1></div><span className="pill">{Math.min(i+1,total)}/{total}</span></div>
  <div className="review-scope-bar"><b>Périmètre</b><button className={scope.type==="all"?"chosen":""} onClick={onReviewAll}>Toute la bibliothèque</button>{activeFolderId&&<button className={scope.type==="folder"?"chosen":""} onClick={()=>setScope({type:"folder",id:activeFolderId})}>{currentFolderName}</button>} {course?.id&&<button className={scope.type==="course"?"chosen":""} onClick={()=>setScope({type:"course",id:course.id})}>{currentCourseName}</button>}</div>
  <div className="reviewcard"><small>{rc.type==="cloze"?"TEXTE À TROUS":"QUESTION"}</small><h2>{rc.front}</h2>{revealed?<><div className="answer">{rc.back}</div>
   <button className="ai-help-button" onClick={explain} disabled={helpBusy}>🧠 {helpBusy?"RMed explique…":"Je n’ai pas compris → explique-moi autrement"}</button>
   {helpError&&<div className="ai-error">{helpError}</div>}
   {help&&<div className="review-ai-help"><small>RMed t’aide à comprendre</small><div>{help}</div></div>}
   <div className="levels">{levels.map(l=><button key={l[0]} onClick={()=>rate(l[0])}><span>{l[1]}</span><b>{l[2]}</b></button>)}</div></>:<button className="primary reveal" onClick={()=>setRevealed(true)}>Afficher la réponse</button>}</div>
 </div>
}

function QCM({courses,course,cards,qcm,setQcm}){
 const[scope,setScope]=useState("all");
 const[loading,setLoading]=useState(false);
 const[error,setError]=useState("");
 const[session,setSession]=useState(qcm?.questions?qcm:null);
 useEffect(()=>{setSession(qcm?.questions?qcm:null)},[qcm]);
 async function generate(){
  setLoading(true);setError("");
  try{
   const currentCourse=scope==="course"?course:null;
   const context=await buildStudyContext(courses,{courseId:currentCourse?.id||null,limit:30000,maxChunks:24});
   if(!context.trim())throw new Error("Aucune ressource exploitable n’est disponible. Ajoute d’abord un cours ou un PDF.");
   const data=await callRMedAI({action:"qcm_session",text:"Génère exactement 30 questions de QCM PASS à partir uniquement des ressources ci-dessous.",context});
   if(!Array.isArray(data?.questions)||data.questions.length!==30)throw new Error("RMed n’a pas généré exactement 30 questions.");
   const clean={questions:data.questions,index:0,score:0,selected:null,answered:false};
   setSession(clean);setQcm(clean);
  }catch(err){setError(err?.message||"Impossible de générer le QCM.")}finally{setLoading(false)}
 }
 function choose(i){
  if(!session||session.answered)return;
  const current=session.questions[session.index];
  const next={...session,selected:i,answered:true,score:session.score+(i===current.answerIndex?1:0)};
  setSession(next);setQcm(next);
 }
 function next(){
  if(!session)return;
  if(session.index>=29){const done={...session,index:30};setSession(done);setQcm(done);return;}
  const nextState={...session,index:session.index+1,selected:null,answered:false};
  setSession(nextState);setQcm(nextState);
 }
 function reset(){setSession(null);setQcm(null);setError("")}
 if(!session)return <div className="page"><div className="panel qcm qcm-setup"><small className="eyebrow">QCM IA</small><h1>30 questions, une par une.</h1><p>RMed fabrique une session à partir uniquement de tes ressources, avec 2 ou 3 propositions maximum par question.</p><div className="qcm-scope"><b>Base du QCM</b><button className={scope==="all"?"chosen":""} onClick={()=>setScope("all")}>Tous mes cours</button><button className={scope==="course"?"chosen":""} disabled={!courses.length} onClick={()=>setScope("course")}>Premier cours</button></div><button className="primary" onClick={generate} disabled={loading}>{loading?<><span className="spinner"/>Génération des 30 questions…</>:"Générer mon QCM avec RMed IA"}</button>{error&&<div className="ai-error">{error}</div>}<div className="qcm-note">1 question à la fois • progression et score conservés pendant la session.</div></div></div>;
 if(session.index>=30)return <div className="page"><div className="panel qcm qcm-result"><small className="eyebrow">SESSION TERMINÉE</small><h1>QCM terminé 🎉</h1><div className="qcm-score"><strong>{session.score}/30</strong><span>bonnes réponses</span></div><button className="primary" onClick={reset}>Nouvelle session</button></div></div>;
 const current=session.questions[session.index];
 const answered=session.answered;
 const right=session.selected===current.answerIndex;
 return <div className="page"><div className="title"><div><small>QCM IA</small><h1>Entraînement</h1></div><span className="pill">{session.index+1}/30 • {session.score} point(s)</span></div><div className="qcm-progress"><div style={{width:((session.index+1)/30*100)+"%"}}/></div><div className="panel qcm qcm-session"><small>QUESTION {session.index+1}</small><h2>{current.question}</h2><div className="qcm-choices">{(current.choices||[]).slice(0,3).map((a,i)=><button key={i} className={answered?(i===current.answerIndex?"correct":i===session.selected?"wrong":""):""} disabled={answered} onClick={()=>choose(i)}>{String.fromCharCode(65+i)}. {a}</button>)}</div>{answered&&<QCMCorrection current={current} selected={session.selected} right={right} next={next} final={session.index===29} courses={courses} courseId={scope==="course"?course?.id:null}/>} </div></div>;
}

function QCMCorrection({current,selected,right,next,final,courses,courseId}){
 const[help,setHelp]=useState("");
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState("");
 async function explain(){
  if(busy||right)return;
  setBusy(true);setHelp("");setError("");
  try{
   const resource=await retrieveResourceContext(courses,{courseId,query:current.question+" "+current.choices.join(" "),limit:9000,maxChunks:9});
   const data=await callRMedAI({
    action:"explain_error",
    text:"J’ai répondu "+String.fromCharCode(65+selected)+". Explique-moi précisément pourquoi cette réponse est incorrecte et comment raisonner la prochaine fois.",
    context:"QUESTION :\n"+current.question+"\n\nMA RÉPONSE :\n"+current.choices[selected]+"\n\nBONNE RÉPONSE :\n"+current.choices[current.answerIndex]+"\n\nEXPLICATION INITIALE :\n"+(current.explanation||"")+"\n\nRESSOURCES PERTINENTES :\n"+resource
   });
   setHelp(data?.answer||"Je n’ai pas réussi à formuler l’explication.");
  }catch(err){setError(err?.message||"Impossible de contacter RMed IA.")}finally{setBusy(false)}
 }
 return <div className={"qcm-correction "+(right?"good":"bad")}>
  <b>{right?"✅ Bonne réponse":"❌ Pas tout à fait"}</b>
  <span>{current.explanation||("Réponse correcte : "+current.choices[current.answerIndex])}</span>
  {!right&&<><small>Réponse attendue : {String.fromCharCode(65+current.answerIndex)}. {current.choices[current.answerIndex]}</small><button className="ai-help-button" onClick={explain} disabled={busy}>🧠 {busy?"RMed explique…":"Comprendre mon erreur"}</button>{error&&<div className="ai-error">{error}</div>}{help&&<div className="review-ai-help"><small>Pourquoi ton raisonnement bloque</small><div>{help}</div></div>}</>}
  <button className="primary" onClick={next}>{final?"Voir le résultat":"Question suivante"}</button>
 </div>
}

function FlashcardBatchModal({data,onClose,onOpenCards}){
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal batch-modal">
   <div className="mh"><div><small className="eyebrow">FLASHCARDS CRÉÉES</small><h2>{data.cards.length} nouvelles cartes</h2><p className="library-subtitle">{data.course.title}</p></div><button onClick={onClose}><X size={18}/></button></div>
   <div className="batch-list">{data.cards.map((c,i)=><article key={c.id}><span>{i+1}</span><div><b>{c.front}</b><p>{c.back}</p><small>Page {c.page}</small></div></article>)}</div>
   <div className="actions"><button onClick={onClose}>Fermer</button><button className="primary" onClick={onOpenCards}>Voir mes flashcards</button></div>
  </div>
 </div>
}
function MoveCourseModal({course,folders,onMove,onClose}){
 const[folderId,setFolderId]=useState(course?.folderId||"");
 const options=[{id:"",label:"Racine — Tous les cours"},...folders.map(f=>({id:f.id,label:folderPath(folders,f.id).join(" / ")}))]; 
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal move-modal">
   <div className="mh"><div><small className="eyebrow">ORGANISATION</small><h2>Ranger « {course?.title} »</h2></div><button onClick={onClose}><X size={18}/></button></div>
   <p>Choisis le dossier dans lequel le cours doit vivre. Ses flashcards suivront automatiquement ce cours.</p>
   <label>Dossier<select value={folderId} onChange={e=>setFolderId(e.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
   <div className="actions"><button onClick={onClose}>Annuler</button><button className="primary" onClick={()=>onMove(folderId||null)}>Ranger le cours</button></div>
  </div>
 </div>
}
function HistoryPage({h}){
 return <div className="page"><div className="title"><div><small>PROGRESSION</small><h1>Historique</h1></div></div>
  {h.length?<div className="list">{h.map(x=><div className="history" key={x.id}><span>{x.level==="perfect"?"🔵":x.level==="good"?"🟢":"🟡"}</span><div><b>{x.card}</b><small>{new Date(x.date).toLocaleString("fr-FR")}</small></div></div>)}</div>:<div className="panel empty"><History size={35}/><p>Ton historique apparaîtra ici.</p></div>}
 </div>
}


createRoot(document.getElementById("root")).render(<Root/>);