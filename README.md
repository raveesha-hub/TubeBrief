# TubeBrief – YouTube AI Summarizer

HTML + CSS + JS + Node.js • Gemini API • Firebase (Auth + Firestore) • Red/White, Dark/Light mode

## Run (npm install ඕන නෑ)
1. `cp .env.example .env` → `GEMINI_API_KEY` දාන්න (https://aistudio.google.com)
2. `node server.js` → http://localhost:3000

## Firebase (history + login)
1. console.firebase.google.com → Project → Add web app → config copy
2. `public/firebase-config.js` එකට paste
3. Authentication → Sign-in method → Google + Email/Password enable
4. Firestore Database create → Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/history/{doc} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
Firebase config නැතත් site එක වැඩ කරනවා — history එක browser එකේ (localStorage) save වෙනවා.

## Notes
- Gemini API key එක server එකේ (.env) විතරයි — frontend එකට යන්නේ නෑ.
- Video එක Gemini එකට කෙලින්ම YouTube URL එකෙන් දෙන නිසා transcript library ඕන නෑ (public videos). බැරි වුණොත් transcript paste කරන්න.
- Deploy: Node server එක Render/Railway/Cloud Run වල host කරන්න. (Firebase Hosting static විතරයි.)
