// ==UserScript==
// @name         RanobeLib Archiver
// @namespace    https://github.com/SanSan-/RanobeLibArchiver
// @version      1.8
// @description  Ranobe from ranobelib.me -> .zip file of .txt or .pdf
// @author       An1by & SanSan
// @license      MIT
// @include      /^https?:\/\/ranobelib\.me\/ru\/book\/[\w\-]+(?:\?.+|#.*)?$/
// @icon         https://ranobelib.me/images/logo/rl/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://github.com/foliojs/pdfkit/releases/download/v0.15.2/pdfkit.standalone.js
// @require      https://cdn.jsdelivr.net/npm/blob-stream@0.1.3/+esm
// @require      https://unpkg.com/range-slider-input@2.4.5/dist/rangeslider.nostyle.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @grant        none
// ==/UserScript==

const domain = 'ranobelib.me';
const apiDomain = 'api.cdnlibs.org';
const fetchRetryCount = 4;
const fetchRetryDelay = 1000;
const imageFetchDelay = 750;
let apiHeadersCache, fontPromise, buttonsObserver, buttonsMountTimer;
const buttons = [];

///////////// FUNCTIONS
// fetch
function extractJwt (value) {
  if (!value || typeof value !== 'string') return;
  const match = value.match(/(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match ? match[0].replace(/^Bearer\s+/, '') : undefined;
}

function getAuthTokenFromStorage (storage) {
  const keys = [];
  for (let i = 0; i < storage.length; ++i) {
    keys.push(storage.key(i));
  }
  keys.sort((left, right) => /token|auth|access/i.test(right) - /token|auth|access/i.test(left));
  for (const key of keys) {
    const token = extractJwt(storage.getItem(key));
    if (token) return token;
  }
}

function getAuthToken () {
  return getAuthTokenFromStorage(localStorage) || getAuthTokenFromStorage(sessionStorage);
}

function getApiHeaders () {
  if (apiHeadersCache) return apiHeadersCache;
  const headers = {
    'Client-Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Content-Type': 'application/json',
    'Site-Id': '3'
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  apiHeadersCache = headers;
  return apiHeadersCache;
}

async function jsonFetch (url) {
  const response = await fetch(url, { method: 'GET', credentials: 'include', headers: getApiHeaders() });
  const text = await response.text();
  return JSON.parse(text);
}

async function fetchRanobeChapters (ranobeId) {
  return (await jsonFetch(`https://${apiDomain}/api/manga/${ranobeId}/chapters`)).data;
}

async function fetchChapter (ranobeId, volume, number) {
  return (await jsonFetch(`https://${apiDomain}/api/manga/${ranobeId}/chapter?number=${number}&volume=${volume}`)).data;
}

async function fetchRanobeData (ranobeId) {
  return (await jsonFetch(
    `https://${apiDomain}/api/manga/${ranobeId}?fields[]=background&fields[]=eng_name&fields[]=otherNames&fields[]=summary&fields[]=releaseDate&fields[]=type_id&fields[]=caution&fields[]=views&fields[]=close_view&fields[]=rate_avg&fields[]=rate&fields[]=genres&fields[]=tags&fields[]=teams&fields[]=user&fields[]=franchise&fields[]=authors&fields[]=publisher&fields[]=userRating&fields[]=moderated&fields[]=metadata&fields[]=metadata.count&fields[]=metadata.close_comments&fields[]=manga_status_id&fields[]=chap_count&fields[]=status_id&fields[]=artists&fields[]=format`)).data;
}

async function getFont () {
  if (!fontPromise) fontPromise = fetch(`https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf`)
    .then(response => response.arrayBuffer());
  return fontPromise;
}

async function getImage (url) {
  if (/\.(jpe?g|png)$/i.test(url)) try {
    const response = await fetchWithRetry(url);
    if (response.status === 200) return response.arrayBuffer();
  } catch (e) {
    console.warn(`картинка пропущена после повторных попыток: ${url}. ${e && e.message ? e.message : e}`);
  }
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry (url, options) {
  let error;
  for (let i = 0; i <= fetchRetryCount; ++i) {
    await wait(imageFetchDelay);
    try {
      const response = await fetch(getRetryUrl(url, i), options);
      if (response.status !== 429 && response.status < 500) return response;
      error = new Error(`HTTP ${response.status}`);
    } catch (e) {
      error = e;
    }
    if (i < fetchRetryCount) await wait((fetchRetryDelay << i) + Math.trunc(Math.random() * 250));
  }
  throw error;
}

function getRetryUrl (url, attempt) {
  if (attempt === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}rbl_retry=${Date.now()}_${attempt}`;
}

async function getRanobe () {
  const path = window.location.pathname.split('/');
  const ranobeId = path[path.length - 1];

  const ranobeData = await fetchRanobeData(ranobeId);
  return { ranobeId, ranobeData };
}

async function getChapter (ranobeId, chapterData) {
  // ставим задержку 750 мс, чтобы не схватить 429 на больших (100+ глав) проектах
  return await new Promise(resolve => setTimeout(resolve, 750))
    .then(() => fetchChapter(ranobeId, chapterData.volume, chapterData.number));
}

// Formatting
function formatRanobeLabel (json) {
  if ('rus_name' in json) return json.rus_name;
  if ('eng_name' in json) return json.eng_name;
  return json.name;
}

// декодер с компактной HTML4-таблицей из html-entities и числовой картой
const mangaNumberRegex = new RegExp('^\\d+(--)');
const htmlEntityMaxLength = 32;
const htmlEntityPairs =
  "AElig~\u00c6~AMP~&~Aacute~\u00c1~Acirc~\u00c2~Agrave~\u00c0~Alpha;~\u0391~Aring~\u00c5~Atilde~\u00c3~Auml~\u00c4~Beta;~\u0392" +
  "~COPY~\u00a9~Ccedil~\u00c7~Chi;~\u03a7~Dagger;~\u2021~Delta;~\u0394~ETH~\u00d0~Eacute~\u00c9~Ecirc~\u00ca~Egrave~\u00c8~Epsilon;~\u0395" +
  "~Eta;~\u0397~Euml~\u00cb~GT~>~Gamma;~\u0393~Iacute~\u00cd~Icirc~\u00ce~Igrave~\u00cc~Iota;~\u0399~Iuml~\u00cf~Kappa;~\u039a~LT~<" +
  "~Lambda;~\u039b~Mu;~\u039c~Ntilde~\u00d1~Nu;~\u039d~OElig;~\u0152~Oacute~\u00d3~Ocirc~\u00d4~Ograve~\u00d2~Omega;~\u03a9~Omicron;~\u039f" +
  "~Oslash~\u00d8~Otilde~\u00d5~Ouml~\u00d6~Phi;~\u03a6~Pi;~\u03a0~Prime;~\u2033~Psi;~\u03a8~QUOT~\"~REG~\u00ae~Rho;~\u03a1~Scaron;~\u0160" +
  "~Sigma;~\u03a3~THORN~\u00de~Tau;~\u03a4~Theta;~\u0398~Uacute~\u00da~Ucirc~\u00db~Ugrave~\u00d9~Upsilon;~\u03a5~Uuml~\u00dc~Xi;~\u039e" +
  "~Yacute~\u00dd~Yuml;~\u0178~Zeta;~\u0396~aacute~\u00e1~acirc~\u00e2~acute~\u00b4~aelig~\u00e6~agrave~\u00e0~alefsym;~\u2135~alpha;~\u03b1" +
  "~amp~&~and;~\u2227~ang;~\u2220~apos;~'~aring~\u00e5~asymp;~\u2248~atilde~\u00e3~auml~\u00e4~bdquo;~\u201e~beta;~\u03b2~brvbar~\u00a6" +
  "~bull;~\u2022~cap;~\u2229~ccedil~\u00e7~cedil~\u00b8~cent~\u00a2~chi;~\u03c7~circ;~\u02c6~clubs;~\u2663~cong;~\u2245~copy~\u00a9" +
  "~crarr;~\u21b5~cup;~\u222a~curren~\u00a4~dArr;~\u21d3~dagger;~\u2020~darr;~\u2193~deg~\u00b0~delta;~\u03b4~diams;~\u2666~divide~\u00f7" +
  "~eacute~\u00e9~ecirc~\u00ea~egrave~\u00e8~empty;~\u2205~emsp;~\u2003~ensp;~\u2002~epsilon;~\u03b5~equiv;~\u2261~eta;~\u03b7~eth~\u00f0" +
  "~euml~\u00eb~euro;~\u20ac~exist;~\u2203~fnof;~\u0192~forall;~\u2200~frac12~\u00bd~frac14~\u00bc~frac34~\u00be~frasl;~\u2044~gamma;~\u03b3" +
  "~ge;~\u2265~gt~>~hArr;~\u21d4~harr;~\u2194~hearts;~\u2665~hellip;~\u2026~iacute~\u00ed~icirc~\u00ee~iexcl~\u00a1~igrave~\u00ec" +
  "~image;~\u2111~infin;~\u221e~int;~\u222b~iota;~\u03b9~iquest~\u00bf~isin;~\u2208~iuml~\u00ef~kappa;~\u03ba~lArr;~\u21d0~lambda;~\u03bb" +
  "~lang;~\u2329~laquo~\u00ab~larr;~\u2190~lceil;~\u2308~ldquo;~\u201c~le;~\u2264~lfloor;~\u230a~lowast;~\u2217~loz;~\u25ca~lrm;~\u200e" +
  "~lsaquo;~\u2039~lsquo;~\u2018~lt~<~macr~\u00af~mdash;~\u2014~micro~\u00b5~middot~\u00b7~minus;~\u2212~mu;~\u03bc~nabla;~\u2207" +
  "~nbsp~\u00a0~ndash;~\u2013~ne;~\u2260~ni;~\u220b~not~\u00ac~notin;~\u2209~nsub;~\u2284~ntilde~\u00f1~nu;~\u03bd~oacute~\u00f3" +
  "~ocirc~\u00f4~oelig;~\u0153~ograve~\u00f2~oline;~\u203e~omega;~\u03c9~omicron;~\u03bf~oplus;~\u2295~or;~\u2228~ordf~\u00aa~ordm~\u00ba" +
  "~oslash~\u00f8~otilde~\u00f5~otimes;~\u2297~ouml~\u00f6~para~\u00b6~part;~\u2202~permil;~\u2030~perp;~\u22a5~phi;~\u03c6~pi;~\u03c0" +
  "~piv;~\u03d6~plusmn~\u00b1~pound~\u00a3~prime;~\u2032~prod;~\u220f~prop;~\u221d~psi;~\u03c8~quot~\"~rArr;~\u21d2~radic;~\u221a" +
  "~rang;~\u232a~raquo~\u00bb~rarr;~\u2192~rceil;~\u2309~rdquo;~\u201d~real;~\u211c~reg~\u00ae~rfloor;~\u230b~rho;~\u03c1~rlm;~\u200f" +
  "~rsaquo;~\u203a~rsquo;~\u2019~sbquo;~\u201a~scaron;~\u0161~sdot;~\u22c5~sect~\u00a7~shy~\u00ad~sigma;~\u03c3~sigmaf;~\u03c2~sim;~\u223c" +
  "~spades;~\u2660~sub;~\u2282~sube;~\u2286~sum;~\u2211~sup;~\u2283~sup1~\u00b9~sup2~\u00b2~sup3~\u00b3~supe;~\u2287~szlig~\u00df" +
  "~tau;~\u03c4~there4;~\u2234~theta;~\u03b8~thetasym;~\u03d1~thinsp;~\u2009~thorn~\u00fe~tilde;~\u02dc~times~\u00d7~trade;~\u2122" +
  "~uArr;~\u21d1~uacute~\u00fa~uarr;~\u2191~ucirc~\u00fb~ugrave~\u00f9~uml~\u00a8~upsih;~\u03d2~upsilon;~\u03c5~uuml~\u00fc~weierp;~\u2118" +
  "~xi;~\u03be~yacute~\u00fd~yen~\u00a5~yuml~\u00ff~zeta;~\u03b6~zwj;~\u200d~zwnj;~\u200c";
const htmlNumericEntityMap = Object.freeze({
  0: 65533,
  128: 8364,
  130: 8218,
  131: 402,
  132: 8222,
  133: 8230,
  134: 8224,
  135: 8225,
  136: 710,
  137: 8240,
  138: 352,
  139: 8249,
  140: 338,
  142: 381,
  145: 8216,
  146: 8217,
  147: 8220,
  148: 8221,
  149: 8226,
  150: 8211,
  151: 8212,
  152: 732,
  153: 8482,
  154: 353,
  155: 8250,
  156: 339,
  158: 382,
  159: 376
});
const htmlWhitespaceRegex = /\s+|&nbsp;?/gi;
const htmlBreakRegex = /<\s*br(?:\s[^>]*)?\/?\s*>/gi;
const htmlTagRegex = /<\s*[^>]*>/g;
const htmlQuotRegex = /&quot;/gi;
const htmlLtRegex = /&lt;/gi;
const htmlGtRegex = /&gt;/gi;
const htmlEntityRegex = /&(?:#\d+|#[xX][\da-fA-F]+|[0-9a-zA-Z]+);?/g;

function buildHtmlEntityTrie (input) {
  const root = Object.create(null);
  for (let i = 0; i < input.length;) {
    let node = root, semi = false;
    while (i < input.length) {
      const code = input.charCodeAt(i++);
      if (code === 59) {
        semi = true;
        continue;
      }
      if (code === 126) break;
      node = node[code] || (node[code] = Object.create(null));
    }
    const start = i;
    while (i < input.length && input.charCodeAt(i) !== 126) ++i;
    if (semi) node.semicolonValue = input.slice(start, i);
    else node.value = input.slice(start, i);
    ++i;
  }
  return root;
}

function buildHtmlEntityMap (input) {
  const res = Object.create(null);
  for (let i = 0; i < input.length;) {
    const nameStart = i;
    let semi = false;
    while (i < input.length && input.charCodeAt(i) !== 126) {
      if (input.charCodeAt(i) === 59) semi = true;
      ++i;
    }
    const name = input.slice(nameStart, semi ? i - 1 : i);
    const valueStart = ++i;
    while (i < input.length && input.charCodeAt(i) !== 126) ++i;
    const value = input.slice(valueStart, i);
    res[`&${name};`] = value;
    if (!semi) res[`&${name}`] = value;
    ++i;
  }
  return res;
}

const htmlEntityRoot = buildHtmlEntityTrie(htmlEntityPairs);
const htmlEntityMap = buildHtmlEntityMap(htmlEntityPairs);

function isHtmlWhitespace (code) {
  return code === 32 || code === 160 || code >= 9 && code <= 13;
}

function isHtmlEntityChar (code) {
  const lower = code | 32;
  return code === 35 || code >= 48 && code <= 57 || lower >= 97 && lower <= 122;
}

function getHtmlEntityDigit (code) {
  if (code >= 48 && code <= 57) return code - 48;
  const upper = code & -33;
  if (upper >= 65 && upper <= 70) return upper - 55;
  return -1;
}

function readNumericHtmlEntity (text, start) {
  let i = start + 2, radix = 10, code = 0, overflow = false;
  if (i < text.length && (text.charCodeAt(i) | 32) === 120) {
    radix = 16;
    ++i;
  }
  const first = i, limit = Math.min(text.length, start + htmlEntityMaxLength + 2);
  for (; i < limit; ++i) {
    const curr = text.charCodeAt(i);
    if (curr === 59) break;
    const digit = getHtmlEntityDigit(curr);
    if (digit < 0 || digit >= radix) break;
    if (!overflow) {
      code = radix === 16 ? (code << 4) + digit : (code << 3) + (code << 1) + digit;
      overflow = code > 0x10ffff;
    }
  }
  if (i === first) return;
  return { value: overflow ? '\uFFFD' : String.fromCodePoint(htmlNumericEntityMap[code] || code), next: i < text.length && text.charCodeAt(i) === 59 ? i + 1 : i };
}

function readNamedHtmlEntity (text, start) {
  let node = htmlEntityRoot, value, next = -1;
  const limit = Math.min(text.length, start + htmlEntityMaxLength + 1);
  for (let i = start + 1; i < limit; ++i) {
    const code = text.charCodeAt(i);
    if (code === 59) {
      if (node.semicolonValue !== undefined) return { value: node.semicolonValue, next: i + 1 };
      if (node.value !== undefined) return { value: node.value, next: i + 1 };
      break;
    }
    if (!isHtmlEntityChar(code)) break;
    node = node[code];
    if (!node) break;
    if (node.value !== undefined) {
      value = node.value;
      next = i + 1;
    }
  }
  return next < 0 ? undefined : { value, next };
}

function readHtmlEntity (text, start) {
  return start + 1 < text.length && text.charCodeAt(start + 1) === 35
    ? readNumericHtmlEntity(text, start)
    : readNamedHtmlEntity(text, start);
}

function normalizeHtmlEntityValue (value) {
  return value.length === 1 && isHtmlWhitespace(value.charCodeAt(0)) ? ' ' : value;
}

function decodeHtmlEntityToken (token) {
  const value = htmlEntityMap[token];
  if (value !== undefined) return normalizeHtmlEntityValue(value);
  const entity = readHtmlEntity(token, 0);
  return entity ? normalizeHtmlEntityValue(entity.value) + token.slice(entity.next) : token;
}

function arrangeText (text) {
  text = text.replace(htmlWhitespaceRegex, ' ').replace(htmlBreakRegex, '\n').replace(htmlTagRegex, '')
    .replace(htmlQuotRegex, '"').replace(htmlLtRegex, '<').replace(htmlGtRegex, '>');
  return text.indexOf('&') < 0 ? text : text.replace(htmlEntityRegex, decodeHtmlEntityToken);
}

// utils
function groupByKey (array, key) {
  const res = {};
  for (const obj of array) {
    if (obj[key] === undefined) continue;
    (res[obj[key]] || (res[obj[key]] = [])).push(obj);
  }
  return res;
}

function getByXPath (path, root = document) {
  return document.evaluate(path, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// selection
function getHeader () {
  return document.querySelectorAll('.page > div > div.container > div')[2];
}

function getBottom () {
  return document.querySelectorAll('#app > div')[1];
}

function getPopupRoot () {
  return getByXPath('//div[contains(concat(" ", normalize-space(@class), " "), " popup-root ")]') || document.body;
}

// Icons (svg)
const pdfIcon = `<svg class="svg-inline--fa fa-file-pdf" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="file-pdf" role="img"
  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path class="" fill="currentColor"
    d="M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 144-208 0c-35.3 0-64 28.7-64 64l0 144-48 0c-35.3 0-64-28.7-64-64L0 64zm384 64l-128 0L256 0 384 128zM176 352l32 0c30.9 0 56 25.1 56 56s-25.1 56-56 56l-16 0 0 32c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-48 0-80c0-8.8 7.2-16 16-16zm32 80c13.3 0 24-10.7 24-24s-10.7-24-24-24l-16 0 0 48 16 0zm96-80l32 0c26.5 0 48 21.5 48 48l0 64c0 26.5-21.5 48-48 48l-32 0c-8.8 0-16-7.2-16-16l0-128c0-8.8 7.2-16 16-16zm32 128c8.8 0 16-7.2 16-16l0-64c0-8.8-7.2-16-16-16l-16 0 0 96 16 0zm80-112c0-8.8 7.2-16 16-16l48 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 32 32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 48c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-64 0-64z"/>
</svg>`;
const txtIcon = `<svg class="svg-inline--fa fa-file-lines" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="file-lines" role="img"
  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
  <path class="" fill="currentColor"
    d="M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM112 256l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/>
</svg>`;
const gearIcon = `<svg class="svg-inline--fa fa-gear" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="gear" role="img"
  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path class="" fill="currentColor"
    d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
</svg>`;
const infoIcon = `<svg class="svg-inline--fa fa-circle-info" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="circle-info" role="img"
  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path class="" fill="currentColor"
    d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0S0 114.6 0 256S114.6 512 256 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-144c-17.7 0-32-14.3-32-32s14.3-32 32-32s32 14.3 32 32s-14.3 32-32 32z"></path>
</svg>`;
const closeIcon = `<svg class="svg-inline--fa fa-circle-xmark txt _secondary" aria-hidden="true" focusable="false" data-prefix="far" data-icon="circle-xmark" role="img"
  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path class="" fill="currentColor"
    d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"/>
</svg>`;
const applyIcon = `<svg class="svg-inline--fa fa-square-check" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="square-check" role="img"
   xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
  <path class="" fill="currentColor"
  d="M64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64L64 32zM337 209L209 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L303 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/>
</svg>`;

// logging
function logStartDownload (label, slug) {
  console.log(`Начинаем загружать ${label} (${slug})!`);
}

function logChapter (chapter, last_chapter) {
  console.log(
    `Скачано: Том ${chapter.volume} Глава ${chapter.number} / Том ${last_chapter.volume} Глава ${last_chapter.number}`);
}

function notify (text) {
  const bottom = getBottom();
  const element = document.createElement('div');
  element.className = 'kp_bm';
  element.innerHTML = `<div class="kp_ap kp_z">
      <div class="kp_bw">${infoIcon} ${text}</div>
    </div>`;
  bottom.appendChild(element);

  setTimeout(() => {
    bottom.removeChild(element);
  }, 3000);
}

// Settings
let defaultSettings = {
  downloadByVolumes: true,
  downloadAllChapters: true,
  downloadPdfImages: true,
  chapterStartIndex: 0,
  chapterEndIndex: -1,
  pdfVolumeFontSize: 21,
  pdfChapterFontSize: 18,
  pdfCommonFontSize: 11
};

function initSettingsStyles () {
  if (document.getElementById('rbl-settings-style')) return;
  const style = document.createElement('style');
  style.id = 'rbl-settings-style';
  style.textContent = `
    #popup-settings-menu .popup-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 89;
      background: rgba(0,0,0,.6);
      transform: translateZ(0);
      transition: opacity .2s ease;
      will-change: opacity;
    }

    #popup-settings-menu .popup {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 90;
      display: flex;
      align-items: center;
      overflow: hidden;
      transition: background .3s ease;
    }

    #popup-settings-menu [hidden] {
      display: none !important;
    }

    #popup-settings-menu .popup__inner {
      position: relative;
      z-index: 91;
      width: 100vw;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
    }

    #popup-settings-menu .popup[data-type*=side] .popup__content {
      position: absolute;
      top: 0;
      bottom: 0;
      min-height: 100%;
      height: 100%;
      width: 100%;
      max-width: 440px;
      will-change: opacity;
    }

    #popup-settings-menu .popup[data-type=side] .popup__content {
      right: 0;
    }

    #popup-settings-menu .popup__content {
      --divider-bg: var(--foreground);
      position: relative;
      background: #fff;
      background: var(--foreground);
      z-index: 91;
      transition: transform .2s ease, opacity .2s ease;
      width: 100%;
      backface-visibility: hidden;
    }

    #popup-settings-menu .popup[data-name="ranobelib-archiver-settings"] .popup__content {
      display: flex;
      flex-direction: column;
    }

    #popup-settings-menu .popup-header {
      position: relative;
      display: flex;
      align-items: center;
      padding: 14px 20px;
      color: #212529;
      color: var(--text-primary);
    }

    #popup-settings-menu .popup-header + .popup-body {
      padding-top: 0;
    }

    #popup-settings-menu .popup-header__title {
      font-size: 16px;
      line-height: 20px;
      color: currentColor;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      cursor: pointer;
    }

    #popup-settings-menu .popup-header.is-sticky {
      position: sticky;
      top: 0;
      z-index: 30;
      background: inherit;
      border-bottom: solid 1px #e5e5e5;
      border-bottom: solid 1px var(--border-base);
    }

    #popup-settings-menu .popup-close.btn {
      position: absolute;
      top: 11px;
      right: 12px;
    }

    #popup-settings-menu .popup-body {
      padding: 14px 20px;
    }

    #popup-settings-menu .rbl-settings-body {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 0;
    }

    #popup-settings-menu .rbl-settings-scroll {
      flex-grow: 1;
      overflow-y: scroll;
    }

    #popup-settings-menu .rbl-settings-title {
      padding: var(--spacing-md);
      border-bottom: solid 1px #e5e5e5;
      border-bottom: solid 1px var(--border-base);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      font-weight: 600;
    }

    #popup-settings-menu .rbl-settings-row {
      cursor: pointer;
      transition: background .2s ease;
      display: flex;
      align-items: center;
      flex-grow: 1;
      gap: 6px;
      min-height: 40px;
      padding: 0 12px;
      overflow: hidden;
      border-bottom: solid 1px var(--border-base);
    }

    #popup-settings-menu .rbl-settings-row:hover {
      background: var(--background-fill-4);
    }

    #popup-settings-menu .rbl-settings-label {
      cursor: pointer;
      margin-right: auto;
      color: #212529;
      color: var(--text-primary);
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    #popup-settings-menu .rbl-settings-range {
      display: block;
      padding: var(--spacing-md);
    }

    #popup-settings-menu .rbl-settings-range-head {
      display: flex;
      align-items: baseline;
      gap: var(--gap);
      margin-bottom: var(--spacing-sm);
    }

    #popup-settings-menu .rbl-settings-range-head output {
      color: var(--text-secondary);
      white-space: nowrap;
    }

    #popup-settings-menu .rbl-settings-range > input[type="range"] {
      width: 100%;
      margin: 0;
      accent-color: var(--primary);
    }

    #popup-settings-menu #chapters-range-slider {
      margin: var(--spacing-sm) 0;
    }

    #popup-settings-menu .range-slider {
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      cursor: pointer;
      display: block;
      position: relative;
      width: 100%;
      height: 8px;
      background: #ddd;
      border-radius: 4px;
    }

    #popup-settings-menu .range-slider[data-disabled] {
      opacity: .5;
      cursor: not-allowed;
    }

    #popup-settings-menu .range-slider .range-slider__thumb {
      position: absolute;
      z-index: 3;
      top: 50%;
      width: 24px;
      height: 24px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: var(--primary);
    }

    #popup-settings-menu .range-slider .range-slider__thumb:focus-visible {
      outline: 0;
      box-shadow: 0 0 0 6px rgba(var(--primary-rgb), .5);
    }

    #popup-settings-menu .range-slider .range-slider__thumb[data-disabled] {
      z-index: 2;
    }

    #popup-settings-menu .range-slider .range-slider__range {
      position: absolute;
      z-index: 1;
      transform: translate(0, -50%);
      top: 50%;
      width: 100%;
      height: 100%;
      background: var(--primary);
    }

    #popup-settings-menu .range-slider input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      pointer-events: none;
      position: absolute;
      z-index: 2;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      background-color: transparent;
    }

    #popup-settings-menu .range-slider input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
    }

    #popup-settings-menu .range-slider input[type="range"]::-moz-range-thumb {
      width: 0;
      height: 0;
      border: 0;
    }

    #popup-settings-menu .range-slider input[type="range"]:focus {
      outline: 0;
    }

    #popup-settings-menu .rbl-settings-footer {
      padding: 8px 12px 10px;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
      background: #fff;
      background: var(--foreground);
      border-top: solid 1px var(--border-base);
    }

    #popup-settings-menu .form-switcher {
      display: flex;
      align-items: center;
      gap: 16px;
      user-select: none;
      cursor: pointer;
    }

    #popup-settings-menu .form-switcher-text {
      flex-grow: 1;
    }

    #popup-settings-menu .switcher-input {
      flex-shrink: 0;
    }

    #popup-settings-menu .switcher-input__box {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    #popup-settings-menu .switcher-input__box:checked ~ .switcher-input__slider {
      color: var(--primary-lighten);
    }

    #popup-settings-menu .switcher-input__box:checked ~ .switcher-input__slider:before {
      transform: translate(12px);
    }

    #popup-settings-menu .switcher-input__slider {
      position: relative;
      display: block;
      height: 9px;
      width: 26px;
      border-radius: 10px;
      color: #b0b5b9;
      background: currentColor;
      transition: background .2s ease;
    }

    #popup-settings-menu .switcher-input__slider:before {
      content: "";
      position: absolute;
      top: -3px;
      left: 0;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      border: solid 1px currentColor;
      background: #fff;
      transform: translate(-1px);
      transition: background .2s ease, transform .2s ease;
    }
  `;
  document.head.appendChild(style);
}

function getSetting (id) {
  const setting = document.getElementById(id);
  return setting.innerText;
}

function setSetting (id, value) {
  document.getElementById(id).innerText = value;
}

function getIntSetting (id, defaultValue = 0) {
  return parseInt(getSetting(id), 10) || defaultValue;
}

function bindRangeOutput (input, output) {
  output.textContent = input.value;
  input.addEventListener('input', (event) => {
    output.textContent = event.target.value;
  });
}

function initSettings () {
  initSettingsStyles();
  const popup = getPopupRoot();
  const globalSettings = document.createElement('div');
  globalSettings.id = 'global-settings';
  globalSettings.innerHTML = `<div hidden style="display: none">
    <div id="setting-download-by-volumes">${defaultSettings.downloadByVolumes}</div>
    <div id="setting-download-all-chapters">${defaultSettings.downloadAllChapters}</div>
    <div id="setting-download-pdf-images">${defaultSettings.downloadPdfImages}</div>
    <div id="setting-chapter-start-index">${defaultSettings.chapterStartIndex}</div>
    <div id="setting-chapter-end-index">${defaultSettings.chapterEndIndex}</div>
    <div id="setting-pdf-volume-font-size">${defaultSettings.pdfVolumeFontSize}</div>
    <div id="setting-pdf-chapter-font-size">${defaultSettings.pdfChapterFontSize}</div>
    <div id="setting-pdf-common-font-size">${defaultSettings.pdfCommonFontSize}</div>
  </div>`;
  popup.appendChild(globalSettings);
}

function closeSettingsMenu () {
  const menu = document.getElementById('popup-settings-menu');
  if (menu) menu.remove();
}

async function showSettingsMenu () {
  closeSettingsMenu();
  const popup = getPopupRoot();
  const { ranobeData } = await getRanobe();
  const chaptersCount = ranobeData.items_count.uploaded || 0;
  const chapterStartIndex = getIntSetting('setting-chapter-start-index');
  const minChapter = chapterStartIndex > chaptersCount - 1 ? chaptersCount - 1 : chapterStartIndex + 1;
  const chapterEndIndex = getIntSetting('setting-chapter-end-index');
  const maxChapter = (chapterEndIndex > chaptersCount || chapterEndIndex < 0) ? chaptersCount : chapterEndIndex;
  const menu = document.createElement('div');
  menu.id = 'popup-settings-menu';
  menu.innerHTML = `<div class='popup' data-type='side' data-name='ranobelib-archiver-settings'>
    <div class='popup-overlay'></div>
    <div class='popup__inner'>
      <div class='popup__content scrollable' role='dialog' aria-modal='true' tabindex='-1'>
        <div class='popup-header is-sticky'>
          <div class='popup-header__title'>${gearIcon}<span>Настройки RanobeLib Archiver</span></div>
          <button id='close-settings-btn' class='popup-close btn is-icon variant-secondary' type='button' title='закрыть'>
            ${closeIcon}
          </button>
        </div>
        <div class='popup-body rbl-settings-body'>
          <div class='rbl-settings-scroll'>
          <div class='rbl-settings-title'>Общие настройки</div>
          <label class='rbl-settings-row form-switcher'>
            <span class='rbl-settings-label'>
              Объединять главы по томам
            </span>
            <span class='switcher-input'>
              <input class='switcher-input__box' type='checkbox' id='checkbox-download-by-volumes' ${getSetting(
    'setting-download-by-volumes') === 'true' ? 'checked' : ''} />
              <span class='switcher-input__slider'></span>
            </span>
          </label>
          <label class='rbl-settings-row form-switcher'>
            <span class='rbl-settings-label'>
              Скачать все главы
            </span>
            <span class='switcher-input'>
              <input class='switcher-input__box' type='checkbox' id='checkbox-download-all-chapters' ${getSetting(
    'setting-download-all-chapters') === 'true' ? 'checked' : ''} />
              <span class='switcher-input__slider'></span>
            </span>
          </label>
          <div class='rbl-settings-row rbl-settings-range' id='chapters-range-slider-panel' ${getSetting(
    'setting-download-all-chapters') === 'true' ? 'hidden' : ''}>
            <div class='rbl-settings-range-head'>
              <span class='rbl-settings-label'>Диапазон глав</span>
              <span><output id='output-min-chapter'>${minChapter}</output> - <output id='output-max-chapter'>${maxChapter}</output></span>
            </div>
            <div id='chapters-range-slider'></div>
          </div>
          <div class='rbl-settings-title'>Настройки PDF</div>
          <label class='rbl-settings-row form-switcher'>
            <span class='rbl-settings-label'>
              Скачивать с картинками
            </span>
            <span class='switcher-input'>
              <input class='switcher-input__box' type='checkbox' id='checkbox-download-pdf-images' ${getSetting(
    'setting-download-pdf-images') === 'true' ? 'checked' : ''} />
              <span class='switcher-input__slider'></span>
            </span>
          </label>
          <div class='rbl-settings-row rbl-settings-range'>
            <div class='rbl-settings-range-head'>
              <span class='rbl-settings-label'>Размер шрифта заголовка Тома</span>
              <output id='output-pdf-volume-font-size'></output>
            </div>
            <input type='range' id='input-pdf-volume-font-size' min='16' max='60' value='${getSetting(
    'setting-pdf-volume-font-size')}'/>
          </div>
          <div class='rbl-settings-row rbl-settings-range'>
            <div class='rbl-settings-range-head'>
              <span class='rbl-settings-label'>Размер шрифта заголовка Главы</span>
              <output id='output-pdf-chapter-font-size'></output>
            </div>
            <input type='range' id='input-pdf-chapter-font-size' min='12' max='48' value='${getSetting(
    'setting-pdf-chapter-font-size')}'/>
          </div>
          <div class='rbl-settings-row rbl-settings-range'>
            <div class='rbl-settings-range-head'>
              <span class='rbl-settings-label'>Размер шрифта основного текста</span>
              <output id='output-pdf-common-font-size'></output>
            </div>
            <input type='range' id='input-pdf-common-font-size' min='8' max='36' value='${getSetting(
    'setting-pdf-common-font-size')}'/>
          </div>
          </div>
          <div class='rbl-settings-footer'>
          <button id='apply-settings-btn' class='btn is-filled is-full-width variant-primary size-lg' type='button'>
            ${applyIcon}
            <span>Применить</span>
          </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  popup.appendChild(menu);
  menu.querySelector('.popup-overlay').addEventListener('click', () => closeSettingsMenu());
  const outputMinChapter = document.getElementById('output-min-chapter');
  const outputMaxChapter = document.getElementById('output-max-chapter');
  const chaptersRangeSlider = document.getElementById('chapters-range-slider');
  rangeSlider(
    chaptersRangeSlider,
    {
      min: 1, max: chaptersCount, value: [minChapter, maxChapter], onInput: (value, _userInteraction) => {
        outputMinChapter.textContent = value[0];
        outputMaxChapter.textContent = value[1];
      }
    }
  );
  const checkboxDownloadByVolumes = document.getElementById('checkbox-download-by-volumes');
  const checkboxDownloadPdfImages = document.getElementById('checkbox-download-pdf-images');
  const checkboxDownloadAllChapters = document.getElementById('checkbox-download-all-chapters');
  const chaptersRangeSliderPanel = document.getElementById('chapters-range-slider-panel');
  checkboxDownloadAllChapters.addEventListener('change', (e) => {
    chaptersRangeSliderPanel.hidden = !!e.target.checked;
  });
  const inputPdfVolumeFontSize = document.getElementById('input-pdf-volume-font-size');
  const outputPdfVolumeFontSize = document.getElementById('output-pdf-volume-font-size');
  bindRangeOutput(inputPdfVolumeFontSize, outputPdfVolumeFontSize);
  const inputPdfChapterFontSize = document.getElementById('input-pdf-chapter-font-size');
  const outputPdfChapterFontSize = document.getElementById('output-pdf-chapter-font-size');
  bindRangeOutput(inputPdfChapterFontSize, outputPdfChapterFontSize);
  const inputPdfCommonFontSize = document.getElementById('input-pdf-common-font-size');
  const outputPdfCommonFontSize = document.getElementById('output-pdf-common-font-size');
  bindRangeOutput(inputPdfCommonFontSize, outputPdfCommonFontSize);
  const closeButton = document.getElementById('close-settings-btn');
  closeButton.onclick = () => closeSettingsMenu();
  const applyButton = document.getElementById('apply-settings-btn');
  applyButton.addEventListener('click', () => {
    setSetting('setting-download-by-volumes', checkboxDownloadByVolumes.checked);
    setSetting('setting-download-pdf-images', checkboxDownloadPdfImages.checked);
    setSetting('setting-download-all-chapters', checkboxDownloadAllChapters.checked);
    setSetting('setting-chapter-start-index', parseInt(outputMinChapter.textContent, 10) - 1);
    setSetting('setting-chapter-end-index', outputMaxChapter.textContent);
    setSetting('setting-pdf-volume-font-size', inputPdfVolumeFontSize.value);
    setSetting('setting-pdf-chapter-font-size', inputPdfChapterFontSize.value);
    setSetting('setting-pdf-common-font-size', inputPdfCommonFontSize.value);
  });
}

// Progress Bar
const progress_bar_size = 20;
const progressBarFrames = Array.from({ length: progress_bar_size + 1 },
  (_, i) => `│${'█'.repeat(i)}${'░'.repeat(progress_bar_size - i)}│`);

function initProgress (total) {
  const bottom = getBottom();
  const element = document.createElement('div');
  element.className = 'kp_bm_rbl';
  element.innerHTML = `<div class="kp_ap kp_z">
      <div class="">
        <div id="rbl_progress_bar" class="kp_v">${progressBarFrames[0]} (0/${total})</div>
        <!----><!----></div>
      </div>`;
  bottom.appendChild(element);
}

function updateProgress (title, cur, total) {
  const complete = Math.min(progress_bar_size, Math.trunc((cur * progress_bar_size / total) + .5));
  document.getElementById('rbl_progress_bar').innerText =
    `${title} ${progressBarFrames[complete]} (${cur}/${total})`;
}

function finishProgress () {
  const bottom = getBottom();
  const element = document.getElementsByClassName('kp_bm_rbl')[0];
  if (!bottom || !element) return;
  bottom.removeChild(element);
}

// TXT
function getParagraphText (content) {
  let res = '';
  for (const element of content || []) {
    if (element.type === 'text') res += element.text;
    else if (element.type === 'hardBreak') res += '\n';
  }
  return res;
}

function formatDescription (description) {
  if (description === undefined || description === null) return '';
  if (typeof description === 'string' || description instanceof String) return arrangeText(description);
  if (!Array.isArray(description.content)) return '';
  const chunks = [];
  for (const block of description.content) {
    if (block.type !== 'paragraph' || !block.content) continue;
    const text = arrangeText(getParagraphText(block.content));
    if (text) chunks.push(text);
  }
  return chunks.join('\n');
}

function oldApiTxtProcess (chunks, content) {
  const parser = new DOMParser(), doc = parser.parseFromString(content, 'text/html');
  for (const element of doc.getElementsByTagName('p')) {
    chunks.push(arrangeText(element.innerHTML), '\n');
  }
}

function newApiTxtProcess (chunks, content) {
  for (const elements of content.content) {
    if (elements.type === 'paragraph' && elements.content) {
      chunks.push(arrangeText(getParagraphText(elements.content)), '\n');
    }
  }
}

async function makeVolumeTxt (zip, volumeNum, volume, label) {
  const chunks = [`${label} - Том ${volumeNum}\n\n`];
  for (const chapter of volume) {
    chunks.push(`Глава ${chapter.number}. ${chapter.name}\n\n`);
    const content = chapter.content;
    if (content instanceof String || typeof content === 'string') {
      oldApiTxtProcess(chunks, content);
    } else if (content instanceof Object && content.type === 'doc' && content.content) {
      newApiTxtProcess(chunks, content);
    }
  }
  zip.file(`vol${volumeNum}.txt`, chunks.join(''));
}

// Text
function makeChapterTxt (zip, chapter, label) {
  const chunks = [`${label}\nТом ${chapter.volume} Глава ${chapter.number}. ${chapter.name}\n\n`];
  const content = chapter.content;
  if (content instanceof String || typeof content === 'string') {
    oldApiTxtProcess(chunks, content);
  } else if (content instanceof Object && content.type === 'doc' && content.content) {
    newApiTxtProcess(chunks, content);
  }
  zip.file(`v${chapter.volume}_${chapter.number}.txt`, chunks.join(''));
}

// Chapters .txt
async function txtProcess (zip, chapters, ranobeId, label, last_chapter) {
  let count = 0;
  if (getSetting('setting-download-by-volumes') === 'true') {
    const chaptersData = [];
    for (const chapterData of chapters) {
      const chapter = await getChapter(ranobeId, chapterData);
      chaptersData.push(chapter);
      logChapter(chapter, last_chapter);
      updateProgress('загружаем', ++count, chapters.length);
    }
    const volumes = Object.entries(groupByKey(chaptersData, 'volume'));
    count = 0;
    updateProgress('собираем Том', count, volumes.length);
    for (const [volumeNum, volume] of volumes) {
      await makeVolumeTxt(zip, volumeNum, volume, label);
      updateProgress('собираем Том', ++count, volumes.length);
    }
  } else {
    for (const chapterData of chapters) {
      const chapter = await getChapter(ranobeId, chapterData);
      // Text
      makeChapterTxt(zip, chapter, label);
      logChapter(chapter, last_chapter);
      updateProgress('загружаем', ++count, chapters.length);
    }
  }
}

// PDF
const pdfPageSize = 'A4';
const pdfPortraitLayout = 'portrait';
const pdfLandscapeLayout = 'landscape';
const pdfA4PortraitWidth = 595;
const pdfImageMargin = 5;
const pdfImageTextGap = 8;
const pdfImageMaxScale = 1;
const pdfLandscapeMinRatio = 1.15;
const pdfLandscapeMaxRatio = 2.6;
const pdfLandscapeMinPageFill = .35;

function addPdfPage (pdf, layout = pdfPortraitLayout) {
  pdf.addPage({ size: pdfPageSize, layout });
}

function ensurePdfPortraitPage (pdf) {
  if (pdf.page.layout === pdfPortraitLayout) return false;
  addPdfPage(pdf);
  return true;
}

function getPdfImageSize (image) {
  if (image.orientation > 4) return { width: image.height, height: image.width };
  return { width: image.width, height: image.height };
}

function isPdfLandscapeImage (size) {
  return size.width > size.height && size.width / size.height >= pdfLandscapeMinRatio;
}

function isLargePdfLandscapeImage (size) {
  if (!isPdfLandscapeImage(size)) return false;
  const ratio = size.width / size.height;
  if (ratio > pdfLandscapeMaxRatio || size.width <= pdfA4PortraitWidth - (pdfImageMargin << 1)) return false;
  const width = 842 - (pdfImageMargin << 1);
  const height = Math.round(width / ratio);
  return height >= 595 * pdfLandscapeMinPageFill;
}

function getPdfImagePlacement (pdf, size) {
  const maxWidth = pdf.page.width - (pdfImageMargin << 1);
  const maxHeight = pdf.page.height - (pdfImageMargin << 1);
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height, pdfImageMaxScale);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return {
    width,
    height,
    x: Math.round((pdf.page.width - width) / 2)
  };
}

function getPdfImageStartY (pdf, isImageWasLast, currentY) {
  if (isImageWasLast) return currentY;
  if (pdf.y > pdf.page.margins.top) return pdf.y + pdfImageTextGap;
  return pdfImageMargin;
}

function procPdfTxt (pdf, text, isImageWasLast, currentY) {
  if (ensurePdfPortraitPage(pdf)) isImageWasLast = false;
  let startY = isImageWasLast ? currentY + pdfImageTextGap : pdf.y;
  if (startY >= pdf.page.height - pdf.page.margins.bottom) {
    addPdfPage(pdf);
    startY = pdf.y;
  }
  pdf.text(arrangeText(text), pdf.x, startY).moveDown();
  return false;
}

async function procPdfImg (pdf, url, isImageWasLast, currentY) {
  const img = await getImage(url);
  if (!img || img.byteLength <= 0) return { isImageWasLast, currentY };
  try {
    const image = pdf.openImage(img);
    const size = getPdfImageSize(image);
    if (isLargePdfLandscapeImage(size)) {
      addPdfPage(pdf, pdfLandscapeLayout);
      const place = getPdfImagePlacement(pdf, size);
      pdf.image(image, place.x, Math.round((pdf.page.height - place.height) / 2), { width: place.width });
      return { isImageWasLast: true, currentY: pdf.page.height };
    }
    if (ensurePdfPortraitPage(pdf)) isImageWasLast = false;
    const place = getPdfImagePlacement(pdf, size);
    let startY = getPdfImageStartY(pdf, isImageWasLast, currentY);
    if ((startY + place.height) > pdf.page.height) {
      addPdfPage(pdf);
      startY = pdfImageMargin;
    }
    pdf.image(image, place.x, startY, { width: place.width });
    isImageWasLast = true;
    currentY = startY + place.height;
  } catch (e) {
    console.error(`ошибка при обработке картинку с url: ${url}`, e);
  }
  return { isImageWasLast, currentY };
}

async function oldApiPdfProcess (pdf, content) {
  const parser = new DOMParser(), doc = parser.parseFromString(content, 'text/html');
  const downloadPdfImages = getSetting('setting-download-pdf-images') === 'true';
  let isImageWasLast = false, currentY = 0;
  for (const element of doc.querySelectorAll(downloadPdfImages ? 'p,img' : 'p')) {
    const nodeName = element.nodeName;
    if (nodeName === 'P') {
      isImageWasLast = procPdfTxt(pdf, element.innerHTML, isImageWasLast, currentY);
    }
    if (downloadPdfImages && nodeName === 'IMG' && element.src && element.src.startsWith(`https://${domain}`)) {
      const __ret = await procPdfImg(pdf, element.src, isImageWasLast, currentY);
      isImageWasLast = __ret.isImageWasLast;
      currentY = __ret.currentY;
    }
  }
}

async function newApiPdfProcess (pdf, content, chapter) {
  const downloadPdfImages = getSetting('setting-download-pdf-images') === 'true';
  let imgUrls;
  if (downloadPdfImages) {
    imgUrls = {};
    for (const attachment of chapter.attachments || []) imgUrls[attachment.name] = `https://${domain}${attachment.url}`;
  }
  let isImageWasLast = false, currentY = 0;
  for (const elements of content.content) {
    if (elements.type === 'paragraph' && elements.content) {
      isImageWasLast = procPdfTxt(pdf, getParagraphText(elements.content), isImageWasLast, currentY);
    }
    const images = elements.attrs?.images;
    if (downloadPdfImages && elements.type === 'image' && images) {
      for (const img of images) {
        const url = imgUrls[img.image];
        if (!url) continue;
        const __ret = await procPdfImg(pdf, url, isImageWasLast, currentY);
        isImageWasLast = __ret.isImageWasLast;
        currentY = __ret.currentY;
      }
    }
  }
}

function waitPdfFinish (stream, zip, name) {
  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      zip.file(name, stream.toBlob('application/pdf'), { binary: true, compression: 'STORE' });
      resolve();
    });
    stream.on('error', reject);
  });
}

function getPdfFontSizes () {
  return {
    volume: getIntSetting('setting-pdf-volume-font-size', defaultSettings.pdfVolumeFontSize),
    chapter: getIntSetting('setting-pdf-chapter-font-size', defaultSettings.pdfChapterFontSize),
    common: getIntSetting('setting-pdf-common-font-size', defaultSettings.pdfCommonFontSize)
  };
}

async function makePdf (pdf, chapter, commonFontSize) {
  pdf.fontSize(commonFontSize);
  const content = chapter.content;
  if (content instanceof String || typeof content === 'string') {
    await oldApiPdfProcess(pdf, content);
  } else if (content instanceof Object && content.type === 'doc' && content.content) {
    await newApiPdfProcess(pdf, content, chapter);
  }
}

async function makeVolumePdf (zip, volumeNum, volume, label) {
  const pdf = new PDFDocument({ size: pdfPageSize });
  const stream = pdf.pipe(blobStream());
  const finishPromise = waitPdfFinish(stream, zip, `vol${volumeNum}.pdf`);
  const font = await getFont();
  const fontSize = getPdfFontSizes();
  pdf.font(font);
  pdf.fontSize(fontSize.volume).text(`${label} - Том ${volumeNum}`);
  for (const chapter of volume) {
    addPdfPage(pdf);
    pdf.fontSize(fontSize.chapter).text(`Глава ${chapter.number}. ${chapter.name}\n\n`);
    await makePdf(pdf, chapter, fontSize.common);
  }
  pdf.end();
  await finishPromise;
}

async function makeChapterPdf (zip, chapter, label) {
  const pdf = new PDFDocument({ size: pdfPageSize });
  const stream = pdf.pipe(blobStream());
  const finishPromise = waitPdfFinish(stream, zip, `v${chapter.volume}_${chapter.number}.pdf`);
  const font = await getFont();
  const fontSize = getPdfFontSizes();
  pdf.font(font);
  pdf.fontSize(fontSize.volume).text(`${label}\n`);
  pdf.fontSize(fontSize.chapter).text(`Том ${chapter.volume} Глава ${chapter.number}. ${chapter.name}\n\n`);
  await makePdf(pdf, chapter, fontSize.common);
  pdf.end();
  await finishPromise;
}

// Chapters .pdf
async function pdfProcess (zip, chapters, ranobeId, label, last_chapter) {
  let count = 0;
  const chaptersData = [];
  for (const chapterData of chapters) {
    const chapter = await getChapter(ranobeId, chapterData);
    chaptersData.push(chapter);
    logChapter(chapter, last_chapter);
    updateProgress('загружаем', ++count, chapters.length);
  }
  if (getSetting('setting-download-by-volumes') === 'true') {
    const volumes = Object.entries(groupByKey(chaptersData, 'volume'));
    count = 0;
    updateProgress('собираем PDF', count, volumes.length);
    for (const [volumeNum, volume] of volumes) {
      await makeVolumePdf(zip, volumeNum, volume, label);
      updateProgress('собираем PDF', ++count, volumes.length);
    }
  } else {
    count = 0;
    updateProgress('собираем PDF', count, chaptersData.length);
    for (const chapter of chaptersData) {
      await makeChapterPdf(zip, chapter, label);
      updateProgress('собираем PDF', ++count, chaptersData.length);
    }
  }
}

function getChaptersRange (chapters) {
  if (getSetting('setting-download-all-chapters') === 'true') {
    return chapters;
  }
  const count = chapters.length;
  const start = getIntSetting('setting-chapter-start-index');
  const end = getIntSetting('setting-chapter-end-index');
  return chapters.slice(Math.min(start, count - 1), (end > count || end < 0) ? count : end);
}

function getZipOptions (type, callback) {
  if (callback === pdfProcess) return { type, compression: 'STORE', streamFiles: true };
  return { type, compression: 'DEFLATE', compressionOptions: { level: 1 }, streamFiles: true };
}

function createZipProgress () {
  let lastPercent = -1;
  return (metadata) => {
    const percent = Math.trunc(metadata.percent);
    if (percent === lastPercent) return;
    lastPercent = percent;
    updateProgress('архивируем', percent, 100);
  };
}

async function download (e, callback) {
  notify('Загрузка начата!');

  try {
    // Zip
    const zip = new JSZip();

    // Data
    let label;

    const { ranobeId, ranobeData } = await getRanobe();
    const slug = ranobeId.replace(mangaNumberRegex, '');
    if ('toast' in ranobeData) {
      // Ranobe Title
      label = document.getElementsByClassName('nt_nv')[0].innerText;
      const originalLabel = document.getElementsByClassName('nt_nw')[0].innerText;
      const description = document.getElementsByClassName('ur_p')[0].innerText;

      // info.txt
      const infoText = `${label}\n${originalLabel}\n\n` + `--==[ Описание ]==--\n${description}\n\n` +
        `--==[ Страница ]==-\nhttps://${domain}/ru/book/${ranobeId}`;
      zip.file(`info.txt`, infoText);
    } else {
      // Ranobe Title
      label = formatRanobeLabel(ranobeData);

      // info.txt
      const infoText = `${label}\n${ranobeData.name}\n\n` + `--==[ Описание ]==--\n${formatDescription(ranobeData.summary)}\n\n` +
        `--==[ Информация ]==--\nТип: ${ranobeData.type.label}\nВыпуск: ${ranobeData.releaseDate} г.\nСтатус: ${ranobeData.status.label}\nПеревод: ${ranobeData.scanlateStatus.label}\n\n` +
        `--==[ Страница ]==-\nhttps://${domain}/ru/book/${ranobeData.slug_url}`;
      zip.file(`info.txt`, infoText);
    }
    logStartDownload(label, slug);

    const fetchChapters = await fetchRanobeChapters(ranobeId);
    const chapters = getChaptersRange(fetchChapters);
    const last_chapter = chapters[chapters.length - 1];
    initProgress(chapters.length);
    await callback(zip, chapters, ranobeId, label, last_chapter);

    // Compressing
    updateProgress('архивируем', 0, 100);
    const zipProgress = createZipProgress();
    if (JSZip.support.blob) {
      // если браузер поддерживает Blob, скачиваем его
      const blob = await zip.generateAsync(getZipOptions('blob', callback), zipProgress);
      saveAs(blob, `${slug}.zip`);
    } else {
      const base64 = await zip.generateAsync(getZipOptions('base64', callback), zipProgress);
      const a = document.createElement('a');
      a.href = 'data:application/zip;base64,' + base64;
      a.download = `${slug}.zip`;
      a.click();
    }
  } catch (e) {
    console.error(e);
    finishProgress();
    notify('Во время загрузки произошла ошибка!');
    return;
  }
  finishProgress();
  notify('Загрузка успешно закончена!');
}

// Button creating
function getButtonTemplate (header) {
  for (const item of header.children) {
    if (item.tagName === 'DIV' && item.dataset.rblArchiverButton !== 'true') return item;
  }
  return header.getElementsByTagName('div')[0];
}

function mountButton (config) {
  const header = getHeader();
  if (!header) return false;
  const existing = document.getElementById(config.id);
  if (existing?.parentElement === header && existing.firstElementChild?.tagName === 'BUTTON') return true;
  if (existing) existing.remove();
  const template = getButtonTemplate(header);
  if (!template?.firstChild) return false;
  const button = document.createElement('div');
  button.id = config.id;
  button.dataset.rblArchiverButton = 'true';
  button.className = template.className || '';
  const control = document.createElement('button');
  control.className = template.firstElementChild?.className || 'btn is-icon';
  control.type = 'button';
  control.innerHTML = config.icon;
  control.title = config.title;
  control.style.cursor = 'pointer';
  button.appendChild(control);
  header.insertBefore(button, header.firstChild);
  control.addEventListener('click', config.listener);
  return true;
}

function mountButtons () {
  if (areButtonsMounted()) return true;
  for (const button of buttons) {
    const element = document.getElementById(button.id);
    if (element) element.remove();
  }
  let res = true;
  for (const button of buttons) res = mountButton(button) && res;
  return res;
}

function areButtonsMounted () {
  const header = getHeader();
  if (!header) return false;
  for (const button of buttons) {
    const element = document.getElementById(button.id);
    if (element?.parentElement !== header || element.firstElementChild?.tagName !== 'BUTTON') return false;
  }
  return true;
}

function scheduleMountButtons () {
  if (buttonsMountTimer || areButtonsMounted()) return;
  buttonsMountTimer = setTimeout(() => {
    buttonsMountTimer = undefined;
    mountButtons();
  }, 100);
}

function observeButtons () {
  if (buttonsObserver) return;
  buttonsObserver = new MutationObserver(scheduleMountButtons);
  buttonsObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function registerButton (id, icon, title, listener) {
  buttons.push({ id: `rbl-archiver-${id}`, icon, title, listener });
}

function registerDownloadButton (id, icon, title, callback) {
  registerButton(id, icon, title, async (e) => {
    await download(e, callback);
  });
}

initSettings();
registerButton('settings', gearIcon, 'Настройки', async () => showSettingsMenu());
registerDownloadButton('txt', txtIcon, 'Скачать TXT', txtProcess);
registerDownloadButton('pdf', pdfIcon, 'Скачать PDF', pdfProcess);
mountButtons();
observeButtons();
