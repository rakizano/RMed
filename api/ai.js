const allowedOrigin = process.env.RMED_ALLOWED_ORIGIN || "https://rakizano.github.io";

function cors(res){
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

function outputText(data){
  if(typeof data?.output_text==="string")return data.output_text;
  const parts=[];
  for(const item of data?.output||[]){
    for(const part of item?.content||[]){
      if(part?.type==="output_text"&&typeof part.text==="string")parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function json(res,status,body){
  res.status(status).json(body);
}

module.exports=async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
  if(!process.env.OPENAI_API_KEY)return json(res,500,{error:"OPENAI_API_KEY n’est pas configurée sur le backend."});

  const action=String(req.body?.action||"flashcard");
  const text=String(req.body?.text||"").trim();
  const context=String(req.body?.context||"").trim();
  if(!text)return json(res,400,{error:"Aucun passage n’a été fourni."});
  if(text.length>12000)return json(res,413,{error:"Passage trop long."});

  const schemas={
    flashcard:{
      name:"rmed_flashcard",
      schema:{type:"object",additionalProperties:false,properties:{
        type:{type:"string",enum:["basic","cloze","concept"]},
        front:{type:"string"},
        back:{type:"string"}
      },required:["type","front","back"]}
    },
    cloze:{
      name:"rmed_cloze",
      schema:{type:"object",additionalProperties:false,properties:{
        type:{type:"string",const:"cloze"},
        front:{type:"string"},
        back:{type:"string"}
      },required:["type","front","back"]}
    },
    qcm:{
      name:"rmed_qcm",
      schema:{type:"object",additionalProperties:false,properties:{
        question:{type:"string"},
        choices:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
        answer:{type:"string"},
        explanation:{type:"string"}
      },required:["question","choices","answer","explanation"]}
    },
    explain:{
      name:"rmed_explain",
      schema:{type:"object",additionalProperties:false,properties:{answer:{type:"string"}},required:["answer"]}
    },
    chat:{
      name:"rmed_chat",
      schema:{type:"object",additionalProperties:false,properties:{answer:{type:"string"}},required:["answer"]}
    },
    qcm_session:{
      name:"rmed_qcm_session",
      schema:{type:"object",additionalProperties:false,properties:{
        questions:{type:"array",minItems:30,maxItems:30,items:{type:"object",additionalProperties:false,properties:{
          question:{type:"string"},
          choices:{type:"array",minItems:2,maxItems:3,items:{type:"string"}},
          answerIndex:{type:"integer",minimum:0,maximum:2},
          explanation:{type:"string"}
        },required:["question","choices","answerIndex","explanation"]}}
      },required:["questions"]}
    }
  };

  const selected=schemas[action]||schemas.flashcard;
  let instructions="";
  if(action==="flashcard"){
    instructions="Tu es l’IA pédagogique de RMed pour un étudiant en PASS. À partir UNIQUEMENT du passage fourni, crée une flashcard utile et précise. Le RECTO doit être une vraie question ou consigne de rappel, pas une copie du cours. Le VERSO doit donner la réponse attendue, concise mais complète. N’invente aucune information absente du passage. Utilise le vocabulaire du passage. Réponds uniquement avec le JSON demandé.";
  }else if(action==="cloze"){
    instructions="Tu es l’IA pédagogique de RMed. Transforme UNIQUEMENT le passage fourni en texte à trous. Utilise {{...}} autour des éléments réellement masqués. N’invente rien. Réponds uniquement avec le JSON demandé.";
  }else if(action==="qcm"){
    instructions="Tu es l’IA pédagogique de RMed pour le PASS. Crée un QCM à partir UNIQUEMENT du passage fourni, avec 2 ou 3 propositions. Une seule proposition doit être correcte. Les distracteurs doivent rester cohérents avec le passage. N’invente aucune information. Réponds uniquement avec le JSON demandé.";
  }else if(action==="chat"){
    instructions="Tu es RMed, assistant pédagogique pour un étudiant en PASS. Réponds à la question en te basant UNIQUEMENT sur les ressources fournies dans le contexte. Cite le nom du cours et le numéro de page quand le contexte le permet. Si l’information n’est pas présente dans les ressources, dis clairement que tu ne la trouves pas dans les cours fournis au lieu d’inventer. Explique simplement mais avec le vocabulaire exact des cours. Réponds uniquement avec le JSON demandé.";
  }else if(action==="qcm_session"){
    instructions="Tu es RMed, générateur de QCM pour le PASS. Crée EXACTEMENT 30 questions à partir UNIQUEMENT des ressources fournies. Chaque question doit avoir 2 ou 3 propositions maximum et une seule bonne réponse. Les pièges doivent rester justifiables par les ressources. N’utilise aucune connaissance extérieure. Varie les formulations et couvre les détails, définitions, localisations, étapes, chiffres et exceptions présents dans les ressources. Donne une explication courte pour chaque correction. Réponds uniquement avec le JSON demandé.";
  }else{
    instructions="Tu es l’IA pédagogique de RMed pour le PASS. Explique UNIQUEMENT le passage fourni, clairement et simplement. Ne complète pas avec des faits extérieurs au passage sauf pour reformuler. Réponds uniquement avec le JSON demandé.";
  }

  const input="PASSAGE DU COURS:\n"+text+"\n\nCONTEXTE/DEMANDE:\n"+context.slice(0,16000);

  try{
    const upstream=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+process.env.OPENAI_API_KEY
      },
      body:JSON.stringify({
        model:process.env.RMED_OPENAI_MODEL||"gpt-5-mini",
        instructions,
        input,
        max_output_tokens:600,
        text:{format:{type:"json_schema",name:selected.name,strict:true,schema:selected.schema}}
      })
    });

    const data=await upstream.json().catch(()=>({}));
    if(!upstream.ok)return json(res,upstream.status,{error:data?.error?.message||"Erreur du service IA."});

    const raw=outputText(data);
    let parsed=null;
    try{parsed=JSON.parse(raw)}catch{}
    if(!parsed)return json(res,502,{error:"La réponse IA n’a pas pu être interprétée."});
    return json(res,200,parsed);
  }catch(err){
    console.error("RMed AI error",err);
    return json(res,500,{error:"Impossible de contacter le service IA."});
  }
};
