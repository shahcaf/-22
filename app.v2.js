// ============================================================
// CONFIGURATION — Edit these values for your Discord server
// ============================================================
const CONFIG = {
  WEBHOOK_URL: 'https://discord.com/api/webhooks/1548426443849990235/-yEi4Dbwr2cbmDXrEwCjUw6fBITijXHVK0pTI_USWB2gf8ampOdRdT0G_vs3Eh_D5KlE',
  SERVER_NAME: 'צוות סקודה',
  // Optional: set a Discord thread ID to post all applications into a specific thread
  THREAD_ID: null,
  // Webhook bot appearance
  WEBHOOK_USERNAME: '📋 צוות סקודה Application System',
  WEBHOOK_AVATAR: 'https://cdn.discordapp.com/emojis/1056479967568371712.png', // set to any image URL or null
  // Embed accent colors
  COLOR_PENDING:  5793266,  // Discord Blurple
  COLOR_APPROVED: 3066993,  // Green
  COLOR_REJECTED: 15158332, // Red
};
// ============================================================

// ============================================================
// ANTI-SPAM CONFIGURATION
// ============================================================
const ANTI_SPAM = {
  // How long (ms) a user must wait before re-submitting (default: 10 minutes)
  COOLDOWN_MS: 10 * 60 * 1000,
  // Key used to store submission metadata in localStorage
  STORAGE_KEY: 'rop_last_submission',
  // Maximum submissions allowed from the same browser per day
  MAX_PER_DAY: 3,
};

function checkAntiSpam(discordId) {
  return { allowed: true };
  try {
    const raw = localStorage.getItem(ANTI_SPAM.STORAGE_KEY);
    if (!raw) return { allowed: true };

    const data = JSON.parse(raw);
    const now = Date.now();

    // Cooldown check
    if (data.lastSubmit) {
      const elapsed = now - data.lastSubmit;
      if (elapsed < ANTI_SPAM.COOLDOWN_MS) {
        const remainingMs = ANTI_SPAM.COOLDOWN_MS - elapsed;
        const mins = Math.ceil(remainingMs / 60000);
        return {
          allowed: false,
          reason: `שלחת מועמדות לאחרונה. אנא המתן/י ${mins} דקות לפני ניסיון נוסף.`,
          remainingMs
        };
      }
    }

    // Daily limit check
    if (data.submissionsToday) {
      const lastDate = new Date(data.lastSubmit).toDateString();
      const today = new Date().toDateString();
      if (lastDate === today && data.submissionsToday >= ANTI_SPAM.MAX_PER_DAY) {
        return {
          allowed: false,
          reason: `הגעת למגבלה של ${ANTI_SPAM.MAX_PER_DAY} מועמדויות היום. אנא נסה/י שוב מחר.`,
          remainingMs: 0
        };
      }
    }

    return { allowed: true };
  } catch (e) {
    return { allowed: true }; // fail-open
  }
}

/**
 * Record a successful submission for anti-spam tracking.
 */
function recordSubmission() {
  try {
    const raw = localStorage.getItem(ANTI_SPAM.STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    const now = Date.now();

    const lastDate = existing.lastSubmit ? new Date(existing.lastSubmit).toDateString() : null;
    const today = new Date().toDateString();
    const todayCount = lastDate === today ? (existing.submissionsToday || 0) : 0;

    localStorage.setItem(ANTI_SPAM.STORAGE_KEY, JSON.stringify({
      lastSubmit: now,
      submissionsToday: todayCount + 1,
    }));
  } catch (e) {
    console.warn('Failed to record submission for anti-spam', e);
  }
}
// ============================================================

// Compress a JSON string using deflate compression and return a URL-safe Base64 string
async function compressPayload(str) {
  try {
    const stream = new Blob([str]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
    const response = new Response(compressedStream);
    const buffer = await response.arrayBuffer();

    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (e) {
    console.error('Failed to compress payload', e);
    return null;
  }
}

// Send webhook with retry logic to handle rate-limits and network failures
async function sendWithRetry(url, body, method, retries, delay) {
  method = method || 'POST';
  retries = retries || 3;
  delay = delay || 1000;
  
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (resp.status === 429) {
        const rateLimitData = await resp.json();
        const retryAfter = (rateLimitData.retry_after * 1000) || delay;
        console.warn(`Rate limited by Discord. Retrying after ${retryAfter}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      
      return resp;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`Request failed. Retrying in ${delay}ms...`, e);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const ROLE_SCHEMAS = {
  discord_staff: {
    title: "צוות סטאף דיסקורד",
    questions: [
      { id: 'hours_active',   label: 'כמה שעות בשבוע תוכל/י להקדיש לשרת?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'לדוגמה: 15', required: true },
      { id: 'why_staff',      label: 'למה אתה/את רוצה להצטרף לצוות שלנו?', type: 'textarea', step: 2, placeholder: 'ספר/י לנו על המוטיבציה שלך...', required: true },
      { id: 'experience',     label: 'איזה ניסיון קודם יש לך במידור / ניהול שרתים?', type: 'textarea', step: 2, placeholder: 'ציין שמות שרתים, גדלים, או תפקידים שמילאת...', required: true },
      { id: 'strengths',      label: 'מה החוזקות המרכזיות שלך?', type: 'textarea', step: 2, placeholder: 'מה מייחד אותך?', required: true },

      { id: 'weaknesses',     label: 'מה החולשות שלך, וכיצד אתה/את מתמודד/ת איתן?', type: 'textarea', step: 3, placeholder: 'היה/י כנה - אנחנו מעריכים מודעות עצמית...', required: true },
      { id: 'stress_handle',  label: 'כיצד אתה/את מתמודד/ת עם מצבי לחץ או קונפליקטים?', type: 'textarea', step: 3, placeholder: 'הסבר/י את מנגנוני ההתמודדות שלך...', required: true },
      { id: 'handle_spam',    label: 'תרחיש: משתמש שולח ספאם של לינקים בצ׳אט. מה אתה/את עושה?', type: 'textarea', step: 3, placeholder: 'פרט/י את תגובתך שלב אחר שלב...', required: true },
      { id: 'handle_argument',label: 'תרחיש: שני חברים מתווכחים בטקסט/קול. כיצד תנסה/י לפייס?', type: 'textarea', step: 3, placeholder: 'כיצד אתה/את מטפל/ת בקונפליקט בין משתמשים?', required: true },

      { id: 'handle_dm_adv',  label: 'תרחיש: חבר מדווח על פרסום פרטי (DM Ads). מה אתה/את עושה?', type: 'textarea', step: 4, placeholder: 'איזו הוכחה אתה/את דורש/ת, ואיזו פעולה תינקט?', required: true },
      { id: 'handle_abuse',   label: 'תרחיש: אתה/את חושד/ת שחבר צוות אחר מנצל לרעה את סמכויותיו. מה אתה/את עושה?', type: 'textarea', step: 4, placeholder: 'כיצד אתה/את מטפל/ת בקונפליקטים פנימיים?', required: true },
      { id: 'handle_nsfw',    label: 'תרחיש: משתמש מפרסם תוכן לא הולם בצ׳אט הכללי. מה תגובתך?', type: 'textarea', step: 4, placeholder: 'אילו פעולות אתה/את נוקט/ת באופן מיידי?', required: true },
      { id: 'handle_unsure',  label: 'אם אינך בטוח/ה בנוגע להחלטת מידור, מה אתה/את עושה?', type: 'textarea', step: 4, placeholder: 'עם מי אתה/את מתייעץ/ת, או כיצד אתה/את מחליט/ה?', required: true },

      { id: 'hobbies',        label: 'מה התחביבים או תחומי העניין שלך מחוץ לדיסקורד?', type: 'textarea', step: 5, placeholder: 'אנחנו רוצים להכיר את האדם שמאחורי המסך!', required: true },
      { id: 'server_mgmt',    label: 'האם יש לך ניסיון בניהול שרתים, בוטים או הגדרות?', type: 'textarea', step: 5, placeholder: 'לדוגמה: הגדרת Dyno, הרשאות, webhooks...', required: true },
      { id: 'guidelines_agree', label: 'האם אתה/את מסכים/ה לעקוב אחר כל הנחיות הצוות ולהישאר פעיל/ה?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'אני מסכים/ה להתנהג בצורה מקצועית, לשמור על כללי השרת ולתקשר עם הצוות.' },
      { id: 'additional_info', label: 'האם יש משהו נוסף שתרצה/י לשתף?', type: 'textarea', step: 5, placeholder: 'כל דבר נוסף שכדאי שנדע?', required: true }
    ]
  },
  media_team: {
    title: "צוות מדיה",
    questions: [
      { id: 'media_role',     label: 'לאיזה תפקיד ספציפי אתה/את מגיש/ה מועמדות?', type: 'select', step: 2, options: ['מעצב/ת גרפי', 'עורך/ת וידאו', 'יוצר/ת תוכן', 'מנהל/ת רשתות חברתיות', 'אחר'], required: true },
      { id: 'hours_active',   label: 'כמה שעות בשבוע תוכל/י להקדיש לעבודת מדיה?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'לדוגמה: 10', required: true },
      { id: 'portfolio',      label: 'ספק/י קישור לתיק העבודות או לעבודות קודמות שלך.', type: 'text', step: 2, placeholder: 'לדוגמה: Behance, ערוץ YouTube, קישור Drive...', required: true, helperText: 'ספק/י קישורים לעיצובים, סרטוני עריכה או ערוצים שלך.' },
      { id: 'tools_used',     label: 'באילו תוכנות/כלים אתה/את מתמחה?', type: 'text', step: 2, placeholder: 'לדוגמה: Photoshop, Premiere Pro, After Effects, Figma, Canva...', required: true },

      { id: 'why_media',      label: 'למה אתה/את רוצה להצטרף לצוות המדיה שלנו?', type: 'textarea', step: 3, placeholder: 'ספר/י לנו למה אתה/את רוצה לעצב/ליצור עבור צוות סקודה...', required: true },
      { id: 'prior_work',     label: 'תאר/י ניסיון קודם ביצירת תוכן מדיה עבור שרתים או ארגונים.', type: 'textarea', step: 3, placeholder: 'תאר/י פרויקטים קודמים ואחריות שלקחת...', required: true },
      { id: 'strengths_media', label: 'מה החוזקות היצירתיות המרכזיות שלך?', type: 'textarea', step: 3, placeholder: 'לדוגמה: עיצוב ויזואלי, גרפיקה בתנועה, עיצוב שמע, מיתוג...', required: true },

      { id: 'handle_negative_feedback', label: 'תרחיש: תוכן שעיצבת/ערכת קיבל פידבק שלילי. כיצד אתה/את מתמודד/ת?', type: 'textarea', step: 4, placeholder: 'הסבר/י את תגובתך ותהליך הפעולה שלך...', required: true },
      { id: 'handle_deadline', label: 'תרחיש: אנחנו צריכים ממך תמונה ממוזערת או סרטון פרסומי בהתראה קצרה (24 שעות). כיצד אתה/את מתמודד/ת?', type: 'textarea', step: 4, placeholder: 'כיצד אתה/את מתמודד/ת עם משימות דחופות?', required: true },
      { id: 'handle_disagreement', label: 'תרחיש: אתה/את לא מסכים/ה עם ראש צוות על כיוון עיצובי. כיצד אתה/את פותר/ת זאת?', type: 'textarea', step: 4, placeholder: 'הסבר/י כיצד אתה/את מתמודד/ת עם חילוקי דעות יצירתיים...', required: true },

      { id: 'hobbies',        label: 'מה התחביבים או תחומי העניין שלך מחוץ לעבודת מדיה?', type: 'textarea', step: 5, placeholder: 'ספר/י לנו על עצמך...', required: true },
      { id: 'guidelines_agree', label: 'האם אתה/את מסכים/ה לעמוד בהנחיות המדיה של צוות סקודה ולייצג את השרת בצורה מקצועית?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'אני מסכים/ה לעמוד בהנחיות העיצוב, להשתמש בנכסים מורשים ולתקשר בצורה מקצועית.' },
      { id: 'additional_info', label: 'האם יש משהו נוסף שתרצה/י לשתף?', type: 'textarea', step: 5, placeholder: 'כל דבר נוסף שכדאי שנדע?', required: true }
    ]
  },

  beta_tester: {
    title: "בודק/ת בטא",
    questions: [
      { id: 'hours_active',      label: 'כמה שעות בשבוע תוכל/י להקדיש לבדיקות?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'לדוגמה: 8', required: true },
      { id: 'roblox_profile',    label: 'ספק/י קישור לפרופיל Roblox שלך.', type: 'text', step: 2, placeholder: 'לדוגמה: https://www.roblox.com/users/123456/profile', required: true },
      { id: 'device_types',      label: 'על אילו פלטפורמות/מכשירים אתה/את משחק/ת ב-Roblox?', type: 'select', step: 2, options: ['PC (Windows/Mac)', 'נייד (iOS)', 'נייד (Android)', 'Xbox / קונסולה', 'מספר פלטפורמות'], required: true },

      { id: 'testing_exp',       label: 'האם יש לך ניסיון קודם בבדיקות בטא או QA? אם כן, תאר/י.', type: 'textarea', step: 3, placeholder: 'ציין/י משחקים, תוכנות או שרתים שבדקת...', required: true },
      { id: 'bug_report',        label: 'כיצד תתאר/י ותדווח/י על באג? הסבר/י את התהליך שלך.', type: 'textarea', step: 3, placeholder: 'מה כלול בדוח הבאג שלך? שלבים לשחזור, חומרה...', required: true },
      { id: 'why_beta',          label: 'למה אתה/את רוצה להיות בודק/ת בטא עבור צוות סקודה?', type: 'textarea', step: 3, placeholder: 'מה מניע אותך לעזור לבדוק ולשפר את הפרויקטים שלנו?', required: true },

      { id: 'scenario_crash',    label: 'תרחיש: אתה/את בסשן בטא והמשחק קורס כל פעם שאתה/את נכנס/ת לאזור מסוים. מה אתה/את עושה?', type: 'textarea', step: 4, placeholder: 'תאר/י בדיוק מה תעשה/י, איזו מידע תאסוף/י וכיצד תדווח/י...', required: true },
      { id: 'scenario_balance',  label: 'תרחיש: מצאת מכניקה שנראית לא הוגנת אך אינה באג טכני. כיצד אתה/את מטפל/ת בזה?', type: 'textarea', step: 4, placeholder: 'כיצד מבחינים בין באג לבעיית עיצוב, וכיצד מדווחים על פידבק סובייקטיבי?', required: true },

      { id: 'confidentiality',   label: 'האם אתה/את מבין/ה שפיצ׳רים בבטא הם סודיים ואסור לשתפם?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'אני מסכים/ה לשמור על סודיות של כל תוכן בטא, פיצ׳רים שטרם שוחררו ופידבקים פנימיים.' },
      { id: 'additional_info',   label: 'האם יש משהו נוסף שתרצה/י לשתף איתנו?', type: 'textarea', step: 5, placeholder: 'כל הקשר נוסף, ניסיון קודם, או כל דבר אחר שכדאי שנדע?', required: true }
    ]
  }
};

// ============================================================
// PLACEHOLDER / NON-INFORMATIVE ANSWER VALIDATION
// ============================================================

/**
 * List of exact-match placeholder terms (case-insensitive, trimmed).
 * Any answer that is exclusively one of these is rejected.
 */
const PLACEHOLDER_TERMS = new Set([
  'n/a', 'na', 'n.a', 'n.a.', 'none', 'not applicable', 'no', '-', '--', '---',
  '.', '..', '...', 'unknown', 'test', 'asdf', 'qwerty', 'asd', 'foo', 'bar',
  'lol', 'idk', 'idc', 'whatever', 'nothing', 'nope', 'nah', 'blank', 'empty',
  'null', 'nil', 'n/a.', 'na.', 'not sure', 'unsure', 'skip', 'no idea',
  'no comment', 'pass', 'same', 'see above', 'as above', '?', '??', '???',
  'hello', 'hi', 'hey', '1', '2', '3', 'a', 'b', 'c', 'x', 'y', 'z',
  'yes', 'no.', 'yes.', 'ok', 'okay', 'sure', 'fine', 'good', 'great',
  'i dont know', "i don't know", 'i do not know', 'no answer', 'random',
  'placeholder', 'example', 'sample', 'temp', 'tbd', 'wip'
]);

/**
 * Returns an object { valid: boolean, reason: string } describing whether
 * the answer passes the placeholder / quality checks.
 *
 * Rules (for text & textarea fields):
 *  1. Trimmed value must not be empty (handled separately).
 *  2. Must not be solely a PLACEHOLDER_TERM.
 *  3. Must contain at least 3 meaningful words (words with ≥2 non-symbol chars).
 *     (Exception: number fields skip the word-count rule.)
 */
function validateAnswerQuality(value, fieldType) {
  const trimmed = value.trim();

  // Normalise to lower-case for set look-up
  const lower = trimmed.toLowerCase();

  // Rule 1 — placeholder term
  if (PLACEHOLDER_TERMS.has(lower)) {
    return {
      valid: false,
      reason: 'אנא ספק/י תשובה מפורטת ותקינה. תשובות קצרות/פנייה לא מקובלות.'
    };
  }

  // Rule 2 — repeated single character or pure punctuation / symbols
  if (/^[^a-zA-Z0-9\u0590-\u05FF]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: 'אנא ספק/י תשובה מפורטת ותקינה. תשובות קצרות/פנייה לא מקובלות.'
    };
  }



  return { valid: true, reason: '' };
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('staff-app-form');
  const stepNodes = document.querySelectorAll('.step-node');
  const progressBar = document.getElementById('progress-indicator');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  const statusCard = document.getElementById('status-card');
  const statusIconSuccess = document.getElementById('status-icon-success');
  const statusIconError = document.getElementById('status-icon-error');
  const statusTitle = document.getElementById('status-title');
  const statusMessage = document.getElementById('status-message');
  const statusResetBtn = document.getElementById('status-reset-btn');
  const dynamicContainer = document.getElementById('dynamic-sections-container');

  let currentStep = 1;
  const totalSteps = 5;

  // Render initial dynamic steps for default selected role
  let selectedRole = document.querySelector('input[name="role"]:checked').value;
  renderDynamicSteps(selectedRole);
  loadFormDraft();
  updateNavigation();

  // Handle Role Selection change
  form.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedRole = e.target.value;
      renderDynamicSteps(selectedRole);
      // If we are past step 1, reset back to step 1 when they change the role to prevent confusion
      if (currentStep > 1) {
        currentStep = 1;
      }
      saveFormDraft();
      updateNavigation();
    });
  });

  nextBtn.addEventListener('click', () => {
    if (validateStep(currentStep)) { currentStep++; updateNavigation(); }
  });
  prevBtn.addEventListener('click', () => {
    if (currentStep > 1) { currentStep--; updateNavigation(); }
  });

  // Attach inputs check for the static inputs in step 1
  form.querySelectorAll('.form-section[data-section="1"] input').forEach(el => {
    el.addEventListener('input', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        const errSpan = el.closest('.form-group')?.querySelector('.error-msg');
        if (errSpan) errSpan.textContent = '';
        saveFormDraft();
    });
    el.addEventListener('change', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        const errSpan = el.closest('.form-group')?.querySelector('.error-msg');
        if (errSpan) errSpan.textContent = '';
        saveFormDraft();
    });
  });

  function renderDynamicSteps(roleKey) {
    const schema = ROLE_SCHEMAS[roleKey];
    dynamicContainer.innerHTML = '';
    
    const steps = [2, 3, 4, 5];
    steps.forEach(stepNum => {
      const section = document.createElement('section');
      section.className = 'form-section';
      section.dataset.section = stepNum;
      
      let stepTitle = '';
      let stepDesc = '';
      if (stepNum === 2) {
        stepTitle = `שלב 2: פרטי תפקיד ומחויבות`;
        stepDesc = `ספק/י פרטים ספציפיים על הזמינות שלך והכישורים לתפקיד.`;
      } else if (stepNum === 3) {
        stepTitle = `שלב 3: רקע ומוטיבציה`;
        stepDesc = `ספר/י לנו למה אתה/את רוצה להצטרף ומה הניסיון שאתה/את מביא/ה.`;
      } else if (stepNum === 4) {
        stepTitle = `שלב 4: תרחישים וקבלת החלטות`;
        stepDesc = `תאר/י כיצד אתה/את מתמודד/ת עם מצבים ספציפיים או קונפליקטים.`;
      } else if (stepNum === 5) {
        stepTitle = `שלב 5: הסכמות ומידע נוסף`;
        stepDesc = `כמעט סיימנו! עיין/י בהנחיות וספק/י פרטים אחרונים.`;
      }
      
      section.innerHTML = `
        <h2 class="section-title">${stepTitle}</h2>
        <p class="section-description">${stepDesc}</p>
      `;
      
      const stepQuestions = schema.questions.filter(q => q.step === stepNum);
      stepQuestions.forEach((q, idx) => {
        const group = document.createElement('div');
        group.className = 'form-group';
        
        let inputHtml = '';
        if (q.type === 'textarea') {
          inputHtml = `<textarea id="${q.id}" name="${q.id}" rows="3" placeholder="${q.placeholder}" ${q.required ? 'required' : ''}></textarea>`;
        } else if (q.type === 'text') {
          inputHtml = `<input type="text" id="${q.id}" name="${q.id}" placeholder="${q.placeholder}" ${q.required ? 'required' : ''}>`;
        } else if (q.type === 'number') {
          inputHtml = `<input type="number" id="${q.id}" name="${q.id}" placeholder="${q.placeholder}" min="${q.min || ''}" max="${q.max || ''}" ${q.required ? 'required' : ''}>`;
        } else if (q.type === 'select') {
          const optionsHtml = q.options.map(o => `<option value="${o}">${o}</option>`).join('');
          inputHtml = `<select id="${q.id}" name="${q.id}" ${q.required ? 'required' : ''}>${optionsHtml}</select>`;
        } else if (q.type === 'checkbox') {
          inputHtml = `
            <label class="checkbox-container" for="${q.id}">
              <input type="checkbox" id="${q.id}" name="${q.id}" value="Yes, I agree" ${q.required ? 'required' : ''}>
              <span class="checkmark"></span>
              <span class="checkbox-label">${q.checkboxLabel}</span>
            </label>
          `;
        }
        
        const labelHtml = q.type === 'checkbox' 
          ? `<label>הסכמה <span class="required">*</span></label>`
          : `<label for="${q.id}">${q.label} ${q.required ? '<span class="required">*</span>' : ''}</label>`;
           
        const helperHtml = q.helperText ? `<small class="helper-text">${q.helperText}</small>` : '';
        const errorMsg = q.type === 'checkbox'
          ? `עליך/עלייך להסכים/ה כדי להמשיך.`
          : `אנא מלא/י שדה זה.`;
        
        group.innerHTML = `
          ${labelHtml}
          ${inputHtml}
          <span class="error-msg" id="error-${q.id}">${errorMsg}</span>
          ${helperHtml}
        `;
        section.appendChild(group);
      });
      
      dynamicContainer.appendChild(section);
    });

    // Attach input event listeners to clear invalid classes, count words, and save draft
    dynamicContainer.querySelectorAll('input, textarea, select').forEach(el => {
      el.addEventListener('input', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        if (el.tagName === 'TEXTAREA') {
          updateWordCount(el);
        }
        saveFormDraft();
      });
      el.addEventListener('change', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        saveFormDraft();
      });
    });
  }

  // Live word counter updater
  function updateWordCount(textarea) {
    const counterSpan = document.getElementById(`word-count-${textarea.id}`);
    if (!counterSpan) return;
    const trimmed = textarea.value.trim();
    if (!trimmed) {
      counterSpan.textContent = '0';
      return;
    }
    const words = trimmed.split(/\s+/).filter(w => (w.match(/[a-zA-Z0-9]/g) || []).length >= 2);
    counterSpan.textContent = words.length;
    
    // Optional: give visual cue if min words met
    const wrapper = textarea.nextElementSibling;
    if (wrapper && wrapper.classList.contains('word-counter-wrapper')) {
      if (words.length >= 3) {
        wrapper.classList.add('met');
      } else {
        wrapper.classList.remove('met');
      }
    }
  }

  // Save form draft to localStorage
  function saveFormDraft() {
    const draft = {
      role: selectedRole,
      static: {
        discord_tag: document.getElementById('discord_tag').value.trim(),
        discord_id: document.getElementById('discord_id').value.trim(),
        age: document.getElementById('age').value.trim(),
        timezone: document.getElementById('timezone').value.trim(),
      },
      dynamic: {}
    };

    const schema = ROLE_SCHEMAS[selectedRole];
    if (schema) {
      schema.questions.forEach(q => {
        const el = document.getElementById(q.id);
        if (el) {
          draft.dynamic[q.id] = el.type === 'checkbox' ? el.checked : el.value;
        }
      });
    }
    localStorage.setItem('rop_application_draft', JSON.stringify(draft));
  }

  // Load draft if it exists
  function loadFormDraft() {
    const raw = localStorage.getItem('rop_application_draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!draft) return;

      // Select role
      if (draft.role && draft.role !== selectedRole) {
        const radio = document.querySelector(`input[name="role"][value="${draft.role}"]`);
        if (radio) {
          radio.checked = true;
          selectedRole = draft.role;
          renderDynamicSteps(selectedRole);
        }
      }

      // Pre-fill static fields
      if (draft.static) {
        if (draft.static.discord_tag) document.getElementById('discord_tag').value = draft.static.discord_tag;
        if (draft.static.discord_id) document.getElementById('discord_id').value = draft.static.discord_id;
        if (draft.static.age) document.getElementById('age').value = draft.static.age;
        if (draft.static.timezone) document.getElementById('timezone').value = draft.static.timezone;
      }

      // Pre-fill dynamic fields
      if (draft.dynamic) {
        Object.keys(draft.dynamic).forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            if (el.type === 'checkbox') {
              el.checked = draft.dynamic[id];
            } else {
              el.value = draft.dynamic[id];
              if (el.tagName === 'TEXTAREA') {
                updateWordCount(el);
              }
            }
          }
        });
      }

      // Show toast notification
      showToast('טיוטה שוחזרה מהביקור האחרון שלך!');
    } catch (e) {
      console.error('Failed to load draft', e);
    }
  }

  // Clear form draft
  function clearFormDraft() {
    localStorage.removeItem('rop_application_draft');
  }

  // Custom toast notifications helper
  function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = message;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 4 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function updateNavigation() {
    const currentSections = document.querySelectorAll('.form-section');
    currentSections.forEach(s => s.classList.toggle('active', parseInt(s.dataset.section) === currentStep));
    stepNodes.forEach(n => {
      const step = parseInt(n.dataset.step);
      n.classList.remove('active', 'completed');
      if (step === currentStep) n.classList.add('active');
      else if (step < currentStep) n.classList.add('completed');
    });
    progressBar.style.width = `${((currentStep - 1) / (totalSteps - 1)) * 100}%`;
    prevBtn.classList.toggle('disabled', currentStep === 1);
    prevBtn.disabled = currentStep === 1;
    nextBtn.classList.toggle('hidden', currentStep === totalSteps);
    submitBtn.classList.toggle('hidden', currentStep !== totalSteps);
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validateStep(step) {
    const section = document.querySelector(`.form-section[data-section="${step}"]`);
    if (!section) return true;
    let isValid = true;
    section.querySelectorAll('input, textarea, select').forEach(input => {
      const group = input.closest('.form-group');
      const errorSpan = group?.querySelector('.error-msg');
      let fieldValid = true;
      let errorText = '';

      if (input.hasAttribute('required')) {
        if (input.type === 'checkbox') {
          fieldValid = input.checked;
          errorText = 'עליך/עלייך להסכים/ה כדי להמשיך.';
        } else {
          fieldValid = input.value.trim() !== '';
          errorText = 'אנא מלא/י שדה זה.';
        }
      }

      // Extra format / range checks
      if (fieldValid) {
        if (input.id === 'discord_id') {
          fieldValid = /^\d{17,19}$/.test(input.value.trim());
          errorText = 'אנא הזן/י מזהה דיסקורד תקין (מספרי, 17-19 ספרות).';
        } else if (input.id === 'age') {
          const v = parseInt(input.value);
          fieldValid = !isNaN(v) && v >= 13 && v <= 100;
          errorText = 'אנא הזן/י גיל תקין (חייב להיות לפחות 13).';
        } else if (input.id === 'hours_active') {
          const v = parseInt(input.value);
          fieldValid = !isNaN(v) && v >= 1 && v <= 168;
          errorText = 'אנא הזן/י מספר בין 1 ל-168.';
        }
      }

      // Placeholder / quality check for text and textarea fields
      if (fieldValid && (input.tagName === 'TEXTAREA' || (input.tagName === 'INPUT' && input.type === 'text'))) {
        const qualityResult = validateAnswerQuality(input.value, input.tagName.toLowerCase());
        if (!qualityResult.valid) {
          fieldValid = false;
          errorText = qualityResult.reason;
        }
      }

      // Apply or clear invalid state
      if (errorSpan) errorSpan.textContent = errorText || 'אנא מלא/י שדה זה.';
      group?.classList.toggle('invalid', !fieldValid);
      if (!fieldValid) isValid = false;
    });

    if (!isValid) {
      // Shake the card on error
      const card = document.querySelector('.form-card');
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
    }

    return isValid;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(currentStep)) return;

    const schema = ROLE_SCHEMAS[selectedRole];
    const payload = {
      role: selectedRole,
      role_title: schema.title
    };

    // Static fields
    payload.discord_tag = document.getElementById('discord_tag').value.trim();
    payload.discord_id = document.getElementById('discord_id').value.trim();
    payload.age = document.getElementById('age').value.trim();
    payload.timezone = document.getElementById('timezone').value.trim();

    // Dynamic fields
    schema.questions.forEach(q => {
      const el = document.getElementById(q.id);
      if (el) {
        payload[q.id] = el.type === 'checkbox' ? (el.checked ? 'Yes, I agree' : '') : el.value.trim();
      }
    });

    // ─── Anti-Spam Guard ────────────────────────────────────────────
    const spamCheck = checkAntiSpam(payload.discord_id);
    if (!spamCheck.allowed) {
      // Show shake + toast without hiding the form
      const card = document.querySelector('.form-card');
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
      showToast(`⛔ ${spamCheck.reason}`);
      return;
    }
    // ────────────────────────────────────────────────────────────────

    // Show loading
    form.classList.add('hidden');
    document.querySelector('.progress-container').classList.add('hidden');
    statusCard.classList.remove('hidden');
    statusIconSuccess.classList.add('hidden');
    statusIconError.classList.add('hidden');
    statusTitle.innerText = 'שולח/ת...';
    statusMessage.innerText = 'שולח/ת את המועמדות שלך לדיסקורד. אנא המתן/י.';
    statusResetBtn.classList.add('hidden');

    try {
      // Build review URL (for the Approve/Reject links in the embed)
      let reviewBase = 'https://shahcaf.github.io/rop-apply/review.html';
      if (window.location.protocol.startsWith('http')) {
        reviewBase = window.location.origin + window.location.pathname.replace('index.html', '') + 'review.html';
      }
      const jsonStr = JSON.stringify(payload);
      let answersParam = encodeURIComponent(jsonStr);

      if (typeof CompressionStream !== 'undefined') {
        const compressed = await compressPayload(jsonStr);
        if (compressed) {
          answersParam = 'c:' + compressed;
        }
      }

      const encodedTag = encodeURIComponent(payload.discord_tag);
      const tempMsgId = 'TEMP_MSG_ID';

      // Helper to generate review URLs safely (omits answers parameter if it exceeds Discord's 2000-character URL limit)
      const makeReviewUrls = (msgId, includeAnswers) => {
        let appr = `${reviewBase}?action=approve&tag=${encodedTag}&message_id=${msgId}`;
        let rej  = `${reviewBase}?action=reject&tag=${encodedTag}&message_id=${msgId}`;
        
        if (includeAnswers && answersParam) {
          const testAppr = `${appr}&answers=${answersParam}`;
          if (testAppr.length < 2000) {
            appr = testAppr;
            rej = `${rej}&answers=${answersParam}`;
          }
        }
        return { approveUrl: appr, rejectUrl: rej };
      };

      // Format field helper with truncation
      const formatEmbedValue = (val, maxLen) => {
        const text = val || 'N/A';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '… *(truncated — view full in portal)*';
      };

      // Safe value helper — Discord rejects empty-string field values
      const safeVal = (v) => (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : 'N/A';

      // Submission timestamp (Discord relative)
      const submittedAt = `<t:${Math.floor(Date.now() / 1000)}:F>`;

      const getEmbedJson = (msgId, includeAnswers, maxValLen) => {
        const urls = makeReviewUrls(msgId, includeAnswers);
        
        const fields = [
          { name: '📋 Applied Role',       value: safeVal(schema.title),         inline: true },
          { name: '🏷️ Discord Username',   value: safeVal(payload.discord_tag),  inline: true },
          { name: '🆔 Discord User ID',    value: `\`${safeVal(payload.discord_id)}\``, inline: true },
          { name: '🎂 Age',                value: safeVal(payload.age),          inline: true },
          { name: '🌍 Timezone',           value: safeVal(payload.timezone),     inline: true },
          { name: '⏱️ Hours / Week',       value: payload.hours_active ? `**${payload.hours_active} hrs**` : 'N/A', inline: true },
        ];

        if (payload.media_role) {
          fields.push({ name: '🎨 Specialization', value: payload.media_role, inline: true });
        } else if (payload.dev_role) {
          fields.push({ name: '💻 Developer Role', value: payload.dev_role, inline: true });
        }

        if (payload.portfolio) {
          fields.push({ name: '🔗 Portfolio', value: payload.portfolio, inline: true });
        }
        if (payload.roblox_profile) {
          fields.push({ name: '🎮 Roblox Profile', value: payload.roblox_profile, inline: true });
        }

        fields.push({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━', inline: false });

        const profileKeys = ['hours_active', 'media_role', 'dev_role', 'roblox_profile', 'portfolio', 'guidelines_agree'];
        const detailQuestions = schema.questions.filter(q => !profileKeys.includes(q.id));

        detailQuestions.forEach((q, idx) => {
          fields.push({
            name: `${idx + 1}. ${q.label}`,
            value: formatEmbedValue(payload[q.id], maxValLen),
            inline: false
          });
        });

        return {
          title: `📝 New Application — ${payload.discord_tag}`,
          description:
            `A new **${schema.title}** application was submitted.\n\n` +
            `> 📅 Submitted: ${submittedAt}\n\n` +
            `**⚡ Quick Actions:**\n` +
            `• [🟢 Open Portal & Approve](${urls.approveUrl})\n` +
            `• [🔴 Open Portal & Reject](${urls.rejectUrl})`,
          color: CONFIG.COLOR_PENDING,
          fields,
          footer: {
            text: `${CONFIG.SERVER_NAME} • Staff Application Portal`,
          },
          timestamp: new Date().toISOString()
        };
      };

      const calculateEmbedLength = (embedObj) => {
        let len = 0;
        if (embedObj.title) len += embedObj.title.length;
        if (embedObj.description) len += embedObj.description.length;
        if (embedObj.footer && embedObj.footer.text) len += embedObj.footer.text.length;
        if (embedObj.author && embedObj.author.name) len += embedObj.author.name.length;
        if (embedObj.fields) {
          for (const field of embedObj.fields) {
            if (field.name) len += field.name.length;
            if (field.value) len += field.value.length;
          }
        }
        return len;
      };

      // Select best fit parameters to keep embed size under 6000 limit
      let chosenParams = null;
      let bestEmbed = null;
      const attemptParams = [
        { includeAnswers: true, maxValLen: 300 },
        { includeAnswers: true, maxValLen: 200 },
        { includeAnswers: false, maxValLen: 300 },
        { includeAnswers: false, maxValLen: 200 },
        { includeAnswers: false, maxValLen: 120 },
        { includeAnswers: false, maxValLen: 80 }
      ];

      for (const params of attemptParams) {
        const embed = getEmbedJson(tempMsgId, params.includeAnswers, params.maxValLen);
        const embedLen = calculateEmbedLength(embed);
        if (embedLen <= 5800) {
          bestEmbed = embed;
          chosenParams = params;
          console.log(`Chose embed with includeAnswers=${params.includeAnswers}, maxValLen=${params.maxValLen} (length: ${embedLen})`);
          break;
        }
      }

      if (!chosenParams) {
        chosenParams = { includeAnswers: false, maxValLen: 50 };
        bestEmbed = getEmbedJson(tempMsgId, chosenParams.includeAnswers, chosenParams.maxValLen);
      }

      const buildWebhookPayload = (msgId) => {
        const body = {
          username: CONFIG.WEBHOOK_USERNAME,
          embeds: [getEmbedJson(msgId, chosenParams.includeAnswers, chosenParams.maxValLen)]
        };
        if (CONFIG.WEBHOOK_AVATAR) body.avatar_url = CONFIG.WEBHOOK_AVATAR;
        return body;
      };

      // 1. Build the post URL (with optional thread_id)
      let postUrl = CONFIG.WEBHOOK_URL + '?wait=true';
      if (CONFIG.THREAD_ID) postUrl += `&thread_id=${CONFIG.THREAD_ID}`;

      // 2. Post to webhook
      const initialPayload = buildWebhookPayload(tempMsgId);
      const resp = await sendWithRetry(postUrl, initialPayload, 'POST');

      if (resp.ok || resp.status === 204) {
        const respData = await resp.json();
        const messageId = respData.id;

        if (messageId) {
          // 3. Re-create URLs with the actual messageId
          const finalPayload = buildWebhookPayload(messageId);

          // 4. PATCH the message to update the portal links
          let patchUrl = `${CONFIG.WEBHOOK_URL}/messages/${messageId}`;
          if (CONFIG.THREAD_ID) patchUrl += `?thread_id=${CONFIG.THREAD_ID}`;
          await sendWithRetry(patchUrl, finalPayload, 'PATCH');
        }

        // Success!
        recordSubmission(); // anti-spam: log this submission
        clearFormDraft();

        statusTitle.innerText = '✅ המועמדות נשלחה!';
        statusMessage.innerText = 'המועמדות שלך נשלחה בהצלחה לערוץ הסקירה של הצוות. תקבל/י הודעה בדיסקורד לאחר קבלת החלטה. תודה שנרשמת/ה!';  
        statusIconSuccess.classList.remove('hidden');
      } else {
        const err = await resp.text();
        throw new Error(`Discord returned ${resp.status}: ${err}`);
      }
    } catch (error) {
      statusTitle.innerText = 'שליחה נכשלה';
      statusMessage.innerText = error.message || 'לא ניתן היה לשלוח את המועמדות. אנא בדוק/י את החיבור לאינטרנט ונסה/י שוב.';
      statusIconError.classList.remove('hidden');
      statusResetBtn.classList.remove('hidden');
    }
  });

  statusResetBtn.addEventListener('click', () => {
    statusCard.classList.add('hidden');
    document.querySelector('.progress-container').classList.remove('hidden');
    form.classList.remove('hidden');
    currentStep = 1;
    updateNavigation();
  });

  // Timezone Auto-detection
  function autofillTimezone() {
    const timezoneInput = document.getElementById('timezone');
    if (timezoneInput && !timezoneInput.value) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset();
        const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
        const offsetRemainingMinutes = Math.abs(offsetMinutes) % 60;
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const offsetStr = `GMT${sign}${offsetHours}${offsetRemainingMinutes ? ':' + String(offsetRemainingMinutes).padStart(2, '0') : ''}`;
        
        timezoneInput.value = `${offsetStr} (${tz})`;
        saveFormDraft();
      } catch (e) {
        console.warn('Failed to auto-detect timezone', e);
      }
    }
  }

  // Discord ID Input Sanitization / Extraction
  const discordIdInput = document.getElementById('discord_id');
  if (discordIdInput) {
    discordIdInput.addEventListener('blur', () => {
      const raw = discordIdInput.value.trim();
      const matched = raw.match(/\d{17,19}/);
      if (matched) {
        discordIdInput.value = matched[0];
        saveFormDraft();
      }
    });
    discordIdInput.addEventListener('input', () => {
      const raw = discordIdInput.value.trim();
      // If user pasted a full tag/mention like <@123456789012345678>
      if (raw.includes('<@') && raw.includes('>')) {
        const matched = raw.match(/\d{17,19}/);
        if (matched) {
          discordIdInput.value = matched[0];
          saveFormDraft();
        }
      }
    });
  }

  // Discord ID Help Toggle
  const helpBtn = document.getElementById('discord-id-helper-btn');
  const helpBox = document.getElementById('discord-id-helper-box');
  if (helpBtn && helpBox) {
    helpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      helpBox.classList.toggle('hidden');
      helpBtn.classList.toggle('active');
    });
  }

  // Keyboard Shortcuts (Enter for next, Ctrl + Enter for textarea next)
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.target.tagName === 'TEXTAREA') {
        if (e.ctrlKey) {
          e.preventDefault();
          if (currentStep === totalSteps) {
            form.requestSubmit();
          } else {
            nextBtn.click();
          }
        }
      } else {
        e.preventDefault();
        if (currentStep === totalSteps) {
          form.requestSubmit();
        } else {
          nextBtn.click();
        }
      }
    }
  });

  // Run timezone auto-detection on load
  autofillTimezone();

  // --- Theme Dropdown Menu Control ---
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeMenu = document.getElementById('theme-dropdown-menu');
  const themeOptions = document.querySelectorAll('.theme-option');

  if (themeToggleBtn && themeMenu) {
    // Load saved theme
    const savedTheme = localStorage.getItem('rop-theme') || 'dark';
    applyTheme(savedTheme);

    // Toggle menu dropdown
    themeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = themeToggleBtn.getAttribute('aria-expanded') === 'true';
      themeToggleBtn.setAttribute('aria-expanded', !isExpanded);
      themeMenu.classList.toggle('hidden');
    });

    // Select theme option
    themeOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        const selected = opt.getAttribute('data-theme');
        applyTheme(selected);
        localStorage.setItem('rop-theme', selected);
        
        // Close menu
        themeToggleBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
        showToast(`ערכת הנושא שונתה ל-${selected.toUpperCase()}!`);
      });
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!themeToggleBtn.contains(e.target) && !themeMenu.contains(e.target)) {
        themeToggleBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
      }
    });

    function applyTheme(themeName) {
      document.body.classList.remove('light-mode', 'cyber-mode', 'forest-mode');
      if (themeName !== 'dark') {
        document.body.classList.add(`${themeName}-mode`);
      }
      // Update active list classes
      themeOptions.forEach(opt => {
        const isMatched = opt.getAttribute('data-theme') === themeName;
        opt.classList.toggle('active', isMatched);
      });
    }
  }

  // --- Interactive Particle Background ---
  const canvas = document.getElementById('particle-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let particlesArray = [];
    let mouse = { x: null, y: null, radius: 100 };

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.x;
      mouse.y = e.y;
    });

    window.addEventListener('mouseout', () => {
      mouse.x = null;
      mouse.y = null;
    });

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 0.6 - 0.3;
        this.speedY = Math.random() * 0.6 - 0.3;
      }
      update() {
        this.x += this.speedX;
        this.y += this.speedY;

        // Wrap around borders
        if (this.x > canvas.width) this.x = 0;
        else if (this.x < 0) this.x = canvas.width;
        if (this.y > canvas.height) this.y = 0;
        else if (this.y < 0) this.y = canvas.height;

        // Mouse attraction/repulsion
        if (mouse.x != null && mouse.y != null) {
          let dx = mouse.x - this.x;
          let dy = mouse.y - this.y;
          let distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < mouse.radius) {
            const force = (mouse.radius - distance) / mouse.radius;
            this.x -= dx / distance * force * 1.5;
            this.y -= dy / distance * force * 1.5;
          }
        }
      }
      draw() {
        const isLight = document.body.classList.contains('light-mode');
        const isCyber = document.body.classList.contains('cyber-mode');
        const isForest = document.body.classList.contains('forest-mode');
        if (isCyber) {
          ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
        } else if (isForest) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
        } else {
          ctx.fillStyle = isLight ? 'rgba(88, 101, 242, 0.22)' : 'rgba(255, 255, 255, 0.15)';
        }
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function initParticles() {
      particlesArray = [];
      const numberOfParticles = Math.floor((canvas.width * canvas.height) / 15000);
      for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle());
      }
    }
    initParticles();
    window.addEventListener('resize', initParticles);

    function connectParticles() {
      const maxDistance = 110;
      for (let a = 0; a < particlesArray.length; a++) {
        for (let b = a; b < particlesArray.length; b++) {
          let dx = particlesArray[a].x - particlesArray[b].x;
          let dy = particlesArray[a].y - particlesArray[b].y;
          let distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < maxDistance) {
            let alpha = (1 - (distance / maxDistance)) * 0.12;
            const isLight = document.body.classList.contains('light-mode');
            const isCyber = document.body.classList.contains('cyber-mode');
            const isForest = document.body.classList.contains('forest-mode');
            if (isCyber) {
              ctx.strokeStyle = `rgba(255, 0, 127, ${alpha * 1.5})`;
            } else if (isForest) {
              ctx.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
            } else {
              ctx.strokeStyle = isLight 
                ? `rgba(88, 101, 242, ${alpha})` 
                : `rgba(255, 255, 255, ${alpha})`;
            }
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particlesArray[a].x, particlesArray[a].y);
            ctx.lineTo(particlesArray[b].x, particlesArray[b].y);
            ctx.stroke();
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
      }
      connectParticles();
      requestAnimationFrame(animate);
    }
    animate();
  }
});
