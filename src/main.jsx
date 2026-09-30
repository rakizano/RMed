import React,{useEffect,useMemo,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{BookOpen,Brain,ChevronLeft,ChevronRight,Clock3,FileText,History,Home as HomeIcon,ListChecks,Minus,Plus,Search,Sparkles,Target,Trash2,Upload,X,Highlighter}from"lucide-react";
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
async function getPdfjs(){
 if(!pdfjsPromise){
   pdfjsPromise=(async()=>{
     const lib=await import("pdfjs-dist");
     const worker=await import("pdfjs-dist/build/pdf.worker.min.js?url");
     lib.GlobalWorkerOptions.workerSrc=worker.default;
     return lib;
   })();
 }
 return pdfjsPromise;
}
async function openPdfDocument(data){
 const pdfjsLib=await getPdfjs();
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
async function deletePdf(id){
 const db=await dbPromise;if(!db)return;
 await new Promise((res,rej)=>{const tx=db.transaction("pdfs","readwrite");tx.objectStore("pdfs").delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
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
 const[uploadOpen,setUploadOpen]=useState(false);
 const pdfCache=useRef(new Map());

 useEffect(()=>save("rmed_courses",courses),[courses]);
 useEffect(()=>save("rmed_cards",cards),[cards]);
 useEffect(()=>save("rmed_highlights",highlights),[highlights]);
 useEffect(()=>save("rmed_history",history),[history]);

 const due=useMemo(()=>cards.filter(c=>!c.next||c.next<=Date.now()),[cards,history]);
 const rc=due[ri];

 async function loadPdf(c){
   if(c.kind!=="pdf"){setPdfDoc(null);return}
   setPdfLoading(true);
   try{
     if(pdfCache.current.has(c.id)){setPdfDoc(pdfCache.current.get(c.id));return}
     const data=await getPdf(c.id);
     if(!data){setPdfDoc(null);return}
     const doc=await openPdfDocument(data);
     pdfCache.current.set(c.id,doc);
     setPdfDoc(doc);
   }catch(err){console.error(err);setPdfDoc(null)}
   finally{setPdfLoading(false)}
 }

 async function open(c,pg=1,focus=null){
   setCourse(c);setPageNumber(typeof pg==="number"?pg:1);setFocusHighlightId(focus);setSel(null);setTab("course");
   if(c.kind==="pdf")await loadPdf(c);else setPdfDoc(null);
 }

 function nav(t){setTab(t);if(t==="review"){setRi(0);setRevealed(false)}}

 async function addPdf(file){
   if(!file){return} if(file.type&&file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("Choisis un fichier PDF.");return}
   setPdfLoading(true);
   try{
     const buffer=await file.arrayBuffer();
     if(!buffer||buffer.byteLength<5)throw new Error("Fichier vide ou illisible");
     const id=uid();
     const doc=await openPdfDocument(buffer.slice(0));
     const pages=Array.from({length:doc.numPages},(_,i)=>({id:uid(),n:i+1}));
     const c={id,title:file.name.replace(/\.pdf$/i,""),kind:"pdf",pages,created:Date.now()};
     await savePdf(id,buffer);
     pdfCache.current.set(id,doc);
     setCourses(x=>[...x,c]);
     setCourse(c);setPageNumber(1);setPdfDoc(doc);setTab("course");setUploadOpen(false);
   }catch(err){console.error("PDF import error:",err);alert("Impossible d’ouvrir ce PDF. "+(err?.message||"Erreur inconnue"))}
   finally{setPdfLoading(false)}
 }

 function importPdf(e){const file=e.target.files?.[0];if(file)addPdf(file);e.target.value=""}

 function currentPage(){return course.pages.find(x=>x.n===pageNumber)||course.pages[0]}

 function addHighlight(selection){
   if(!selection?.text)return null;
   const pg=currentPage();
   const existing=highlights.find(h=>h.courseId===course.id&&h.pageId===pg.id&&h.text===selection.text);
   if(existing)return existing.id;
   const h={id:uid(),courseId:course.id,pageId:pg.id,page:pg.n,text:selection.text,rects:selection.rects||[],context:selection.context||selection.text,created:Date.now()};
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
   {tab==="course"&&<Course openUpload={()=>setUploadOpen(true)} course={course} pageNumber={pageNumber} setPageNumber={setPageNumber} pdfDoc={pdfDoc} pdfLoading={pdfLoading} zoom={zoom} setZoom={setZoom} sel={sel} suggestions={suggestions} onSelection={onSelection} openCreator={openCreator} applySuggestion={applySuggestion} highlights={highlights.filter(h=>h.courseId===course.id&&h.page===pageNumber)} focusHighlightId={focusHighlightId} clearFocus={()=>setFocusHighlightId(null)} importPdf={importPdf} courses={courses} open={open}/>}
   {tab==="cards"&&<Cards cards={cards} search={search} open={openCardSource} del={deleteCard}/>}
   {tab==="review"&&<Review rc={rc} revealed={revealed} setRevealed={setRevealed} rate={rate} total={due.length} i={ri}/>}
   {tab==="qcm"&&<QCM cards={cards} qcm={qcm} setQcm={setQcm}/>}
   {tab==="history"&&<HistoryPage h={history}/>}
  </main>

  {uploadOpen&&<UploadModal onClose={()=>setUploadOpen(false)} onFile={addPdf}/>}
  {modal&&<CardModal draft={draft} setDraft={setDraft} suggestions={suggestions} onUse={applySuggestion} onClose={()=>{setModal(false);setDraft(null)}} onSave={saveCard}/>}
 </div>
}

function Nav({icon,t,a,f}){return <button className={a?"nav active":"nav"} onClick={f}>{icon}<span>{t}</span></button>}
function Home({cards,due,courses,nav,open}){return <div className="page"><section className="hero"><div><small>TON ESPACE DE RÉVISION</small><h1>Travaille ton cours au moment où tu le lis.</h1><p>Surligne → crée ta flashcard → garde le lien vers le passage exact → révise.</p><button className="primary" onClick={()=>nav("course")}>Ouvrir un cours <ChevronRight/></button></div><div className="bigdog">🐶</div></section><div className="stats"><Stat n={courses.length} t="Cours"/><Stat n={cards.length} t="Flashcards"/><Stat n={due} t="À réviser"/><Stat n={cards.filter(c=>c.level==="perfect"||c.level==="good").length} t="Bien acquis"/></div><div className="grid"><section className="panel"><h3>Continuer</h3>{courses.map(c=><button className="course" key={c.id} onClick={()=>open(c)}><FileText/><div><b>{c.title}</b><small>{c.pages.length} page(s){c.kind==="pdf"?" • PDF réel":""}</small></div><ChevronRight/></button>)}</section><section className="panel"><h3>Actions rapides</h3><div className="quick"><button onClick={()=>nav("review")}><Brain/>Réviser</button><button onClick={()=>nav("qcm")}><ListChecks/>Faire un QCM</button><button onClick={()=>nav("cards")}><Target/>Mes flashcards</button></div></section></div></div>}
function Stat({n,t}){return <div className="stat"><strong>{n}</strong><span>{t}</span></div>}

function Course({course,pageNumber,setPageNumber,pdfDoc,pdfLoading,zoom,setZoom,sel,suggestions,onSelection,openCreator,applySuggestion,highlights,focusHighlightId,clearFocus,importPdf,courses,open,openUpload}){
 const pg=course.pages.find(x=>x.n===pageNumber)||course.pages[0];
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
   <div className="pdf-toolbar"><button className="tool-label" title="Surligner les passages sélectionnés"><Highlighter/><span>Surligner</span></button><button onClick={prev} disabled={pageNumber<=1}><ChevronLeft/></button><span>Page <b>{pageNumber}</b> / {course.pages.length}</span><button onClick={next} disabled={pageNumber>=course.pages.length}><ChevronRight/></button><span className="spacer"/><button onClick={()=>setZoom(z=>Math.max(.75,z-.1))}><Minus/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(2.5,z+.1))}><Plus/></button></div>
   {pdfLoading&&<div className="pdf-state">Ouverture du PDF…</div>}
   {course.kind==="pdf"&&pdfDoc?<PDFPage pdfDoc={pdfDoc} pageNumber={pageNumber} scale={zoom} highlights={highlights} focusHighlightId={focusHighlightId} clearFocus={clearFocus} onSelection={onSelection}/>:course.kind==="demo"?<DemoPage pg={pg} onSelection={onSelection}/>:<div className="pdf-state">PDF indisponible. Réimporte-le pour continuer.</div>}
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

function PDFPage({pdfDoc,pageNumber,scale,highlights,focusHighlightId,clearFocus,onSelection}){
 const pageRef=useRef(null),canvasRef=useRef(null),textRef=useRef(null),contextRef=useRef("");
 const penRef=useRef({active:false,points:[],spans:new Set(),pointerId:null});
 const[height,setHeight]=useState(800);

 useEffect(()=>{let cancelled=false;
 async function render(){
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
   const layer=textRef.current;layer.innerHTML="";
   for(const item of text.items){
     if(!item.str)continue;
     const span=document.createElement("span");
     const tx=pdfjsLib.Util.transform(viewport.transform,item.transform);
     const fontHeight=Math.hypot(tx[2],tx[3]);
     const angle=Math.atan2(tx[1],tx[0]);
     span.textContent=item.str;
     span.className="pdf-word";
     span.style.left=tx[4]+"px";span.style.top=(tx[5]-fontHeight)+"px";
     span.style.fontSize=fontHeight+"px";span.style.fontFamily=item.fontName||"sans-serif";
     span.style.transform="rotate("+angle+"rad)";
     layer.appendChild(span);
   }
   requestAnimationFrame(()=>{if(focusHighlightId){const el=document.getElementById("hl-"+focusHighlightId);el?.scrollIntoView({behavior:"smooth",block:"center"});clearFocus()}});
 }
 render().catch(console.error);
 return()=>{cancelled=true};
 },[pdfDoc,pageNumber,scale]);

 function addPenPoint(e){
   const p=penRef.current;
   const els=document.elementsFromPoint(e.clientX,e.clientY);
   els.forEach(el=>{if(el.classList?.contains("pdf-word"))p.spans.add(el)});
   p.points.push({x:e.clientX,y:e.clientY});
 }

 function penDown(e){
   if(e.pointerType!=="pen")return;
   e.preventDefault();
   penRef.current={active:true,points:[],spans:new Set(),pointerId:e.pointerId};
   e.currentTarget.setPointerCapture?.(e.pointerId);
   addPenPoint(e);
 }
 function penMove(e){
   if(!penRef.current.active||e.pointerType!=="pen")return;
   e.preventDefault();
   addPenPoint(e);
 }
 function penUp(e){
   const p=penRef.current;
   if(!p.active||e.pointerType!=="pen")return;
   e.preventDefault();
   p.active=false;
   const spans=[...p.spans];
   if(!spans.length)return;
   const root=pageRef.current.getBoundingClientRect();
   const rects=spans.map(el=>{const r=el.getBoundingClientRect();return{x:r.left-root.left,y:r.top-root.top,width:r.width,height:r.height,order:[...textRef.current.children].indexOf(el)}}).filter(r=>r.width>1&&r.height>1).sort((a,b)=>a.order-b.order);
   const text=spans.map(el=>el.textContent).join(" ").replace(/\s+/g," ").trim();
   onSelection({text,rects:rects.map(({order,...r})=>r),context:contextRef.current,autoHighlight:true});
 }

 function select(){
   if(penRef.current.active)return;
   const s=window.getSelection();if(!s||s.isCollapsed||!textRef.current)return;
   if(!textRef.current.contains(s.anchorNode))return;
   const t=s.toString().trim();if(!t)return;
   const root=pageRef.current.getBoundingClientRect();
   const rects=Array.from(s.getRangeAt(0).getClientRects()).map(r=>({x:r.left-root.left,y:r.top-root.top,width:r.width,height:r.height})).filter(r=>r.width>1&&r.height>1);
   onSelection({text:t,rects,context:contextRef.current});
   s.removeAllRanges();
 }
 return <div className="pdf-stage"><div className="pdf-page" ref={pageRef} style={{height}} onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp} onMouseUp={select}>
   <canvas ref={canvasRef}/>
   <div className="pdf-highlights">{highlights.map(h=><div key={h.id} id={"hl-"+h.id} className="highlight-group" onClick={()=>onSelection({text:h.text,rects:h.rects,context:h.context,highlightId:h.id})}>{h.rects.map((r,i)=><span key={i} style={{left:r.x,top:r.y,width:r.width,height:r.height}}/> )}</div>)}</div>
   <div className="pdf-text" ref={textRef}/>
 </div></div>
}


createRoot(document.getElementById("root")).render(<App/>);
