// Rule-based red-flag screening (port of ReportSimple safety.py). Runs BEFORE any AI answer. No AI involved.
export const EMERGENCY_NUMBER="999"; // Bangladesh national emergency number
const EMERGENCY=[
  ["breathing","Severe trouble breathing",/can'?t breathe|cannot breathe|struggling to breathe|severe shortness of breath|শ্বাস নিতে পারছি না|শ্বাসকষ্ট (খুব|তীব্র)/i],
  ["unconscious","Fainting / unconscious",/unconscious|passed out|not responding|অজ্ঞান/i],
  ["seizure","Seizure",/seizure|convulsion|fitting|খিঁচুনি/i],
  ["stroke","Possible stroke signs",/face (is )?droop|slurred speech|sudden weakness|sudden numbness|can'?t speak|মুখ বেঁকে|কথা জড়িয়ে/i],
  ["bleeding","Heavy bleeding",/heavy bleeding|bleeding (won'?t|will not) stop|vomiting blood|coughing (up )?blood|প্রচুর রক্ত|রক্তবমি/i],
  ["self_harm","Thoughts of self-harm",/suicid|kill myself|want to die|end my life|আত্মহত্যা|মরে যেতে চাই/i],
  ["anaphylaxis","Possible severe allergic reaction",/throat (is )?(closing|swelling)|swollen (tongue|lips) and|anaphyla/i]
];
const CHEST=/chest|বুক/i;
const CHEST_COMPANIONS=/short(ness)? of breath|breathless|sweat|cold sweat|jaw|left arm|arm pain|dizz|faint|nause|শ্বাসকষ্ট|ঘাম|মাথা ঘুরছে|বাম হাত/i;
const ACTIONS={
  emergency:`Get emergency care now. Call ${EMERGENCY_NUMBER} or go to the nearest emergency department. Do not wait for this app.`,
  urgent:"See a doctor soon, ideally today. Go to emergency care if it gets worse.",
  routine:"Talk to a doctor if it continues or worries you."
};
export function checkRedFlags(text=""){
  const t=String(text||"").toLowerCase(),flags=[];let level="routine";
  for(const [id,message,rx] of EMERGENCY) if(rx.test(t)){flags.push({id,message});level="emergency";}
  if(CHEST.test(t)){
    if(CHEST_COMPANIONS.test(t)||/(\d+)\s*(min|minute)/.test(t)&&Number(t.match(/(\d+)\s*(min|minute)/)[1])>=15){flags.push({id:"chest_pain",message:"Chest pain with warning signs"});level="emergency";}
    else if(level==="routine"){flags.push({id:"chest_pain_any",message:"Chest pain should be checked by a doctor"});level="urgent";}
  }
  return {level,flags,action:ACTIONS[level],emergencyNumber:EMERGENCY_NUMBER};
}
