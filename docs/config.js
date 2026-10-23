// הגדרות ציבוריות של האתר (אין כאן סודות – הריפו ציבורי).
window.APP_CONFIG = {
  // כתובת ה-Web App של Apps Script (…/exec)
  apiUrl: 'https://script.google.com/macros/s/AKfycbxwqe_5QrTk0Sk5Z_lE4KKR2PKdZqJ4hhWSWjlEI9rHAT9UZrYqFtOa3ZiGgshiaBHH2Q/exec',
  // OAuth Client ID של "כניסה עם גוגל" (לא סוד)
  clientId: '501145879579-23ine6ghf2rktha3nsq5for5rl5qsich.apps.googleusercontent.com',
  // הודעת הווטסאפ המוכנה. {name} = השם הפרטי של הליד, {me} = שם השולח
  waTemplate: 'היי {name}, כאן {me} מ-Liel Fitness 🙂 ראיתי שהשארת פרטים, מתי נוח לך שנדבר?',
  senderNames: { admin: 'ליאל', leads: 'שי' },
  // התראות Push (Firebase). לא סודות – מותר בריפו הציבורי. ריק = רק מרכז ההתראות באפליקציה.
  firebase: {
    apiKey: 'AIzaSyDQvRYDFMr4_EEA5J8oYG4yIHVXc6_ZZzg',
    authDomain: 'liel-app.firebaseapp.com',
    projectId: 'liel-app',
    storageBucket: 'liel-app.firebasestorage.app',
    messagingSenderId: '673299519677',
    appId: '1:673299519677:web:8805a45f7e0800ebf8ffd4',
  },
  // Cloud Messaging ← Web Push certificates (מפתח ציבורי)
  vapidKey: 'BMmLwP3VmcUgBmniNJQZn57QbyIlmxg36VUUM2PmPA7jyp3K7rVCMeJRFcqG-dN1NjKPPMlsyyy8B_b87Ej-MDY',
  // הודעת אישור לליד אחרי קביעת זום. {name} שם פרטי, {day} יום בשבוע, {date} DD.MM, {time} HH:mm (שעון ישראל)
  zoomConfirmTemplate: [
    'היי {name} זאת שי :)',
    'אז קבענו ליום {day} {date} בשעה {time}',
    'לכל שינוי או עדכון בבקשה לעדכן כמה שיותר מראש 🙏',
    '',
    'יש לך כאן מידע רלוונטי על הליווי',
    'וגם מה המאמנים מספרים - שווה לעבור עליו לפני הפגישה ☺️',
    'https://www.lielfitness.co.il/lp',
    '',
    'ועוד שני קישורים רלוונטים:',
    '',
    'ערוץ ווטסאפ למאמנים ⬇️',
    'https://whatsapp.com/channel/0029VbDRz5cEawdtrUWQxk0g',
    '',
    'האינסטגרם של ליאל ⬇️',
    'https://www.instagram.com/liel_fitness',
  ].join('\n'),
};
