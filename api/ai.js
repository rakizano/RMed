function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

function json(res,status,body){res.status(status).json(body);}

function textFromGemini(data){
  return (data?.candidates?.[0]?.content?.parts||[])
    .map(part=>part?.text||"")
    .join("\n")
    .trim();
}

function textFromChatCompletion(data){
  const content=data?.choices?.[0]?.message?.content;
  if(typeof content==="string")return content.trim();
  if(Array.isArray(content)){
    return content.map(part=>typeof part==="string"?part:part?.text||"").join("\n").trim();
  }
  return "";
}

const jsonSchemas={
  flashcard:{
    type:"OBJECT",
    properties:{
      type:{type:"STRING"},
      front:{type:"STRING"},
      back:{type:"STRING"}
    },
    required:["type","front","back"]
  },
  flashcard_batch:{
    type:"OBJECT",
    properties:{
      cards:{
        type:"ARRAY",
        minItems:8,
        maxItems:8,
        items:{
          type:"OBJECT",
          properties:{
            type:{type:"STRING"},
            front:{type:"STRING"},
            back:{type:"STRING"},
            source:{type:"STRING"},
            page:{type:"INTEGER",minimum:1}
          },
          required:["type","front","back","source","page"]
        }
      }
    },
    required:["cards"]
  },
  explain:{
    type:"OBJECT",
    properties:{answer:{type:"STRING"}},
    required:["answer"]
  },
  qcm_session:{
    type:"OBJECT",
    properties:{
      questions:{
        type:"ARRAY",
        minItems:30,
        maxItems:30,
        items:{
          type:"OBJECT",
          properties:{
            question:{type:"STRING"},
            choices:{type:"ARRAY",minItems:3,maxItems:3,items:{type:"STRING"}},
            answerIndex:{type:"INTEGER",minimum:0,maximum:2},
            explanation:{type:"STRING"}
          },
          required:["question","choices","answerIndex","explanation"]
        }
      }
    },
    required:["questions"]
  }
};

function pickSchema(action){
  if(action==="qcm_session")return jsonSchemas.qcm_session;
  if(action==="flashcard_batch")return jsonSchemas.flashcard_batch;
  if(action==="flashcard")return jsonSchemas.flashcard;
  return jsonSchemas.explain;
}

function schemaInstruction(action){
  if(action==="flashcard"){
    return 'Retourne uniquement un objet JSON valide de la forme {"type":"basic|cloze|concept","front":"...","back":"..."}.';
  }
  if(action==="flashcard_batch"){
    return 'Retourne uniquement un objet JSON valide de la forme {"cards":[{"type":"basic|cloze|concept","front":"...","back":"...","source":"...","page":1}, ...]}. Il doit contenir exactement 8 cartes.';
  }
  if(action==="qcm_session"){
    return 'Retourne uniquement un objet JSON valide de la forme {"questions":[{"question":"...","choices":["A","B","C"],"answerIndex":0,"explanation":"..."}, ...]}. Il doit contenir exactement 30 questions.';
  }
  return 'Retourne uniquement un objet JSON valide de la forme {"answer":"..."}.';
}

function buildInstructions(action){
  if(action==="flashcard"){
    return `Tu es RMed, un excellent professeur particulier de PASS.
Crée UNE flashcard de très haute qualité à partir du passage sélectionné et du contexte de cours fourni.
Le passage sélectionné est la priorité : utilise précisément les informations qu’il contient, sans fabriquer une question artificielle.
Si le passage contient un terme ou une notion définie, le recto doit idéalement demander « Qu’est-ce que … ? » ou « Que signifie … ? » et le verso doit donner la définition et uniquement les précisions utiles présentes dans le contexte.
Si le passage décrit un mécanisme, une relation ou une étape, transforme-le en question qui teste réellement cette idée.
Le verso peut faire 1 à 3 phrases si nécessaire : il doit être complet, précis et mémorisable, pas simplement répéter le recto.
Utilise le contexte de cours pour désambiguïser et choisir les informations importantes, mais n’ajoute aucun fait absent du contexte fourni.
Évite les cartes triviales du type « Que dit cette phrase ? » ou les questions qui ne testent rien.
La carte doit avoir du sens même lorsqu’elle est révisée seule plusieurs jours plus tard.
${schemaInstruction(action)}`;
  }
  if(action==="flashcard_batch"){
    return `Tu es RMed, excellent professeur de PASS et créateur de flashcards.
Crée EXACTEMENT 8 flashcards à partir UNIQUEMENT des ressources fournies.
Chaque carte doit tester le rappel actif d'une notion précise, avec un recto sous forme de vraie question ou d'un texte à trous et un verso précis.
Varie les notions et les formulations.
Pour "source", indique le passage source le plus proche fourni dans le contexte.
Pour "page", utilise le numéro de page indiqué dans les en-têtes de ressources.
N'invente aucune information absente des ressources.
${schemaInstruction(action)}`;
  }
  if(action==="qcm_session"){
    return `Tu es RMed, professeur de PASS et créateur de QCM.
Crée EXACTEMENT 30 questions à partir UNIQUEMENT des ressources fournies.
Chaque question possède EXACTEMENT 3 propositions et UNE seule bonne réponse.
Les pièges doivent être fins mais entièrement justifiables par les ressources.
Couvre largement les notions présentes : définitions, mécanismes, localisations, étapes, chiffres, exceptions et vocabulaire.
Pour chaque question, l'explication doit enseigner pourquoi la bonne réponse est correcte et quel piège il fallait éviter.
N'utilise aucune connaissance extérieure.
${schemaInstruction(action)}`;
  }
  if(action==="explain_error"){
    return `Tu es RMed, professeur particulier de PASS.
Réponds TRÈS VITE et TRÈS COURT.
Explique seulement le point clé qui permet de comprendre la flashcard.
3 à 5 phrases maximum, vocabulaire simple puis vocabulaire PASS.
Ne répète pas inutilement la question ou la réponse.
Termine par "À retenir : …".
Utilise uniquement les ressources fournies.
${schemaInstruction(action)}`;
  }
  if(action==="chat"){
    return `Tu es RMed, un professeur particulier de PASS.
Pour les questions scolaires, utilise UNIQUEMENT les ressources fournies.
Ne te contente jamais de réciter le cours : explique avec d'autres mots, reconstruis l'idée depuis l'intuition, puis reviens au vocabulaire PASS.
Quand l'étudiant dit qu'il ne comprend pas, recommence plus simplement et change d'angle.
Tu peux utiliser des analogies clairement présentées comme telles.
Quand cela aide, termine par "À retenir".
Pour une conversation non scolaire très simple, réponds naturellement.
Si une information scolaire n'est pas dans les ressources, dis-le au lieu de l'inventer.
${schemaInstruction(action)}`;
  }
  return `Tu es RMed, professeur particulier de PASS.
Explique le terme, la phrase ou la notion demandée avec des mots simples sans perdre la précision scientifique.
Le contexte de cours sert à garder l'explication pertinente pour ce cours.
Si la définition exacte n'est pas présente dans le cours, tu peux utiliser tes connaissances générales pour expliquer la notion, sans prétendre que cette information vient du cours.
Commence par l'idée simple, puis donne le vocabulaire PASS utile et relie explicitement l'explication au cours.
Ne recopie pas le passage mot pour mot.
${schemaInstruction(action)}`;
}

function parseJson(text){
  const raw=String(text||"").trim();
  if(!raw)return null;
  try{return JSON.parse(raw)}catch{}
  const fenced=raw.match(/\```(?:json)?\s*([\s\S]*?)\s*\```/i);
  if(fenced){try{return JSON.parse(fenced[1])}catch{}}
  const first=raw.indexOf("{");
  const last=raw.lastIndexOf("}");
  if(first>=0&&last>first){
    try{return JSON.parse(raw.slice(first,last+1))}catch{}
  }
  return null;
}

function validateParsed(action,parsed){
  if(!parsed||typeof parsed!=="object")return false;
  if(action==="qcm_session"){
    return Array.isArray(parsed.questions)&&parsed.questions.length===30&&parsed.questions.every(q=>
      q&&typeof q.question==="string"&&Array.isArray(q.choices)&&q.choices.length===3&&
      q.choices.every(c=>typeof c==="string")&&Number.isInteger(q.answerIndex)&&q.answerIndex>=0&&q.answerIndex<3&&
      typeof q.explanation==="string"
    );
  }
  if(action==="flashcard_batch"){
    return Array.isArray(parsed.cards)&&parsed.cards.length===8&&parsed.cards.every(c=>
      c&&typeof c.front==="string"&&typeof c.back==="string"&&typeof c.type==="string"&&
      typeof c.source==="string"&&Number.isInteger(c.page)&&c.page>=1
    );
  }
  if(action==="flashcard"){
    return typeof parsed.type==="string"&&typeof parsed.front==="string"&&typeof parsed.back==="string";
  }
  return typeof parsed.answer==="string";
}

function transientStatus(status){
  return [408,409,425,429,500,502,503,504].includes(status);
}

function friendlyProviderError(provider,status,message){
  const clean=String(message||"").trim();
  if(status===429)return provider+" est momentanément limité (429).";
  if(status===503)return provider+" est momentanément saturé (503).";
  if(status===401||status===403)return provider+" refuse la clé API (vérifie la clé et les droits).";
  return clean?provider+" : "+clean:provider+" est indisponible.";
}

async function fetchJson(url,options,timeoutMs=45000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const upstream=await fetch(url,{...options,signal:controller.signal});
    const data=await upstream.json().catch(()=>({}));
    return {upstream,data};
  }catch(err){
    if(err?.name==="AbortError")throw new Error("Le fournisseur IA met trop de temps à répondre.");
    throw err;
  }finally{clearTimeout(timer)}
}

async function callGemini({apiKey,models,instructions,input,action,schema,maxOutputTokens,temperature}){
  let last=null;
  for(const model of models){
    try{
      const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(apiKey);
      const {upstream,data}=await fetchJson(url,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          contents:[{role:"user",parts:[{text:instructions+"\n\n"+input}]}],
          generationConfig:{
            temperature,
            maxOutputTokens,
            responseMimeType:"application/json",
            responseSchema:schema
          }
        })
      });
      if(upstream.ok){
        const parsed=parseJson(textFromGemini(data));
        if(validateParsed(action,parsed)){
          return {ok:true,data,model};
        }
        last={status:502,message:"Réponse Gemini invalide."};
      }else{
        last={status:upstream.status,message:data?.error?.message||"Erreur Gemini."};
        if(!transientStatus(upstream.status)&&upstream.status!==400)break;
      }
    }catch(err){last={status:503,message:err?.message||"Gemini indisponible."};}
  }
  return {ok:false,...last};
}

function providerConfigs(){
  const configured=[];
  if(process.env.GEMINI_API_KEY){
    configured.push({
      id:"gemini",
      label:"Gemini",
      key:process.env.GEMINI_API_KEY,
      models:[process.env.RMED_GEMINI_MODEL||"gemini-3.6-flash",process.env.RMED_GEMINI_FALLBACK_MODEL||"gemini-2.5-flash-lite"].filter((m,i,a)=>m&&a.indexOf(m)===i)
    });
  }
  if(process.env.CEREBRAS_API_KEY){
    configured.push({
      id:"cerebras",
      label:"Cerebras",
      key:process.env.CEREBRAS_API_KEY,
      baseUrl:"https://api.cerebras.ai/v1",
      model:process.env.RMED_CEREBRAS_MODEL||"gpt-oss-120b"
    });
  }
  if(process.env.GROQ_API_KEY){
    configured.push({
      id:"groq",
      label:"Groq",
      key:process.env.GROQ_API_KEY,
      baseUrl:"https://api.groq.com/openai/v1",
      model:process.env.RMED_GROQ_MODEL||"openai/gpt-oss-120b"
    });
  }
  if(process.env.OPENAI_API_KEY){
    configured.push({
      id:"openai",
      label:"OpenAI",
      key:process.env.OPENAI_API_KEY,
      baseUrl:"https://api.openai.com/v1",
      model:process.env.RMED_OPENAI_MODEL||"gpt-5-mini"
    });
  }
  if(process.env.DEEPSEEK_API_KEY){
    configured.push({
      id:"deepseek",
      label:"DeepSeek",
      key:process.env.DEEPSEEK_API_KEY,
      baseUrl:"https://api.deepseek.com",
      model:process.env.RMED_DEEPSEEK_MODEL||"deepseek-v4-flash"
    });
  }
  const order=String(process.env.RMED_PROVIDER_ORDER||"gemini,openai,deepseek,cerebras,groq").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  const rank=new Map(order.map((id,i)=>[id,i]));
  return configured.sort((a,b)=>(rank.get(a.id)??999)-(rank.get(b.id)??999));
}

async function callCompatible({provider,instructions,input,action,maxOutputTokens,temperature}){
  const url=provider.baseUrl+"/chat/completions";
  const headers={
    "Content-Type":"application/json",
    Authorization:"Bearer "+provider.key
  };
  const messages=[
    {role:"system",content:instructions},
    {role:"user",content:input}
  ];
  const baseBody={
    model:provider.model,
    messages,
    temperature,
    max_tokens:maxOutputTokens
  };
  let result=await fetchJson(url,{method:"POST",headers,body:JSON.stringify({
    ...baseBody,
    response_format:{type:"json_object"}
  })});
  if(result.upstream.status===400){
    const msg=String(result.data?.error?.message||"").toLowerCase();
    if(msg.includes("response_format")||msg.includes("json")||msg.includes("unsupported")){
      result=await fetchJson(url,{method:"POST",headers,body:JSON.stringify(baseBody)});
    }
  }
  if(result.upstream.ok){
    const parsed=parseJson(textFromChatCompletion(result.data));
    return {ok:validateParsed(action,parsed),parsed,status:result.upstream.status,message:result.data?.error?.message,raw:parsed};
  }
  return {ok:false,status:result.upstream.status,message:result.data?.error?.message||"Erreur fournisseur."};
}

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS")return res.status(204).end();

  const providers=providerConfigs();

  if(req.method==="GET"){
    return json(res,200,{
      ok:true,
      service:"RMed IA",
      providers:providers.map(p=>p.label),
      providerIds:providers.map(p=>p.id),
      model:providers[0]?.id==="gemini" ? providers[0].models?.[0] : providers[0]?.model,
      fallbackReady:providers.length>1
    });
  }

  if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});

  let body=req.body||{};
  if(typeof body==="string"){
    try{body=JSON.parse(body)}
    catch{return json(res,400,{error:"Requête IA illisible."})}
  }

  const action=String(body?.action||"flashcard");
  const text=String(body?.text||"").trim();
  const context=String(body?.context||"").trim();
  if(!text)return json(res,400,{error:"Aucune demande n’a été fournie."});
  if(text.length>12000)return json(res,413,{error:"Demande trop longue."});
  if(!providers.length){
    return json(res,500,{error:"Aucune IA n’est configurée sur RMed. Ajoute au moins une clé API dans Vercel."});
  }

  const instructions=buildInstructions(action);
  const input=(action==="qcm_session"?"RESSOURCES POUR LE QCM:\n":"PASSAGE / DEMANDE:\n")+text+"\n\nCONTEXTE ET RESSOURCES PERTINENTES:\n"+context.slice(0,30000);
  const schema=pickSchema(action);
  const isQcm=action==="qcm_session";
  const isBatch=action==="flashcard_batch";
  const maxOutputTokens=isQcm?10000:isBatch?5200:action==="flashcard"?420:action==="explain_error"?500:1400;
  const temperature=isQcm?0.45:0.35;
  const errors=[];
  let attempts=0;

  for(const provider of providers){
    attempts++;
    try{
      let result;
      if(provider.id==="gemini"){
        result=await callGemini({
          apiKey:provider.key,
          models:provider.models,
          instructions,
          action,
          input,
          schema,
          maxOutputTokens,
          temperature
        });
        if(result.ok){
          const parsed=parseJson(textFromGemini(result.data));
          return json(res,200,{...parsed,provider:provider.id,model:result.model});
        }
      }else{
        result=await callCompatible({
          provider,
          instructions,
          input,
          action,
          maxOutputTokens,
          temperature
        });
        if(result.ok){
          return json(res,200,{...result.parsed,provider:provider.id,model:provider.model});
        }
      }

      errors.push({
        provider:provider.label,
        status:result?.status||502,
        message:friendlyProviderError(provider.label,result?.status||502,result?.message)
      });
      if(result?.status===401||result?.status===403){
        continue;
      }
    }catch(err){
      errors.push({provider:provider.label,status:503,message:provider.label+" : "+(err?.message||"service indisponible.")});
    }
  }

  const last=errors[errors.length-1];
  const detail=errors.map(e=>e.message).join(" → ");
  return json(res,502,{
    error:detail||"Toutes les IA configurées sont momentanément indisponibles.",
    code:"ALL_PROVIDERS_UNAVAILABLE",
    providersTried:attempts
  });
};
