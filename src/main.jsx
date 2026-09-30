import React,{useEffect,useMemo,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{BookOpen,Brain,ChevronLeft,ChevronRight,Clock3,FileText,History,Home as HomeIcon,ListChecks,Minus,Plus,Search,Sparkles,Target,Trash2,Upload,X,Highlighter,Lock,Unlock,Palette,PenLine,Eraser,ExternalLink,ArrowLeft}from"lucide-react";
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
const uid=()=>{
 try{return window.crypto?.randomUUID?.()||String(Date.now())+Math.random().toString(16).slice(2)}
 catch{return String(Date.now())+Math.random().toString(16).slice(2)}
};
let pdfjsPromise=null;
function isAppleMobile(){
 const ua=navigator.userAgent||"";
 return /iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
}
async function getPdfjs(){
 if(!pdfjsPromise) pdfjsPromise=import("pdfjs-dist");
 return pdfjsPromise;
}
async function openPdfDocument(data){
 const pdfjsLib=await getPdfjs();
 const source=data instanceof ArrayBuffer?data.slice(0):data;
 const bytes=source instanceof Uint8Array?new Uint8Array(source):new Uint8Array(source);
 const options={data:bytes.slice(0),isEvalSupported:false,useSystemFonts:true,verbosity:0};
 if(isAppleMobile()){
   // Safari/iPad: avoid the worker path, which is less reliable inside GitHub Pages/webviews.
   options.disableWorker=true;
 }else{
   const worker=await import("pdfjs-dist/build/pdf.worker.min.js?url");
   pdfjsLib.GlobalWorkerOptions.workerSrc=worker.default;
 }
 return await pdfjsLib.getDocument(options).promise;
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
async function deletePdf(id){
 const db=await dbPromise;if(!db)return;
 await new Promise((res,rej)=>{const tx=db.transaction("pdfs","readwrite");tx.objectStore("pdfs").delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
}

function Root(){
 const params=new URLSearchParams(window.location.search);
 const readerId=params.get("reader");
 if(readerId)return <ExternalPdfReader courseId={readerId} initialPage={Number(params.get("page")||1)}/>;
 return <App/>;
}

function App(){
 const[courses,setCourses]=useState(()=>load("rmed_courses",[demo]));
 const[cards,setCards]=useState(()=>load("rmed_cards",[]));
 const[highlights,setHighlights]=useState(()=>load("rmed_highlights",[]));
 const[history,setHistory]=useState(()=>load("rmed_history",[]));
 const[tab,setTab]=useState("home");
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
 useEffect(()=>save("rmed_cards",cards),[cards]);
 useEffect(()=>save("rmed_highlights",highlights),[highlights]);
 useEffect(()=>save("rmed_history",history),[history]);

 const due=useMemo(()=>cards.filter(c=>!c.next||c.next<=Date.now()),[cards,history]);
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
       pdfCache.current.set(c.id,doc);
       setPdfDoc(doc);
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

 async function open(c,pg=1,focus=null){
   setCourse(c);setPageNumber(typeof pg==="number"?pg:1);setFocusHighlightId(focus);setSel(null);setTab("course");
   if(c.kind==="pdf")await loadPdf(c);else setPdfDoc(null);
 }

 function nav(t){setTab(t);if(t==="review"){setRi(0);setRevealed(false)}}

 async function addPdf(file){
   if(!file)return;
   if(file.type&&file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("Choisis un fichier PDF.");return}
   setPdfLoading(true);setPdfError("");
   try{
     const buffer=await file.arrayBuffer();
     if(!buffer||buffer.byteLength<5)throw new Error("Fichier vide ou illisible");
     const id=uid();
     const title=file.name.replace(/\.pdf$/i,"");
     const c={id,title,kind:"pdf",pages:[],created:Date.now()};
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
       pdfCache.current.set(id,doc);
       setPdfDoc(doc);
       setCourses(x=>x.map(v=>v.id===id?{...v,pages:Array.from({length:doc.numPages},(_,i)=>({id:uid(),n:i+1}))}:v));
     }
     return;
     pdfCache.current.set(id,doc);
     setPdfDoc(doc);
     setCourses(x=>x.map(v=>v.id===id?{...v,pages:Array.from({length:doc.numPages},(_,i)=>({id:uid(),n:i+1}))}:v));
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
   const hId=selection.autoHighlight?addHighlight(selection):null;
   const next={...selection,highlightId:hId};
   setSel(next);
   makeSuggestions(next);
 }

 function openCreator(selection=sel){
   if(!selection)return;
   const hId=selection.highlightId||addHighlight(selection);
   const first=(suggestions[0])||{type:"basic",front:"Que faut-il retenir ?",back:selection.text};
   setDraft({...first,highlightId:hId,source:selection.text,page:pageNumber});
   setModal(true);
 }

 function applySuggestion(s){
   setDraft({...s,highlightId:sel?.highlightId||addHighlight(sel),source:sel?.text||s.back,page:pageNumber});
   setModal(true);
 }

 function saveCard(){
   if(!draft?.front?.trim()||!draft?.back?.trim())return;
   const hId=draft.highlightId;
   setCards(x=>[...x,{
     id:uid(),courseId:course.id,pageId:currentPage().id,page:pageNumber,highlightId:hId,
     source:draft.source||draft.back,type:draft.type||"basic",front:draft.front.trim(),back:draft.back.trim(),
     level:null,next:Date.now(),created:Date.now()
   }]);
   setModal(false);setDraft(null);setSuggestions([]);setSel(null);
 }

 function deleteCard(id){setCards(x=>x.filter(c=>c.id!==id))}
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
   <Nav icon={<History/>} t="Historique" a={tab==="history"} f={()=>nav("history")}/>
   <div className="dog">🐶<span>Ton compagnon est prêt.</span></div>
  </aside>

  <main>
   <header><b className="mobile">RMed</b><div className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…"/></div><div className="avatar">R</div></header>

   {tab==="home"&&<Home cards={cards} due={due.length} courses={courses} nav={nav} open={open}/>}
   {tab==="course"&&<Course openUpload={()=>setUploadOpen(true)} course={course} pageNumber={pageNumber} setPageNumber={setPageNumber} pdfDoc={pdfDoc} pdfNativeUrl={pdfNativeUrl} pdfLoading={pdfLoading} pdfError={pdfError} zoom={zoom} setZoom={setZoom} sel={sel} suggestions={suggestions} onSelection={onSelection} openCreator={openCreator} applySuggestion={applySuggestion} pdfLocked={pdfLocked} highlights={highlights.filter(h=>h.courseId===course.id&&h.page===pageNumber)} focusHighlightId={focusHighlightId} clearFocus={()=>setFocusHighlightId(null)} importPdf={importPdf} courses={courses} open={open}/>}
   {tab==="cards"&&<Cards cards={cards} search={search} open={openCardSource} del={deleteCard}/>}
   {tab==="review"&&<Review rc={rc} revealed={revealed} setRevealed={setRevealed} rate={rate} total={due.length} i={ri}/>}
   {tab==="qcm"&&<QCM cards={cards} qcm={qcm} setQcm={setQcm}/>}
   {tab==="history"&&<HistoryPage h={history}/>}
  </main>

  {uploadOpen&&<UploadModal onClose={()=>setUploadOpen(false)} onFile={addPdf}/>}
  {aiOpen&&<AIAssistant selection={sel} onClose={()=>setAiOpen(false)}/>}
  {modal&&<CardModal draft={draft} setDraft={setDraft} suggestions={suggestions} onUse={applySuggestion} onClose={()=>{setModal(false);setDraft(null)}} onSave={saveCard}/>}
 </div>
}

function Nav({icon,t,a,f}){return <button className={a?"nav active":"nav"} onClick={f}>{icon}<span>{t}</span></button>}
function Home({cards,due,courses,nav,open}){return <div className="page"><section className="hero"><div><small>TON ESPACE DE RÉVISION</small><h1>Travaille ton cours au moment où tu le lis.</h1><p>Surligne → crée ta flashcard → garde le lien vers le passage exact → révise.</p><button className="primary" onClick={()=>nav("course")}>Ouvrir un cours <ChevronRight/></button></div><div className="bigdog">🐶</div></section><div className="stats"><Stat n={courses.length} t="Cours"/><Stat n={cards.length} t="Flashcards"/><Stat n={due} t="À réviser"/><Stat n={cards.filter(c=>c.level==="perfect"||c.level==="good").length} t="Bien acquis"/></div><div className="grid"><section className="panel"><h3>Continuer</h3>{courses.map(c=><button className="course" key={c.id} onClick={()=>open(c)}><FileText/><div><b>{c.title}</b><small>{c.pages.length} page(s){c.kind==="pdf"?" • PDF réel":""}</small></div><ChevronRight/></button>)}</section><section className="panel"><h3>Actions rapides</h3><div className="quick"><button onClick={()=>nav("review")}><Brain/>Réviser</button><button onClick={()=>nav("qcm")}><ListChecks/>Faire un QCM</button><button onClick={()=>nav("cards")}><Target/>Mes flashcards</button></div></section></div></div>}
function Stat({n,t}){return <div className="stat"><strong>{n}</strong><span>{t}</span></div>}

function Course({course,pageNumber,setPageNumber,pdfDoc,pdfNativeUrl,pdfLoading,pdfError,zoom,setZoom,sel,suggestions,onSelection,openCreator,applySuggestion,pdfLocked,setPdfLocked,highlights,focusHighlightId,clearFocus,importPdf,courses,open,openUpload}){
 const pg=course.pages.find(x=>x.n===pageNumber)||course.pages[0];
 const[markColor,setMarkColor]=useState("#ffe66d99");
 const[markTool,setMarkTool]=useState("highlight");
 const prev=()=>setPageNumber(Math.max(1,pageNumber-1));
 const next=()=>setPageNumber(Math.min(course.pages.length,pageNumber+1));
 return <div className="page"><div className="title"><div><small>LECTEUR DE COURS</small><h1>{course.title}</h1></div><button className="upload" onClick={()=>openUpload?.()}><Upload/>Importer un PDF</button></div>
 <div className="course-switcher">{courses.map(c=><button className={c.id===course.id?"selected":""} key={c.id} onClick={()=>open(c)}><FileText/>{c.title}</button>)}</div>
 <div className="reader split-reader">
  <aside className="notes-pane">
   <div className="notes-head"><div><small>NOTES & FLASHCARDS</small><b>{course.title}</b></div><span>{highlights.length} surlignage(s)</span></div>
   <div className="notes-list">{highlights.length?highlights.map(h=><div className="note-card" key={h.id}><div className="marker"></div><p>« {h.text} »</p><button onClick={()=>onSelection({text:h.text,rects:h.rects,context:h.context,highlightId:h.id})}>Créer une carte</button></div>):<div className="notes-empty"><Highlighter/><p>Surligne un élément important dans le PDF.<br/>Tes passages apparaîtront ici.</p></div>}</div>
  </aside>
  <section className="pdf-reader">
   <div className="pdf-toolbar"><button className={"tool-label "+(pdfLocked?"locked":"")} onClick={()=>setPdfLocked(v=>!v)} title={pdfLocked?"Déverrouiller le déplacement du PDF":"Verrouiller le déplacement du PDF"}>{pdfLocked?<Lock/>:<Unlock/>}<span>{pdfLocked?"PDF verrouillé":"Verrouiller PDF"}</span></button><button onClick={prev} disabled={pageNumber<=1}><ChevronLeft/></button><span>Page <b>{pageNumber}</b> / {course.pages.length}</span><button onClick={next} disabled={pageNumber>=course.pages.length}><ChevronRight/></button><button className="external-reader-button" onClick={()=>window.open(window.location.pathname+"?reader="+encodeURIComponent(course.id)+"&page="+pageNumber,"_blank")} title="Ouvrir le PDF dans le lecteur externe"><ExternalLink size={16}/><span>Lecteur PDF</span></button><AnnotationPalette color={markColor} tool={markTool} setColor={setMarkColor} setTool={setMarkTool}/><span className="spacer"/><button onClick={()=>setZoom(z=>Math.max(.75,z-.1))}><Minus/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(2.5,z+.1))}><Plus/></button></div>
   {pdfLoading&&<div className="pdf-state">Ouverture du PDF…</div>}
   {pdfError&&<div className="pdf-state pdf-error"><b>Impossible d’ouvrir ce PDF</b><br/>{pdfError}<br/><button className="primary" onClick={openUpload}>Réimporter le PDF</button></div>}
   {!pdfLoading&&!pdfError ? (course.kind==="pdf" ? (pdfNativeUrl&&isAppleMobile() ? <iframe className="native-pdf" title="PDF" src={pdfNativeUrl}/> : pdfDoc ? <PDFPage courseId={course.id} pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} highlights={highlights} focusHighlightId={focusHighlightId} clearFocus={clearFocus} onSelection={onSelection} locked={pdfLocked} markTool={markTool} markColor={markColor}/> : <div className="pdf-state">Préparation du PDF…</div>) : course.kind==="demo" ? <DemoPage pg={pg} onSelection={onSelection}/> : <div className="pdf-state">PDF indisponible. Réimporte-le pour continuer.</div>) : null}
   {sel&&<SelectionBar sel={sel} suggestions={suggestions} onHighlight={()=>{}} onCreate={()=>openCreator(sel)} onUse={applySuggestion}/>}
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

function PDFPage({courseId,pdfDoc,pageNumber,scale,highlights,focusHighlightId,clearFocus,onSelection,locked,markTool,markColor,onPinchZoom}){
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
    for(const item of text.items){
     if(!item.str)continue;
     const span=document.createElement("span");
     const tx=pdfjsLib.Util.transform(viewport.transform,item.transform);
     const fontHeight=Math.hypot(tx[2],tx[3]);
     const angle=Math.atan2(tx[1],tx[0]);
     span.textContent=item.str;
     span.className="pdf-word";
     span.style.left=tx[4]+"px";
     span.style.top=(tx[5]-fontHeight)+"px";
     span.style.fontSize=fontHeight+"px";
     span.style.fontFamily=item.fontName||"sans-serif";
     span.style.transform="rotate("+angle+"rad)";
     layer.appendChild(span);
    }
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

 function getPointInfo(clientX,clientY){
  const caret=getCaretAtPoint(clientX,clientY);
  const span=getSpanAtClientPoint(clientX,clientY);
  const children=[...textRef.current?.children||[]];
  const index=span?children.indexOf(span):-1;
  let offset=0;
  if(caret&&span){
   try{
    const node=caret.startContainer;
    if(span.contains(node))offset=caret.startOffset;
    else if(node.nodeType===1&&span.contains(node))offset=Math.min(caret.startOffset,span.textContent?.length||0);
   }catch{}
  }
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
   const lo=Math.min(a.index,b.index);
   const hi=Math.max(a.index,b.index);
   const from=children[lo],to=children[hi];
   if(from&&to){
    try{
     range.setStart(from.firstChild,0);
     range.setEnd(to.firstChild,to.textContent?.length||0);
     if(!range.collapsed)return range;
    }catch{}
   }
  }
  return null;
 }

 function rectsFromRange(range){
  const root=pageRef.current?.getBoundingClientRect();
  if(!root||!range)return [];
  return [...range.getClientRects()].map(r=>({
   x:r.left-root.left,
   y:r.top-root.top,
   width:r.width,
   height:r.height
  })).filter(r=>r.width>1&&r.height>1);
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
  if(locked)e.preventDefault();
 }

 function touchMoveNative(e){
  if(locked){e.preventDefault();return;}
  if(e.touches.length!==2){e.preventDefault();return;}
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

 function touchEnd(){panRef.current.active=false;pinchRef.current.active=false;}

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

 function addExternalHighlight(selection){
  if(!selection?.text||!course)return;
  const pg=course.pages.find(x=>x.n===pageNumber);
  if(!pg)return;
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
      <PDFPage courseId={course.id} pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} highlights={highlights.filter(h=>h.courseId===course.id&&h.page===pageNumber)} focusHighlightId={null} clearFocus={()=>{}} onSelection={addExternalHighlight} locked={locked} markTool={markTool} markColor={markColor} onPinchZoom={onPinchZoom}/>
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

function AIAssistant({selection,onClose}){
 const[q,setQ]=useState("");
 const[answer,setAnswer]=useState("");
 const[busy,setBusy]=useState(false);
 async function ask(){
   const question=q.trim()||"Explique-moi ce passage simplement, au niveau PASS, puis donne-moi les points à retenir.";
   setBusy(true);setAnswer("");
   try{
     // This UI is ready for the secure server-side OpenAI connection.
     // A static GitHub Pages app must not expose an OpenAI API key in the browser.
     setAnswer("L’assistant IA est prêt à être connecté à OpenAI. Pour cette version statique, je n’envoie pas ta clé API depuis le navigateur afin de ne pas l’exposer.");
   }finally{setBusy(false)}
 }
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal ai-modal">
   <div className="mh"><div><small className="eyebrow">RMed IA</small><h2>Assistant du cours</h2></div><button onClick={onClose}><X size={18}/></button></div>
   <div className="ai-source"><small>PASSAGE SÉLECTIONNÉ</small><p>{selection?.text||"Aucun passage sélectionné."}</p></div>
   <textarea rows="3" value={q} onChange={e=>setQ(e.target.value)} placeholder="Explique, résume, crée une flashcard, donne-moi un piège de QCM…"/>
   <button className="primary" onClick={ask} disabled={busy}>{busy?"Réflexion…":"Demander à l’IA"}</button>
   {answer&&<div className="ai-answer">{answer}</div>}
  </div>
 </div>
}


function SelectionBar({sel,suggestions,onCreate,onUse,onAskAI}){
 return <div className="selection-bar">
  <div className="selection-main">
   <span>« {sel.text} »</span>
   <button className="highlight-action done"><Highlighter size={15}/> Surligné</button>
   <button className="primary" onClick={onCreate}><Sparkles size={15}/> Créer la carte</button>
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
 return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="modal">
   <div className="mh"><div><small className="eyebrow">FLASHCARD</small><h2>Créer ta carte</h2></div><button onClick={onClose}><X size={18}/></button></div>
   {suggestions?.length>0&&<div className="suggestion-grid">{suggestions.map((s,i)=><button key={i} className={"suggestion-card "+(draft?.type===s.type?"chosen":"")} onClick={()=>onUse(s)}><span className="suggestion-icon">{s.icon}</span><b>{s.title}</b><small>{s.front}</small><em>Utiliser ce format</em></button>)}</div>}
   <label>Recto<textarea rows="3" value={draft?.front||""} onChange={e=>setDraft(d=>({...d,front:e.target.value}))}/></label>
   <label>Verso<textarea rows="4" value={draft?.back||""} onChange={e=>setDraft(d=>({...d,back:e.target.value}))}/></label>
   <div className="source"><small>Source • page {draft?.page||"—"}</small><p>{draft?.source||"Passage sélectionné"}</p></div>
   <div className="ai"><Sparkles size={16}/><span>RMed garde le lien avec le passage exact du cours.</span></div>
   <div className="actions"><button onClick={onClose}>Annuler</button><button className="primary" onClick={onSave}>Enregistrer</button></div>
  </div>
 </div>
}

function Cards({cards,search,open,del}){
 const filtered=cards.filter(c=>(c.front+" "+c.back+" "+(c.source||"")).toLowerCase().includes((search||"").toLowerCase()));
 return <div className="page"><div className="title"><div><small>MA BIBLIOTHÈQUE</small><h1>Mes flashcards</h1></div></div>
  {filtered.length?<div className="list">{filtered.map(c=><div className="cardrow" key={c.id}><span className="emoji">{c.type==="cloze"?"🧩":c.type==="concept"?"💡":"❓"}</span><div><b>{c.front}</b><p>{c.back}</p><small>Page {c.page} • {c.level||"À réviser"}</small></div><button onClick={()=>open(c)}>Source</button><button className="danger" onClick={()=>del(c.id)}><Trash2 size={16}/></button></div>)}</div>:<div className="panel empty"><Brain size={35}/><p>Aucune flashcard pour l’instant.</p></div>}
 </div>
}

function Review({rc,revealed,setRevealed,rate,total,i}){
 if(!rc)return <div className="page"><div className="panel empty"><Brain size={40}/><h2>Tout est à jour 🎉</h2><p>Aucune carte à réviser maintenant.</p></div></div>;
 return <div className="page review"><div className="title"><div><small>RÉVISION ACTIVE</small><h1>Réviser</h1></div><span className="pill">{Math.min(i+1,total)}/{total}</span></div>
  <div className="reviewcard"><small>{rc.type==="cloze"?"TEXTE À TROUS":"QUESTION"}</small><h2>{rc.front}</h2>{revealed?<><div className="answer">{rc.back}</div><div className="levels">{levels.map(l=><button key={l[0]} onClick={()=>rate(l[0])}><span>{l[1]}</span><b>{l[2]}</b></button>)}</div></>:<button className="primary reveal" onClick={()=>setRevealed(true)}>Afficher la réponse</button>}</div>
 </div>
}

function QCM({cards,qcm,setQcm}){
 if(!qcm)return <div className="page"><div className="panel qcm"><small className="eyebrow">QCM</small><h1>Entraînement</h1><p>Transforme tes cartes en petite session de rappel.</p><button onClick={()=>{const c=cards[0];setQcm(c?{q:"Quel est l’élément clé à retenir ?",a:[c.back,"Je ne sais pas encore","Autre réponse"],right:0}:null)}}>{cards.length?"Lancer un QCM":"Créer d’abord des flashcards"}</button></div></div>;
 const [answered,setAnswered]=React.useState(false);
 return <div className="page"><div className="panel qcm"><small className="eyebrow">QCM</small><h1>{qcm.q}</h1><div className="list">{qcm.a.map((a,i)=><button key={i} onClick={()=>setAnswered(true)}>{a}</button>)}</div>{answered&&<p><b>Correction :</b> réponse attendue : {qcm.a[qcm.right]}</p>}<button onClick={()=>setQcm(null)}>Quitter</button></div></div>
}

function HistoryPage({h}){
 return <div className="page"><div className="title"><div><small>PROGRESSION</small><h1>Historique</h1></div></div>
  {h.length?<div className="list">{h.map(x=><div className="history" key={x.id}><span>{x.level==="perfect"?"🔵":x.level==="good"?"🟢":"🟡"}</span><div><b>{x.card}</b><small>{new Date(x.date).toLocaleString("fr-FR")}</small></div></div>)}</div>:<div className="panel empty"><History size={35}/><p>Ton historique apparaîtra ici.</p></div>}
 </div>
}


createRoot(document.getElementById("root")).render(<Root/>);
