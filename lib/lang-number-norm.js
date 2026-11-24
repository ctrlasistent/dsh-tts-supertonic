/**
 * lib/lang-number-norm.js — spoken-form number normalization for Supertonic 3.
 *
 * Architecture: a shared engine works over the tables in the LANGS registry.
 * Croatian is the default and only active language; 
 * (EN is kept as a template).
 * 
 * Anyone can add support for another language
 * by adding its table to the registry!
 *
 * Usage:
 *   import { normalizeForSpeech } from 'dsh-tts-supertonic/lib/lang-number-norm.js'
 *   normalizeForSpeech('8 + 99 = 107', 'hr') // "osam plus devedeset devet jednako sto sedam"
 */

// The language codes officially supported by Supertonic 3 (supertonic/config.py);
// an unknown code falls back to DEFAULT_LANGUAGE.
export const SUPERTONIC_LANGUAGES = Object.freeze([
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr',
  'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk',
  'sl', 'sv', 'tr', 'uk', 'vi',
])

export const DEFAULT_LANGUAGE = 'hr'

// ---------------------------------------------------------------------------
// Shared engine (works over the contract, not over individual languages)
// ---------------------------------------------------------------------------

/** Slavic noun forms: 1 / 2–4 / 5+ (11–14 falls into "many"). */
export function slavicForm(n, forms) {
  const lastTwo = n % 100
  const last = n % 10

  if (lastTwo >= 11 && lastTwo <= 14) return forms[2] ?? forms[1] ?? forms[0]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1] ?? forms[0]

  return forms[2] ?? forms[1] ?? forms[0]
}

/** Numbers 0–999 in words, according to the language's tables. */
function belowThousand(n, lang) {
  if (n === 0) return ''

  const parts = []
  const h = Math.floor(n / 100)
  const rest = n % 100

  if (h) parts.push(lang.hundreds[h])

  if (rest) {
    if (rest < 10) {
      parts.push(lang.ones[rest])
    } else if (rest < 20) {
      parts.push(lang.teens[rest - 10])
    } else {
      const t = Math.floor(rest / 10)
      const o = rest % 10
      const composed = lang.composeTensOnes?.(t, o)
      parts.push(composed ?? (o ? `${lang.tens[t]} ${lang.ones[o]}` : lang.tens[t]))
    }
  }

  return parts.join(' ')
}

/** Whole number in words (without sign). Supports up to 10^15 (exclusive). */
function intToWords(n, lang) {
  if (n === 0) return lang.zero
  if (!Number.isFinite(n) || n < 0) return ''
  n = Math.floor(n)
  if (n >= 1e15) return String(n) // astronomically large: leave as digits

  const parts = []

  // scales[0] = thousands, scales[1] = millions, scales[2] = billions, scales[3] = trillions
  for (let k = lang.scales.length; k >= 1; k--) {
    const value = Math.floor(n / 1000 ** k) % 1000
    if (!value) continue

    const scale = lang.scales[k - 1]
    let count = scale.count ? scale.count(value, lang) : belowThousand(value, lang)
    // hr: "jedan milijun" -> just "milijun" (omitOneScale)
    if (lang.omitOneScale && count === lang.ones[1]) count = ''
    const unit = scale.unit(value)
    parts.push(count ? `${count} ${unit}` : unit)
  }

  const rest = n % 1000
  if (rest) parts.push(belowThousand(rest, lang))

  return parts.join(' ')
}

/** Digit by digit, according to the language's tables. */
function spellDigits(digitString, lang) {
  return String(digitString)
    .split('')
    .map((d) => (/\d/.test(d) ? lang.ones[Number(d)] : d))
    .join(' ')
}

/**
 * Digit string into words. Leading zeros ("007") and strings that are too long
 * (>15 digits, e.g. card numbers) are spelled out digit by digit, because as
 * numbers they could not be rendered correctly.
 */
function integerStringToWords(digits, lang) {
  if ((digits.length > 1 && digits.startsWith('0')) || digits.length > 15) {
    return spellDigits(digits, lang)
  }

  return intToWords(Number(digits), lang)
}

/** "3" + "14" */
function decimalToWords(intStr, decStr, lang) {
  const decWords = lang.decimalDigits
    ? spellDigits(decStr, lang)
    : intToWords(Number(decStr), lang)

  return `${integerStringToWords(intStr, lang)} ${lang.sep} ${decWords}`
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** Croatian: "tisuća" is feminine (dvije tisuće, dvadeset jedna tisuća...). */
function hrThousandCount(value, lang) {
  if (value === 1) return ''

  const words = belowThousand(value, lang)
  const lastTwo = value % 100

  // 11–14 does not change the gender of the final digit.
  if (lastTwo >= 11 && lastTwo <= 14) return words
  if (value % 10 === 1) return words.replace(/\bjedan$/u, 'jedna')
  if (value % 10 === 2) return words.replace(/\bdva$/u, 'dvije')
  return words
}

const HR = {
  code: 'hr',
  zero: 'nula',
  negative: 'minus',
  omitOneScale: true, // hr: "milijun", not "jedan milijun"; "tisuća", not "jedan tisuća"
  ones: ['nula', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'],
  teens: ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'],
  tens: ['', 'deset', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'],
  hundreds: ['', 'sto', 'dvjesto', 'tristo', 'četiristo', 'petsto', 'šeststo', 'sedamsto', 'osamsto', 'devetsto'],
  decimalDigits: true, // "3,14" -> "tri zarez jedan četiri"
  sep: 'zarez',
  decimalSep: ',',
  groupSep: '.', // in hr: dot = thousands separator, comma = decimal separator
  symbols: {
    plus: 'plus',
    minus: 'minus',
    times: 'puta',
    dividedBy: 'podijeljeno s',
    equals: 'jednako',
    notEquals: 'nije jednako',
    greaterThan: 'veće od',
    lessThan: 'manje od',
    greaterOrEqual: 'veće ili jednako',
    lessOrEqual: 'manje ili jednako',
    percent: 'posto',
    degree: (v) => slavicForm(v, ['stupanj', 'stupnja', 'stupnjeva']),
    celsius: (v) => `${slavicForm(v, ['stupanj', 'stupnja', 'stupnjeva'])} Celzija`,
    power: 'na potenciju',
    squared: 'na kvadrat',
    cubed: 'na kub',
    sqrt: 'kvadratni korijen iz',
    kilometer: (v) => slavicForm(v, ['kilometar', 'kilometra', 'kilometara']),
    kilometersPerHour: (v) => `${slavicForm(v, ['kilometar', 'kilometra', 'kilometara'])} po satu`,
  },
  scales: [
    {
      unit: (v) => (v === 1 ? 'tisuću' : slavicForm(v, ['tisuća', 'tisuće', 'tisuća'])),
      count: hrThousandCount,
    },
    { unit: (v) => slavicForm(v, ['milijun', 'milijuna', 'milijuna']) },
    // "milijarda" is feminine (dvije milijarde, dvadeset jedna milijarda)
    { unit: (v) => slavicForm(v, ['milijarda', 'milijarde', 'milijardi']), count: hrThousandCount },
    { unit: (v) => slavicForm(v, ['bilijun', 'bilijuna', 'bilijuna']) },
  ],
}

/** Template for future languages — shows the minimum that needs to be defined. */
const EN = {
  code: 'en',
  zero: 'zero',
  negative: 'minus',
  ones: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  teens: ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
  tens: ['', 'ten', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
  hundreds: ['', 'one hundred', 'two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred'],
  decimalDigits: true, // "3.14" -> "three point one four"
  sep: 'point',
  decimalSep: '.',
  groupSep: ',', // in en: comma = thousands separator, dot = decimal separator
  symbols: {
    plus: 'plus',
    minus: 'minus',
    times: 'times',
    dividedBy: 'divided by',
    equals: 'equals',
    notEquals: 'is not equal to',
    greaterThan: 'greater than',
    lessThan: 'less than',
    greaterOrEqual: 'greater or equal to',
    lessOrEqual: 'less or equal to',
    percent: 'percent',
    degree: (v) => (v === 1 ? 'degree' : 'degrees'),
    celsius: (v) => (v === 1 ? 'degree Celsius' : 'degrees Celsius'),
    power: 'to the power of',
    squared: 'squared',
    cubed: 'cubed',
    sqrt: 'square root of',
    kilometer: (v) => (v === 1 ? 'kilometer' : 'kilometers'),
    kilometersPerHour: (v) => (v === 1 ? 'kilometer per hour' : 'kilometers per hour'),
  },
  scales: [
    { unit: () => 'thousand' },  // "a thousand" tends to be omitted by the TTS
    { unit: () => 'million' },
    { unit: () => 'billion' },
    { unit: () => 'trillion' },
  ],
}

const LANGS = { hr: HR, en: EN } // a new language = a new object here

function resolveLanguage(code) {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0]
  return LANGS[base] ?? LANGS[DEFAULT_LANGUAGE]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function numberToWords(value, langCode = DEFAULT_LANGUAGE) {
  const n = typeof value === 'string' ? Number(value) : value

  if (value === '' || !Number.isFinite(n)) return String(value)

  const lang = resolveLanguage(langCode)
  const abs = Math.abs(n)
  let words

  if (Number.isInteger(abs) || String(abs).includes('e')) {
    words = intToWords(abs, lang)
  } else {
    const [intStr, decStr] = String(abs).split('.')
    words = decimalToWords(intStr, decStr, lang)
  }

  return n < 0 ? `${lang.negative} ${words}` : words
}

/** Digit by digit: "350" */
export function digitsToWords(digitString, langCode = DEFAULT_LANGUAGE) {
  return spellDigits(digitString, resolveLanguage(langCode))
}

const COMPARISON_KEYS = {
  '!=': 'notEquals', '≠': 'notEquals',
  '>=': 'greaterOrEqual', '≥': 'greaterOrEqual',
  '<=': 'lessOrEqual', '≤': 'lessOrEqual',
  '==': 'equals',
  '>': 'greaterThan',
  '<': 'lessThan',
}

/**
 * Expand digits, decimals and mathematical symbols into spoken words.
 * Safe on plain text: text without numbers passes through unchanged.
 * An unknown language falls back to DEFAULT_LANGUAGE (hr).
 *
 * The order matters: operators and units (°C, %, >=, ...) are processed while
 * the numbers are still digits; only at the end are decimals and integers
 * converted into words.
 */
function normalizeForSpeech(text, langCode = DEFAULT_LANGUAGE) {
  const lang = resolveLanguage(langCode)
  const s = lang.symbols
  // console.error('DEBUG s.plus:', s.plus)
  let out = String(text ?? '').replace(/\u2212/g, '-') // typographic minus
  // console.error('DEBUG after minus:', out)

  if (!/[\d+\-=×÷%°²³]/.test(out)) return out.trim()

  // 1. Thousands separators. A real number with thousands separators is a group
  //    of 1–3 digits followed by groups of exactly 3 digits ("1.234", "12.345.678").
  //    Only a single pair is ambiguous ("23.897"): thousands separator OR decimal.
  //    Decision:
  //      - multiple groups ("1.234.567")               -> always thousands
  //      - leading zero ("0.125")                      -> decimal
  //      - a decimal with the same separator, without 3 digits, exists in the text
  //        ("23.7 + 23.897")                           -> the separator is decimal, don't touch it
  //      - otherwise                                   -> thousands ("1.000", "12.345")
  const gsEsc = lang.groupSep ? lang.groupSep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''
  if (gsEsc) {
    const groupRe = new RegExp(`(?<![\\d${gsEsc}])\\d{1,3}(?:${gsEsc}\\d{3})+(?!\\d|${gsEsc}\\d)`, 'g')
    const decimalEvidence = new RegExp(`\\d${gsEsc}(?:\\d{1,2}|\\d{4,})(?!\\d)`).test(out)

    out = out.replace(groupRe, (m) => {
      const groups = m.split(lang.groupSep)
      if (groups.length === 2 && (decimalEvidence || groups[0].startsWith('0'))) return m
      return groups.join('')
    })
  }

  // 2. Minus sign in front of a number ("-5", "(-5)", "= -5").
  out = out.replace(/(^|[\s(\[=:;,])-(\s*)(?=\d)/g, `$1${s.minus} `)

  // 3. Degrees: the number (including decimal) is read here because the form of
  //    the unit word depends on it.
  //    A decimal number takes the genitive plural ("36,6 stupnjeva").
  const NUM = '(\\d+)(?:[.,](\\d+))?'
  const withUnit = (unitFn) => (_m, intStr, decStr) => {
    const words = decStr ? decimalToWords(intStr, decStr, lang) : integerStringToWords(intStr, lang)
    return ` ${words} ${unitFn(decStr ? 5 : Number(intStr))} `
  }
  out = out
    .replace(new RegExp(`${NUM}\\s*°\\s*C\\b`, 'gi'), withUnit(s.celsius))
    .replace(new RegExp(`${NUM}\\s*°`, 'g'), withUnit(s.degree))
    .replace(new RegExp(`${NUM}\\s*km/h\\b`, 'gi'), withUnit(s.kilometersPerHour))
    .replace(new RegExp(`${NUM}\\s*\\bkm\\b`, 'gi'), withUnit(s.kilometer))
    
  // 4. Operators. Comparisons are only replaced next to a number (so that "<b>"
  //    and "->" survive).
  out = out.replace(/\s*(!=|>=|<=|==|≠|≤|≥|>|<)\s*/g, (m, op, offset, str) => {
    const before = str.slice(0, offset)
    const after = str.slice(offset + m.length)

    if (!/\d$/.test(before) && !/^-?\d/.test(after)) return m
    if (/[-=]$/.test(before)) return m // arrows "->", "=>"
    if (op === '<' && /^[A-Za-z/!]/.test(after)) return m // HTML tag
    if (op === '>' && /<\/?[A-Za-z][^<>]*$/.test(before)) return m // end of HTML tag

    return ` ${s[COMPARISON_KEYS[op]]} `
  })

  out = out
    .replace(/\s*%\s*/g, ` ${s.percent} `)
    .replace(/\s*\+\s*/g, ` ${s.plus} `)
    // minus between numbers (arithmetic operation); hyphens inside words
    // (Pariz-Rim) and the minus sign in front of numbers (handled earlier)
    // are left untouched.
    .replace(/(\d)\s*-\s*(\d)/g, (_m, a, b) => `${a} ${s.minus} ${b}`)
    .replace(/(\d)\s*[x×]\s*(\d)/gi, (_m, a, b) => `${a} ${s.times} ${b}`)
    .replace(/\s*×\s*/g, ` ${s.times} `)
    .replace(/\s*÷\s*/g, ` ${s.dividedBy} `)
    .replace(/\s*=[\s=]*/g, ` ${s.equals} `)
    .replace(/(\d)\s*\^\s*(-?)(\d+)/g, (_m, base, neg, exp) => `${base} ${s.power} ${neg ? `${s.minus} ` : ''}${exp}`)
    .replace(/²/g, ` ${s.squared} `)
    .replace(/³/g, ` ${s.cubed} `)
    .replace(/√\s*(?=\d)/g, ` ${s.sqrt} `)

  out = out
    .replace(/\s{2,}/g, ' ')
    .trim();


  // The space between a number and a letter immediately following it ("5km" -> "pet kilometara").
  const gap = (str, end) => (/^\p{L}/u.test(str.slice(end)) ? ' ' : '')

  // 5. Decimals: "3,14" / "3.14". Chains ("1,2,3", dates "12.5.2024") are lists,
  //    not decimals, so we leave them alone. Numbers attached to letters ("v1.2")
  //    stay as they are.
  out = out.replace(/(?<![\p{L}\d])(?<!\d[.,])(\d+)([.,])(\d+)(?!\d|[.,]\d)/gu, (m, intStr, _sep, decStr, offset, str) =>
    decimalToWords(intStr, decStr, lang) + gap(str, offset + m.length))

  // 6. Plain integers (not the ones glued to letters before them: "B4", "A4").
  out = out.replace(/(?<![\p{L}\d])(\d+)/gu, (m, digits, offset, str) =>
    integerStringToWords(digits, lang) + gap(str, offset + m.length))

  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)])/g, '$1') // "Celzija ." -> "Celzija."
    .trim()
}

/** True when `code` is one of the 31 languages supported by Supertonic 3. */
export function isSupportedLanguage(code) {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0]
  return SUPERTONIC_LANGUAGES.includes(base)
}

export default normalizeForSpeech

