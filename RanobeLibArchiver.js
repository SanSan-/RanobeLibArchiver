// ==UserScript==
// @name         RanobeLib Archiver
// @namespace    https://github.com/SanSan-/RanobeLibArchiver
// @version      1.7
// @description  Ranobe from ranobelib.me -> .zip file of .txt
// @author       An1by & SanSan
// @include      /^https?:\/\/ranobelib\.me\/ru\/book\/[\w\-]+(?:\?.+|#.*)?$/
// @icon         https://ranobelib.me/images/logo/rl/favicon.ico
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.9.1/jszip.min.js
// @require      https://github.com/foliojs/pdfkit/releases/download/v0.15.0/pdfkit.standalone.js
// @require      https://cdn.jsdelivr.net/npm/blob-stream@0.1.3/+esm
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @grant        none
// ==/UserScript==

///////////// FUNCTIONS
// fetch
async function jsonFetch (url) {
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  return JSON.parse(text);
}

async function fetchRanobeChapters (ranobeId) {
  return (await jsonFetch(`https://api.lib.social/api/manga/${ranobeId}/chapters`)).data;
}

async function fetchChapter (ranobeId, volume, number) {
  return (await jsonFetch(
    `https://api.lib.social/api/manga/${ranobeId}/chapter?number=${number}&volume=${volume}`)).data;
}

async function fetchRanobeData (ranobeId) {
  return (await jsonFetch(
    `https://api.lib.social/api/manga/${ranobeId}?fields[]=background&fields[]=eng_name&fields[]=otherNames&fields[]=summary&fields[]=releaseDate&fields[]=type_id&fields[]=caution&fields[]=views&fields[]=close_view&fields[]=rate_avg&fields[]=rate&fields[]=genres&fields[]=tags&fields[]=teams&fields[]=franchise&fields[]=authors&fields[]=publisher&fields[]=userRating&fields[]=moderated&fields[]=metadata&fields[]=metadata.count&fields[]=metadata.close_comments&fields[]=manga_status_id&fields[]=chap_count&fields[]=status_id&fields[]=artists&fields[]=format`)).data;
}

async function getFont () {
  return (await fetch('https://ranobelib.me/build/assets/OpenSans-Regular-C58Z07Fu.ttf')).arrayBuffer();
}

async function getImage (url) {
  if (/\.(jpe?g|png)$/gmi.test(url)) {
    const response = await fetch(url);
    if (response.status === 200) {
      return response.arrayBuffer();
    }
  }
}

async function getChapter (ranobeId, chapterData) {
  // ставим задержку 750 мс, чтобы не схватить 429 на больших (100+ глав) проектах
  return await new Promise(resolve => setTimeout(resolve, 750))
    .then(() => fetchChapter(ranobeId, chapterData.volume, chapterData.number));
}

// Formatting
function formatRanobeLabel (json) {
  if ('rus_name' in json) {
    return json.rus_name;
  }
  if ('eng_name' in json) {
    return json.eng_name;
  }
  return json.name;
}

// RegExp
const mangaNumberRegex = new RegExp('^\\d+(--)');

function arrangeText (text) {
  return text.replace(/\s+|&nbsp;/gi, ' ').replace(/\<br\>/gi, '\n').replace(/<\s*[^>]*>/gi, '')
    .replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

// utils
function groupByKey (array, key) {
  return array
    .reduce((acc, obj) => {
      if (obj[key] === undefined) {
        return acc;
      }
      return Object.assign(acc, { [obj[key]]: (acc[obj[key]] || []).concat(obj) });
    }, {});
}

// selection
function getHeader () {
  return document.querySelectorAll('.page > div > div.container > div')[2];
}

function getBottom () {
  return document.querySelectorAll('#app > div')[1];
}

function getPopupRoot () {
  return document.querySelector('div.popup-root');
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
      <div class="kp_bw">${infoIcon}</div>
      <div class=""><div class="kp_v">${text}</div></div>
    </div>`;
  bottom.appendChild(element);

  setTimeout(() => {
    bottom.removeChild(element);
  }, 3000);
}

// Settings
let defaultSettings = {
  downloadByVolumes: true,
  downloadPdfImages: true,
  pdfVolumeFontSize: 21,
  pdfChapterFontSize: 18,
  pdfCommonFontSize: 11
};

function getSetting (id) {
  const setting = document.getElementById(id);
  return setting.innerText;
}

function initSettings () {
  const popup = getPopupRoot();
  const globalSettings = document.createElement('div');
  globalSettings.id = 'global-settings';
  globalSettings.innerHTML = `<div hidden style="display: none">
    <div id="setting-download-by-volumes">${defaultSettings.downloadByVolumes}</div>
    <div id="setting-download-pdf-images">${defaultSettings.downloadPdfImages}</div>
    <div id="setting-pdf-volume-font-size">${defaultSettings.pdfVolumeFontSize}</div>
    <div id="setting-pdf-chapter-font-size">${defaultSettings.pdfChapterFontSize}</div>
    <div id="setting-pdf-common-font-size">${defaultSettings.pdfCommonFontSize}</div>
  </div>`;
  popup.appendChild(globalSettings);
}

function closeSettingsMenu () {
  const popup = getPopupRoot();
  const menu = document.getElementById('popup-settings-menu');
  popup.removeChild(menu);
}

function showSettingsMenu () {
  const popup = getPopupRoot();
  const menu = document.createElement('div');
  menu.id = 'popup-settings-menu';
  menu.innerHTML = `<div class="popup is-hidden" data-type="side">
    <div class="popup-overlay"></div>
    <div class="popup__inner">
      <div class="popup__content scrollable" role="dialog" aria-modal="true" tabindex="-1">
        <div class="xg_e">
          <div class="card-inline _fillable _border-bottom _padding-sm">
            <div class="cover _shadow _size-sm">
              <div class="cover__wrap" style="padding-top: 0">${gearIcon}</div>
            </div>
            <div class="card-inline__body">
              <div class="card-inline__name">Настройки RanobeLib Archiver</div>
            </div>
            <div>
              <a id="close-settings-btn" title="закрыть">${closeIcon}</a>
            </div>
          </div>
          <div class="xg_z" style="flex-grow: 0">
            <div class="zj_am">
              <div class="zs_bn">
                <div class="zs_ap"><span>Общие настройки</span></div>
              </div>
            </div>
            <div class="zj_am" id="common-settings-panel" >
              <div class="zs_bn">
                <div class="zs_ap">Объединять главы по томам</div>
                <span class="zj_f5">
                  <input type="checkbox" id="checkbox-download-by-volumes" ${getSetting(
    'setting-download-by-volumes') === 'true' ? 'checked' : ''} />
                </span>
              </div>
            </div>
          </div>
          <div class="xg_z scrollable">
            <div class="zj_am">
              <div class="zs_bn">
                <div class="zs_ap"><span>Настройки PDF</span></div>
              </div>
            </div>
            <div class="zj_am" id="pdf-settings-panel">
              <div class="zs_bn">
                <div class="zs_ap">Скачивать с картинками</div>
                <span class="zj_f5">
                  <input type="checkbox" id="checkbox-download-pdf-images" ${getSetting(
    'setting-download-pdf-images') === 'true' ? 'checked' : ''} />
                </span>
              </div>
              <div class="zs_bn">
                <div class="zs_ap">Размер шрифта заголовка Тома</div>
                <span class="zj_f5">
                  <input type="range" id="input-pdf-volume-font-size" min="16" max="60" value="${getSetting(
    'setting-pdf-volume-font-size')}"/>
                  <output id="output-pdf-volume-font-size"></output>
                </span>
              </div>
              <div class="zs_bn">
                <div class="zs_ap">Размер шрифта заголовка Главы</div>
                <span class="zj_f5">
                  <input type="range" id="input-pdf-chapter-font-size" min="12" max="48" value="${getSetting(
    'setting-pdf-chapter-font-size')}"/>
                  <output id="output-pdf-chapter-font-size"></output>
                </span>
              </div>
              <div class="zs_bn">
                <div class="zs_ap">Размер шрифта основного текста</div>
                <span class="zj_f5">
                  <input type="range" id="input-pdf-common-font-size" min="8" max="36" value="${getSetting(
    'setting-pdf-common-font-size')}"/>
                  <output id="output-pdf-common-font-size"></output>
                </span>
              </div>
            </div>
          </div>
          <div class="xg_eh">
            <button id="apply-settings-btn" class="btn is-filled is-full-width variant-primary" type="button">
              ${applyIcon}
              <span>Применить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  popup.appendChild(menu);
  const inputPdfVolumeFontSize = document.getElementById('input-pdf-volume-font-size');
  const outputPdfVolumeFontSize = document.getElementById('output-pdf-volume-font-size');
  outputPdfVolumeFontSize.textContent = inputPdfVolumeFontSize.value;
  inputPdfVolumeFontSize.addEventListener('input', (event) => {
    outputPdfVolumeFontSize.textContent = event.target.value;
  });
  const inputPdfChapterFontSize = document.getElementById('input-pdf-chapter-font-size');
  const outputPdfChapterFontSize = document.getElementById('output-pdf-chapter-font-size');
  outputPdfChapterFontSize.textContent = inputPdfChapterFontSize.value;
  inputPdfChapterFontSize.addEventListener('input', (event) => {
    outputPdfChapterFontSize.textContent = event.target.value;
  });
  const inputPdfCommonFontSize = document.getElementById('input-pdf-common-font-size');
  const outputPdfCommonFontSize = document.getElementById('output-pdf-common-font-size');
  outputPdfCommonFontSize.textContent = inputPdfCommonFontSize.value;
  inputPdfCommonFontSize.addEventListener('input', (event) => {
    outputPdfCommonFontSize.textContent = event.target.value;
  });
  const closeButton = document.getElementById('close-settings-btn');
  closeButton.onclick = () => closeSettingsMenu();
  const applyButton = document.getElementById('apply-settings-btn');
  applyButton.addEventListener('click', () => {
    document.getElementById('setting-download-by-volumes').innerText =
      document.getElementById('checkbox-download-by-volumes').checked;
    document.getElementById('setting-download-pdf-images').innerText =
      document.getElementById('checkbox-download-pdf-images').checked;
    document.getElementById('setting-pdf-volume-font-size').innerText =
      document.getElementById('input-pdf-volume-font-size').value;
    document.getElementById('setting-pdf-chapter-font-size').innerText =
      document.getElementById('input-pdf-chapter-font-size').value;
    document.getElementById('setting-pdf-common-font-size').innerText =
      document.getElementById('input-pdf-common-font-size').value;
  });
}

// Progress Bar
const progress_bar_size = 20;

function initProgress (total) {
  const bottom = getBottom();
  const element = document.createElement('div');
  element.className = 'kp_bm_rbl';
  element.innerHTML = `<div class="kp_ap kp_z">
      <div class="">
        <div id="rbl_progress_bar" class="kp_v">│${Array(0).fill('█').join('')}${Array(progress_bar_size).fill('░')
    .join('')}│ (0/${total})</div>
        <!----><!----></div>
      </div>`;
  bottom.appendChild(element);
}

function updateProgress (title, cur, total) {
  const complete = Math.round((cur * 1.0 / total) * progress_bar_size);
  const empty = progress_bar_size - complete;
  document.getElementById('rbl_progress_bar').innerText =
    `${title} │${Array(complete).fill('█').join('')}${Array(empty).fill('░').join('')}│ (${cur}/${total})`;
}

function finishProgress () {
  const bottom = getBottom();
  const element = document.getElementsByClassName('kp_bm_rbl')[0];
  bottom.removeChild(element);
}

// TXT
function oldApiTxtProcess (builder, content) {
  const parser = new DOMParser(), doc = parser.parseFromString(content, 'text/html');
  for (const element of doc.getElementsByTagName('p')) {
    builder += arrangeText(element.innerHTML) + '\n';
  }
  return builder;
}

function newApiTxtProcess (builder, content) {
  for (const elements of content.content) {
    if (elements.type === 'paragraph' && elements.content) {
      builder += arrangeText(elements.content.filter(element => element.type === 'text')
        .reduce((acc, next) => acc + next.text, '')) + '\n';
    }
  }
  return builder;
}

async function makeVolumeTxt (zip, volumeNum, volume, label) {
  let builder = `${label} - Том ${volumeNum}\n\n`;
  for (const chapter of volume) {
    builder += `Глава ${chapter.number}. ${chapter.name}\n\n`;
    const content = chapter.content;
    if (content instanceof String || typeof content === 'string') {
      builder = oldApiTxtProcess(builder, content);
    } else if (content instanceof Object && content.type === 'doc' && content.content) {
      builder = newApiTxtProcess(builder, content);
    }
  }
  zip.file(`vol${volumeNum}.txt`, builder);
}

// Text
function makeChapterTxt (zip, chapter, label) {
  let builder = `${label}\nТом ${chapter.volume} Глава ${chapter.number}. ${chapter.name}\n\n`;
  const content = chapter.content;
  if (content instanceof String || typeof content === 'string') {
    builder = oldApiTxtProcess(builder, content);
  } else if (content instanceof Object && content.type === 'doc' && content.content) {
    builder = newApiTxtProcess(builder, content);
  }
  zip.file(`v${chapter.volume}_${chapter.number}.txt`, builder);
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
  // задержка, чтобы последний том в списке успел сохраниться
  await new Promise(resolve => setTimeout(resolve, 250));
}

// PDF
function procPdfTxt (pdf, text, isImageWasLast, currentY) {
  const startY = isImageWasLast ? currentY : pdf.y;
  pdf.text(arrangeText(text), pdf.x, startY).moveDown();
  return false;
}

async function procPdfImg (pdf, url, isImageWasLast, currentY) {
  const img = await getImage(url);
  if (img && img.byteLength > 0) {
    const dimension = pdf.openImage(img);
    const imgHeight = Math.round((585.0 / dimension.width) * dimension.height);
    const startY = isImageWasLast ? currentY : pdf.y;
    if ((startY + imgHeight) > 842) {
      pdf.addPage();
      pdf.image(img, 5, 0, { width: 585, valign: 'center' });
    } else {
      pdf.image(img, 5, startY, { width: 585, valign: 'center' });
    }
    isImageWasLast = true;
    currentY = pdf.y + imgHeight;
  }
  return { isImageWasLast, currentY };
}

async function oldApiPdfProcess (pdf, content) {
  const parser = new DOMParser(), doc = parser.parseFromString(content, 'text/html');
  let isImageWasLast = false;
  let currentY = 0;
  for (const element of doc.querySelectorAll('p,img')) {
    if (element.nodeName.toLowerCase() === 'p') {
      isImageWasLast = procPdfTxt(pdf, element.innerHTML, isImageWasLast, currentY);
    }
    if (getSetting('setting-download-pdf-images') === 'true' && element.nodeName.toLowerCase() === 'img' &&
      element.src && /^https?:\/\/ranobelib\.me/g.test(element.src)) {
      const __ret = await procPdfImg(pdf, element.src, isImageWasLast, currentY);
      isImageWasLast = __ret.isImageWasLast;
      currentY = __ret.currentY;
    }
  }
}

async function newApiPdfProcess (pdf, content, chapter) {
  const imgUrls = chapter.attachments.reduce(
    (acc, next) => ({ ...acc, [next.name]: `https://ranobelib.me${next.url}` }), {});
  let isImageWasLast = false;
  let currentY = 0;
  for (const elements of content.content) {
    if (elements.type === 'paragraph' && elements.content) {
      isImageWasLast =
        procPdfTxt(pdf, elements.content.filter(element => element.type === 'text')
          .reduce((acc, next) => acc + next.text, ''), isImageWasLast, currentY);
    }
    if (getSetting('setting-download-pdf-images') === 'true' && elements.type === 'image' && elements.attrs &&
      elements.attrs['images']) {
      for (const img of elements.attrs['images']) {
        const __ret = await procPdfImg(pdf, imgUrls[img.image], isImageWasLast, currentY);
        isImageWasLast = __ret.isImageWasLast;
        currentY = __ret.currentY;
      }
    }
  }
}

async function makePdf (pdf, chapter) {
  pdf.fontSize(parseInt(getSetting('setting-pdf-common-font-size')) || defaultSettings['pdfCommonFontSize']);
  const content = chapter.content;
  if (content instanceof String || typeof content === 'string') {
    await oldApiPdfProcess(pdf, content);
  } else if (content instanceof Object && content.type === 'doc' && content.content) {
    await newApiPdfProcess(pdf, content, chapter);
  }
}

async function makeVolumePdf (zip, volumeNum, volume, label) {
  const pdf = new PDFDocument({ size: 'A4' });
  const stream = pdf.pipe(blobStream());
  const font = await getFont();
  pdf.font(font);
  pdf.fontSize(parseInt(getSetting('setting-pdf-volume-font-size')) || defaultSettings['pdfVolumeFontSize'])
    .text(`${label} - Том ${volumeNum}`);
  for (const chapter of volume) {
    pdf.addPage();
    pdf.fontSize(parseInt(getSetting('setting-pdf-chapter-font-size')) || defaultSettings['pdfChapterFontSize'])
      .text(`Глава ${chapter.number}. ${chapter.name}\n\n`);
    await makePdf(pdf, chapter);
  }
  pdf.end();
  await stream.on('finish', function () {
    zip.file(`vol${volumeNum}.pdf`, stream.toBlob('application/pdf'), { binary: true });
  });
}

async function makeChapterPdf (zip, chapter, label) {
  const pdf = new PDFDocument({ size: 'A4' });
  const stream = pdf.pipe(blobStream());
  const font = await getFont();
  pdf.font(font);
  pdf.fontSize(parseInt(getSetting('setting-pdf-volume-font-size')) || defaultSettings['pdfVolumeFontSize'])
    .text(`${label}\n`);
  pdf.fontSize(parseInt(getSetting('setting-pdf-chapter-font-size')) || defaultSettings['pdfChapterFontSize'])
    .text(`Том ${chapter.volume} Глава ${chapter.number}. ${chapter.name}\n\n`);
  await makePdf(pdf, chapter);
  pdf.end();
  await stream.on('finish', function () {
    zip.file(`v${chapter.volume}_${chapter.number}.pdf`, stream.toBlob('application/pdf'), { binary: true });
  });
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
  // задержка, чтобы последний том в списке успел сохраниться
  await new Promise(resolve => setTimeout(resolve, 250));
}

async function download (e, callback) {
  notify('Загрузка начата!');

  try {
    // Zip
    const zip = new JSZip();

    // Data
    const path = window.location.pathname.split('/');
    const ranobeId = path[path.length - 1];

    let label;

    const ranobeData = await fetchRanobeData(ranobeId);
    const slug = ranobeId.replace(mangaNumberRegex, '');
    if ('toast' in ranobeData) {
      // Ranobe Title
      label = document.getElementsByClassName('nt_nv')[0].innerText;
      const originalLabel = document.getElementsByClassName('nt_nw')[0].innerText;
      const description = document.getElementsByClassName('ur_p')[0].innerText;

      // info.txt
      const infoText = `${label}\n${originalLabel}\n\n` + `--==[ Описание ]==--\n${description}\n\n` +
        `--==[ Страница ]==-\nhttps://ranobelib.me/ru/book/${ranobeId}`;
      zip.file(`info.txt`, infoText);
    } else {
      // Ranobe Title
      label = formatRanobeLabel(ranobeData);

      // info.txt
      const infoText = `${label}\n${ranobeData.name}\n\n` + `--==[ Описание ]==--\n${ranobeData.summary}\n\n` +
        `--==[ Информация ]==--\nТип: ${ranobeData.type.label}\nВыпуск: ${ranobeData.releaseDate} г.\nСтатус: ${ranobeData.status.label}\nПеревод: ${ranobeData.scanlateStatus.label}\n\n` +
        `--==[ Страница ]==-\nhttps://ranobelib.me/ru/book/${ranobeData.slug_url}`;
      zip.file(`info.txt`, infoText);
    }
    logStartDownload(label, slug);

    const chapters = await fetchRanobeChapters(ranobeId);
    const last_chapter = chapters[chapters.length - 1];
    initProgress(chapters.length);
    await callback(zip, chapters, ranobeId, label, last_chapter);

    // Compressing
    updateProgress('архивируем', 0, 1);
    if (JSZip.support['blob']) {
      // если браузер поддерживает Blob, скачиваем его
      await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 6
        }
      })
        .then(function (blob) {
          saveAs(blob, `${slug}.zip`);
        });
    } else {
      const base64 = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 6
        }
      });
      const a = document.createElement('a');
      a.href = 'data:application/zip;base64,' + base64;
      a.download = `${slug}.zip`;
      a.click();
    }
  } catch (e) {
    console.log(e);
    finishProgress();
    notify('Во время загрузки произошла ошибка!');
    return;
  }
  finishProgress();
  notify('Загрузка успешно закончена!');
}

// Button creating
function createButton (icon, title, listener) {
  const header = getHeader();
  if (!header) {
    return;
  }
  const button = document.createElement('div');
  button.className = getHeader().getElementsByTagName('div')[0].className || '';
  const be = document.createElement('div');
  be.className = getHeader().getElementsByTagName('div')[0].firstChild.className || '';
  be.innerHTML = icon;
  be.title = title;
  be.style.cursor = 'pointer';
  button.appendChild(be);
  header.insertBefore(button, header.firstChild);
  button.addEventListener('click', listener);
}

function createDownloadButton (icon, title, callback) {
  createButton(icon, title, async (e) => {
    await download(e, callback);
  });
}

initSettings();
createButton(gearIcon, 'Настройки', () => showSettingsMenu());
createDownloadButton(txtIcon, 'Скачать TXT', txtProcess);
createDownloadButton(pdfIcon, 'Скачать PDF', pdfProcess);
