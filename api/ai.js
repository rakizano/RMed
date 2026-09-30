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
À partir UNIQUEMENT du passage fourni, crée une flashcard utile.
Le recto doit tester le rappel du concept, pas recopier le cours.
Le verso doit être précis et mémorisable.
N'invente aucune information absente du passage.`;
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
L'étudiant vient de faire une erreur ou indique qu'il ne comprend pas.
Ton objectif n'est PAS de répéter le cours.
Identifie la confusion ou le point de blocage probable.
Explique ensuite le concept avec des mots différents du cours.
Utilise une analogie ou une image mentale si cela aide, en signalant clairement qu'il s'agit d'une analogie.
Reviens ensuite au vocabulaire exact du PASS.
Termine par une phrase "À retenir".
Reste fidèle aux ressources fournies et ne crée aucun fait nouveau.`;
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
Explique le passage avec des mots simples sans perdre la précision scientifique.
Ne recopie pas le cours : reformule, donne une intuition, puis le vocabulaire PASS.
Reste limité aux ressources fournies et n'invente aucun fait.`;
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
  const maxOutputTokens=isQcm?10000:action==="explain_error"?1800:1400;
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
