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
Retourne uniquement le JSON demandé.`;
  }
  if(action==="flashcard_batch"){
    return `Tu es RMed, excellent professeur de PASS et créateur de flashcards.
Crée EXACTEMENT 8 flashcards à partir UNIQUEMENT des ressources fournies.
Chaque carte doit tester le rappel actif d'une notion précise, avec un recto sous forme de vraie question ou d'un texte à trous et un verso précis.
Varie les notions et les formulations.
Pour "source", indique le passage source le plus proche fourni dans le contexte.
Pour "page", utilise le numéro de page indiqué dans les en-têtes de ressources.
N'invente aucune information absente des ressources.`;
  }
  if(action==="qcm_session"){
    return `Tu es RMed, professeur de PASS et créateur de QCM.
Crée EXACTEMENT 30 questions à partir UNIQUEMENT des ressources fournies.
Chaque question possède EXACTEMENT 3 propositions et UNE seule bonne réponse.
Les pièges doivent être fins mais entièrement justifiables par les ressources.
Couvre largement les notions présentes : définitions, mécanismes, localisations, étapes, chiffres, exceptions et vocabulaire.
Pour chaque question, l'explication doit enseigner pourquoi la bonne réponse est correcte et quel piège il fallait éviter.
N'utilise aucune connaissance extérieure.`;
  }
  if(action==="explain_error"){
    return `Tu es RMed, professeur particulier de PASS.
Réponds TRÈS VITE et TRÈS COURT.
Explique seulement le point clé qui permet de comprendre la flashcard.
3 à 5 phrases maximum, vocabulaire simple puis vocabulaire PASS.
Ne répète pas inutilement la question ou la réponse.
Termine par "À retenir : …".
Utilise uniquement les ressources fournies.`;
  }
  if(action==="chat"){
    return `Tu es RMed, un professeur particulier de PASS.
Pour les questions scolaires, utilise UNIQUEMENT les ressources fournies.
Ne te contente jamais de réciter le cours : explique avec d'autres mots, reconstruis l'idée depuis l'intuition, puis reviens au vocabulaire PASS.
Quand l'étudiant dit qu'il ne comprend pas, recommence plus simplement et change d'angle.
Tu peux utiliser des analogies clairement présentées comme telles.
Quand cela aide, termine par "À retenir".
Pour une conversation non scolaire très simple, réponds naturellement.
Si une information scolaire n'est pas dans les ressources, dis-le au lieu de l'inventer.`;
  }
  return `Tu es RMed, professeur particulier de PASS.
Explique le terme, la phrase ou la notion demandée avec des mots simples sans perdre la précision scientifique.
Le contexte de cours sert à garder l'explication pertinente pour ce cours.
Si la définition exacte n'est pas présente dans le cours, tu peux utiliser tes connaissances générales pour expliquer la notion, sans prétendre que cette information vient du cours.
Commence par l'idée simple, puis donne le vocabulaire PASS utile et relie explicitement l'explication au cours.
Ne recopie pas le passage mot pour mot.`;
}

async function callGemini({apiKey,model,instructions,input,schema,maxOutputTokens,temperature}){
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(apiKey);
  const upstream=await fetch(url,{
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
  const data=await upstream.json().catch(()=>({}));
  return {upstream,data};
}

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS")return res.status(204).end();

  if(req.method==="GET"){
    return json(res,200,{
      ok:true,
      service:"RMed IA",
      provider:process.env.GEMINI_API_KEY?"gemini":"none",
      model:process.env.RMED_GEMINI_MODEL||"gemini-3.6-flash"
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

  const instructions=buildInstructions(action);
  const input=(action==="qcm_session"?"RESSOURCES POUR LE QCM:\n":"PASSAGE / DEMANDE:\n")+text+"\n\nCONTEXTE ET RESSOURCES PERTINENTES:\n"+context.slice(0,30000);
  const schema=pickSchema(action);
  const isQcm=action==="qcm_session";
  const isBatch=action==="flashcard_batch";
  const maxOutputTokens=isQcm?10000:isBatch?5200:action==="flashcard"?420:action==="explain_error"?500:1400;
  const temperature=isQcm?0.45:0.35;

  try{
    if(!process.env.GEMINI_API_KEY){
      return json(res,500,{error:"RMed IA n’est pas encore connecté à Gemini. Ajoute GEMINI_API_KEY au backend Vercel pour activer l’IA gratuite."});
    }

    const models=[process.env.RMED_GEMINI_MODEL||"gemini-3.6-flash","gemini-3.5-flash"].filter((m,i,a)=>m&&a.indexOf(m)===i);
    let lastError=null;

    for(const model of models){
      const {upstream,data}=await callGemini({
        apiKey:process.env.GEMINI_API_KEY,
        model,
        instructions,
        input,
        schema,
        maxOutputTokens,
        temperature
      });

      if(upstream.ok){
        const raw=textFromGemini(data);
        let parsed=null;
        try{parsed=JSON.parse(raw)}catch{}
        if(!parsed){
          lastError=new Error("Gemini a répondu dans un format inattendu.");
          continue;
        }
        if(isQcm&&(!Array.isArray(parsed.questions)||parsed.questions.length!==30)){
          lastError=new Error("Gemini n’a pas généré exactement 30 questions.");
          continue;
        }
        if(isBatch&&(!Array.isArray(parsed.cards)||parsed.cards.length!==8)){
          lastError=new Error("Gemini n’a pas généré exactement 8 flashcards.");
          continue;
        }
        return json(res,200,parsed);
      }

      lastError=data?.error?.message||new Error("Erreur Gemini.");
      if(![400,404,429,503].includes(upstream.status))break;
    }

    return json(res,502,{error:String(lastError?.message||lastError||"Gemini est indisponible.")});
  }catch(err){
    console.error("RMed AI error",err);
    return json(res,500,{error:"Impossible de contacter le service IA."});
  }
};
