// הגדרות ציבוריות של האתר (אין כאן סודות – הריפו ציבורי).
window.APP_CONFIG = {
  // כתובת ה-Web App של Apps Script (…/exec)
  apiUrl: 'https://script.google.com/macros/s/AKfycbxwqe_5QrTk0Sk5Z_lE4KKR2PKdZqJ4hhWSWjlEI9rHAT9UZrYqFtOa3ZiGgshiaBHH2Q/exec',
  // OAuth Client ID של "כניסה עם גוגל" (לא סוד)
  clientId: '501145879579-23ine6ghf2rktha3nsq5for5rl5qsich.apps.googleusercontent.com',
  // הודעת הווטסאפ המוכנה. {name} = השם הפרטי של הליד, {me} = שם השולח
  waTemplate: 'היי {name}, כאן {me} מ-Liel Fitness 🙂 ראיתי שהשארת פרטים, מתי נוח לך שנדבר?',
  senderNames: { admin: 'ליאל', leads: 'שי' },
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
