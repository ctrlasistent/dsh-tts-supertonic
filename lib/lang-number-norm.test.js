/**
 * Tests for lang-number-norm.js — run with:
 *   node --test lang-number-norm.test.js
 *
 * Uses Node's built-in test runner (Node 18+); no external dependencies.
 *
 * Structure:
 *   - Add a language to LANGUAGE_TESTS → test cases are generated automatically
 *   - Manual tests (e.g. for specific bugs) remain below
 */

import test, {describe, it} from 'node:test'
import assert from 'node:assert/strict'

import normalizeForSpeech, {slavicForm, digitsToWords, isSupportedLanguage, numberToWords} from './lang-number-norm.js'

// Add a new language here, and test cases will be generated automatically.
/**
 * @type {Record<string, {
 *   input: string,
 *   output: string,
 *   description: string,
 * }[]>}
 */
const LANGUAGE_TESTS = {
  /** Hrvatski */
  hr: [
    { input: '3,12 + 3,123 = 6,243', output: 'tri zarez jedan dva plus tri zarez jedan dva tri jednako šest zarez dva četiri tri', description: 'decimale s točno tri decimale' },
    { input: '2,5', output: 'dva zarez pet', description: 'jedna decimala' },
    { input: '2,57', output: 'dva zarez pet sedam', description: 'dvije decimale' },
    { input: '2,579', output: 'dva zarez pet sedam devet', description: 'tri decimale (zarez je u hr uvijek decimalni)' },
    { input: '0,125', output: 'nula zarez jedan dva pet', description: 'decimala s nulom na početku' },
    { input: '0.125', output: 'nula zarez jedan dva pet', description: 'vodeća nula s točkom = decimala' },
    { input: '1,111 = 1,111', output: 'jedan zarez jedan jedan jedan jednako jedan zarez jedan jedan jedan', description: 'lanac decimala' },
    { input: '1.000', output: 'tisuću', description: 'tisućica' },
    { input: '23.7 + 23.897 = 47.597', output: 'dvadeset tri zarez sedam plus dvadeset tri zarez osam devet sedam jednako četrdeset sedam zarez pet devet sedam', description: 'točka kao decimalni znak (kontekst)' },
    { input: '1.234.567', output: 'milijun dvjesto trideset četiri tisuće petsto šezdeset sedam', description: 'više skupina = tisućice' },
    { input: '12.345', output: 'dvanaest tisuća tristo četrdeset pet', description: 'jedna skupina bez konteksta = tisućice' },
    { input: '1.000.000', output: 'milijun', description: 'milijun' },
    { input: '2.500.000', output: 'dva milijuna petsto tisuća', description: 'velika tisućica' },
    { input: 'Imamo 1.500 komada, cijena 12,50 EUR.', output: 'Imamo tisuću petsto komada, cijena dvanaest zarez pet nula EUR.', description: 'tisućica i decimala u istoj rečenici' },
    { input: '0', output: 'nula', description: 'nula' },
    { input: '8 + 99 = 107', output: 'osam plus devedeset devet jednako sto sedam', description: 'osnovna zbrajanja' },
    { input: '21', output: 'dvadeset jedan', description: 'dva broja' },
    { input: '111', output: 'sto jedanaest', description: 'stotice' },
    { input: '1000', output: 'tisuću', description: 'tisućica 1' },
    { input: '2000', output: 'dvije tisuće', description: 'tisućica 2' },
    { input: '5000', output: 'pet tisuća', description: 'tisućica 5' },
    { input: '1000000', output: 'milijun', description: 'milijun' },
    { input: '2000000', output: 'dva milijuna', description: 'dva milijuna' },
    { input: '1000000000', output: 'milijarda', description: 'milijarda' },
    { input: '-5', output: 'minus pet', description: 'negativan broj' },
    { input: '-3,5', output: 'minus tri zarez pet', description: 'negativan decimalni' },
    { input: '1234567', output: 'milijun dvjesto trideset četiri tisuće petsto šezdeset sedam', description: 'veliki broj' },
    { input: '10 - 7 = 3', output: 'deset minus sedam jednako tri', description: 'oduzimanje' },
    { input: '3 × 4 = 12', output: 'tri puta četiri jednako dvanaest', description: 'množenje' },
    { input: '10 ÷ 2 = 5', output: 'deset podijeljeno s dva jednako pet', description: 'dijeljenje' },
    { input: '2 ^ 10', output: 'dva na potenciju deset', description: 'potencija' },
    { input: '50%', output: 'pedeset posto', description: 'postotak' },
    { input: '3,5% ili 12%', output: 'tri zarez pet posto ili dvanaest posto', description: 'postotak s decimalama' },
    { input: '99°C', output: 'devedeset devet stupnjeva Celzija', description: 'stupnjevi' },
    { input: '-22°C', output: 'minus dvadeset dva stupnja Celzija', description: 'negativan stupanj' },
    { input: '180°', output: 'sto osamdeset stupnjeva', description: 'stupanj' },
    { input: '5²', output: 'pet na kvadrat', description: 'kvadrat' },
    { input: '3³', output: 'tri na kub', description: 'kub' },

    // --- tisućice vs. decimale ---
    { input: '1.234,56', output: 'tisuću dvjesto trideset četiri zarez pet šest', description: 'hr zapis 1.234,56' },
    { input: '0.5', output: 'nula zarez pet', description: 'točka kao decimalni znak' },
    { input: '23.7 + 23.897 = 47.597', output: 'dvadeset tri zarez sedam plus dvadeset tri zarez osam devet sedam jednako četrdeset sedam zarez pet devet sedam', description: 'regresija: točka je decimalna zbog konteksta' },
    { input: '1,2,3', output: 'jedan,dva,tri', description: 'popis brojeva nije decimala' },
    { input: '12.5.2024', output: 'dvanaest.pet.dvije tisuće dvadeset četiri', description: 'datum nije decimala' },

    // --- rodovi i skale ---
    { input: '11', output: 'jedanaest', description: 'teens' },
    { input: '40', output: 'četrdeset', description: 'desetice' },
    { input: '200', output: 'dvjesto', description: 'stotice 200' },
    { input: '1001', output: 'tisuću jedan', description: 'tisuću jedan' },
    { input: '12000', output: 'dvanaest tisuća', description: '11-14 tisuća' },
    { input: '21000', output: 'dvadeset jedna tisuća', description: 'tisuća je ženskog roda (1)' },
    { input: '22000', output: 'dvadeset dvije tisuće', description: 'tisuća je ženskog roda (2)' },
    { input: '101000', output: 'sto jedna tisuća', description: 'sto jedna tisuća' },
    { input: '21000000', output: 'dvadeset jedan milijun', description: 'milijun je muškog roda' },
    { input: '5000000', output: 'pet milijuna', description: 'pet milijuna' },
    { input: '2000000000', output: 'dvije milijarde', description: 'milijarda je ženskog roda' },
    { input: '21000000000', output: 'dvadeset jedna milijarda', description: 'dvadeset jedna milijarda' },
    { input: '1000000000000', output: 'bilijun', description: 'bilijun' },
    { input: '2500000000000', output: 'dva bilijuna petsto milijardi', description: 'bilijuni i milijarde' },

    // --- velike i neobične znamenke ---
    { input: '007', output: 'nula nula sedam', description: 'vodeće nule se čitaju po znamenkama' },
    { input: '12345678901234567', output: 'jedan dva tri četiri pet šest sedam osam devet nula jedan dva tri četiri pet šest sedam', description: 'predug broj po znamenkama' },

    // --- stupnjevi ---
    { input: '36,6°C', output: 'trideset šest zarez šest stupnjeva Celzija', description: 'decimalni Celzij (zarez)' },
    { input: '36.6°C', output: 'trideset šest zarez šest stupnjeva Celzija', description: 'decimalni Celzij (točka)' },
    { input: '2,5°C', output: 'dva zarez pet stupnjeva Celzija', description: 'decimale uz 2 traže genitiv množine' },
    { input: '21°C', output: 'dvadeset jedan stupanj Celzija', description: 'stupanj (1)' },
    { input: '22 °C', output: 'dvadeset dva stupnja Celzija', description: 'razmak prije °C' },
    { input: '5 °', output: 'pet stupnjeva', description: 'razmak prije °' },
    { input: 'Temperatura je 99°C.', output: 'Temperatura je devedeset devet stupnjeva Celzija.', description: 'nema razmaka prije točke' },
    { input: '-3,5°C', output: 'minus tri zarez pet stupnjeva Celzija', description: 'negativna decimala' },

    // --- usporedbe i operatori ---
    { input: '5 >= 3', output: 'pet veće ili jednako tri', description: '>=' },
    { input: '5 <= 3', output: 'pet manje ili jednako tri', description: '<=' },
    { input: '5 != 3', output: 'pet nije jednako tri', description: '!=' },
    { input: '5 == 5', output: 'pet jednako pet', description: '==' },
    { input: '5 > 3', output: 'pet veće od tri', description: '>' },
    { input: '3 < 5', output: 'tri manje od pet', description: '<' },
    { input: '3,5 > 2', output: 'tri zarez pet veće od dva', description: 'usporedba s decimalom' },
    { input: '5 ≥ 3 i 3 ≤ 5 i 1 ≠ 2', output: 'pet veće ili jednako tri i tri manje ili jednako pet i jedan nije jednako dva', description: 'unicode usporedbe' },
    { input: 'x = 5', output: 'x jednako pet', description: 'jednakost sa slovom' },
    { input: '<b>5</b>', output: '<b>pet</b>', description: 'HTML oznake se ne diraju' },
    { input: '5 -> 3', output: 'pet -> tri', description: 'strelica se ne dira' },
    { input: '√16', output: 'kvadratni korijen iz šesnaest', description: 'korijen' },
    { input: '10^-3', output: 'deset na potenciju minus tri', description: 'negativni eksponent' },
    { input: '3,5 - 2 = 1,5', output: 'tri zarez pet minus dva jednako jedan zarez pet', description: 'oduzimanje s decimalama' },
    { input: '3x4', output: 'tri puta četiri', description: 'x kao množenje' },
    { input: '(-5)', output: '(minus pet)', description: 'minus u zagradi' },
    { input: '= -5', output: 'jednako minus pet', description: 'minus nakon jednakosti' },

    // --- kilometri ---
    { input: '1 km', output: 'jedan kilometar', description: 'kilometar (1)' },
    { input: '2 km', output: 'dva kilometra', description: 'kilometar (2)' },
    { input: '10 km', output: 'deset kilometara', description: 'kilometar (10)' },
    { input: '11 km', output: 'jedanaest kilometara', description: 'kilometar (11)' },
    { input: '12 km', output: 'dvanaest kilometara', description: 'kilometar (12)' },
    { input: '14 km', output: 'četrnaest kilometara', description: 'kilometar (14)' },
    { input: '21 km', output: 'dvadeset jedan kilometar', description: 'kilometar (21)' },
    { input: '22 km', output: 'dvadeset dva kilometra', description: 'kilometar (22)' },
    { input: '3.5 km', output: 'tri zarez pet kilometara', description: 'decimalni kilometar' },
    { input: '5.25 km', output: 'pet zarez dva pet kilometara', description: 'decimalni kilometar (5.25)' },
    { input: 'Distance: 15 km', output: 'Distance: petnaest kilometara', description: 'kilometar u rečenici' },

    // --- km/h ---
    { input: '1 km/h', output: 'jedan kilometar po satu', description: 'km/h (1)' },
    { input: '2 km/h', output: 'dva kilometra po satu', description: 'km/h (2)' },
    { input: '10 km/h', output: 'deset kilometara po satu', description: 'km/h (10)' },
    { input: '21 km/h', output: 'dvadeset jedan kilometar po satu', description: 'km/h (21)' },
    { input: '22 km/h', output: 'dvadeset dva kilometra po satu', description: 'km/h (22)' },
    { input: '3.5 km/h', output: 'tri zarez pet kilometara po satu', description: 'decimalni km/h' },
    { input: 'vozi 60km/h', output: 'vozi šezdeset kilometara po satu', description: 'km/h bez razmaka' },
    { input: 'Brzina: 50 km/h.', output: 'Brzina: pedeset kilometara po satu.', description: 'km/h u rečenici s točkom' },
  ],

  /** English */
  en: [
    { input: '1,000,000', output: 'one million', description: 'tisućice sa zarezom' },
    { input: '3.123', output: 'three point one two three', description: 'decimale s točkom' },
    { input: '3.14 + 2.5 = 5.64', output: 'three point one four plus two point five equals five point six four', description: 'decimali u izrazu' },
    { input: '8 + 99 = 107', output: 'eight plus ninety nine equals one hundred seven', description: 'osnovna zbrajanja' },
    { input: '50%', output: 'fifty percent', description: 'postotak' },
    { input: '1,234.56', output: 'one thousand two hundred thirty four point five six', description: 'en 1,234.56' },
    { input: '1,000,000,000,000', output: 'one trillion', description: 'trillion' },
    { input: '2,500', output: 'two thousand five hundred', description: 'tisućica s jednom skupinom' },
    { input: '1000', output: 'one thousand', description: 'one thousand' },
    { input: '21', output: 'twenty one', description: 'dvobroj' },
    { input: '36.6°C', output: 'thirty six point six degrees Celsius', description: 'decimalni Celzij' },
    { input: '1°C', output: 'one degree Celsius', description: 'jedan stupanj' },
    { input: '5 >= 3', output: 'five greater or equal to three', description: '>=' },
    { input: '5 != 3', output: 'five is not equal to three', description: '!=' },
    { input: '√16', output: 'square root of sixteen', description: 'korijen' },
    { input: '-5', output: 'minus five', description: 'negativan' },
  ],
}

// ---------------------------------------------------------------------------
// Auto-generated tests for all languages
// ---------------------------------------------------------------------------

for (const [langCode, tests] of Object.entries(LANGUAGE_TESTS)) {
  for (const { input, output, description } of tests) {
    test(`${description}: ${langCode} — '${input}' → '${output}'`, () => {
      assert.equal(normalizeForSpeech(input, langCode), output)
    })
  }
}

// ---------------------------------------------------------------------------
// Helper functions (the only tests that need to be maintained manually)
// ---------------------------------------------------------------------------

test('digitsToWords', () => {
  assert.equal(digitsToWords('350', 'hr'), 'tri pet nula')
})

test('slavicForm rubni slučajevi (11-14)', () => {
  assert.equal(slavicForm(11, ['a', 'b', 'c']), 'c')
  assert.equal(slavicForm(14, ['a', 'b', 'c']), 'c')
  assert.equal(slavicForm(21, ['a', 'b', 'c']), 'a')
  assert.equal(slavicForm(22, ['a', 'b', 'c']), 'b')
  assert.equal(slavicForm(25, ['a', 'b', 'c']), 'c')
})

test('isSupportedLanguage', () => {
  assert.equal(isSupportedLanguage('hr'), true)
  assert.equal(isSupportedLanguage('hr-HR'), true)
  assert.equal(isSupportedLanguage('en-US'), true)
  assert.equal(isSupportedLanguage('xx'), false)
})


test('engleski: brojevi i decimale', () => {
  assert.equal(normalizeForSpeech('8 + 99 = 107', 'en'), 'eight plus ninety nine equals one hundred seven')
})

test('tekst bez brojeva nepromijenjen', () => {
  assert.equal(normalizeForSpeech('Dobar dan, svijete!', 'hr'), 'Dobar dan, svijete!')
  assert.equal(normalizeForSpeech('', 'hr'), '')
  assert.equal(normalizeForSpeech(null, 'hr'), '')
})

// ---------------------------------------------------------------------------
// numberToWords
// ---------------------------------------------------------------------------

test('numberToWords: cijeli, negativni i decimalni', () => {
  assert.equal(numberToWords(1234, 'hr'), 'tisuću dvjesto trideset četiri')
  assert.equal(numberToWords(-7, 'hr'), 'minus sedam')
  assert.equal(numberToWords(3.5, 'hr'), 'tri zarez pet')
  assert.equal(numberToWords('42', 'hr'), 'četrdeset dva')
  assert.equal(numberToWords(0, 'hr'), 'nula')
})

test('numberToWords:', () => {
  assert.equal(numberToWords('abc', 'hr'), 'abc')
  assert.equal(numberToWords('', 'hr'), '')
  assert.equal(numberToWords(NaN, 'hr'), 'NaN')
})


test('kodovi jezika: regionalni se svode na osnovni, nepoznati na hr', () => {
  assert.equal(normalizeForSpeech('5', 'en-US'), 'five')
  assert.equal(normalizeForSpeech('5', 'hr_HR'), 'pet')
  assert.equal(normalizeForSpeech('5', 'xx'), 'pet')
  assert.equal(normalizeForSpeech('5'), 'pet')
})

test(': već normaliziran tekst ostaje isti', () => {
  const once = normalizeForSpeech('8 + 99 = 107; 36,6°C; 50%', 'hr')
  assert.equal(normalizeForSpeech(once, 'hr'), once)
})

test('slavicForm: 12-14 i veliki brojevi', () => {
  assert.equal(slavicForm(12, ['a', 'b', 'c']), 'c')
  assert.equal(slavicForm(101, ['a', 'b', 'c']), 'a')
  assert.equal(slavicForm(112, ['a', 'b', 'c']), 'c')
  assert.equal(slavicForm(1004, ['a', 'b', 'c']), 'b')
})

test('digitsToWords:', () => {
  assert.equal(digitsToWords('1-2', 'hr'), 'jedan - dva')
})
