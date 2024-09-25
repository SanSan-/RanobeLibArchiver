// ==UserScript==
// @name         RanobeLib Archiver
// @namespace    https://github.com/SanSan-/RanobeLibArchiver
// @version      1.6
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
      <div class="kp_bw">
        <svg class="svg-inline--fa fa-circle-info" aria-hidden="true" focusable="false" data-prefix="fas"
             data-icon="circle-info" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
          <path class="" fill="currentColor"
                d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0S0 114.6 0 256S114.6 512 256 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-144c-17.7 0-32-14.3-32-32s14.3-32 32-32s32 14.3 32 32s-14.3 32-32 32z"></path>
        </svg>
      </div>
      <div class="">
        <div class="kp_v">${text}</div>
        <!----><!----></div>
    </div>`;

  bottom.appendChild(element);

  setTimeout(() => {
    bottom.removeChild(element);
  }, 3000);
}

// Progress Bar
const progress_bar_size = 20;

function initProgress (total) {
  const fields = getBottom();

  const element = document.createElement('div');
  element.className = 'kp_bm_rbl';
  element.innerHTML = `<div class="kp_ap kp_z">
      <div class="">
        <div id="rbl_progress_bar" class="kp_v">│${Array(0).fill('█').join('')}${Array(progress_bar_size).fill('░')
    .join('')}│ (0/${total})</div>
        <!----><!----></div>
      </div>`;

  fields.appendChild(element);
}

function updateProgress (title, cur, total) {
  const complete = Math.round((cur * 1.0 / total) * progress_bar_size);
  const empty = progress_bar_size - complete;
  document.getElementById('rbl_progress_bar').innerText =
    `${title} │${Array(complete).fill('█').join('')}${Array(empty).fill('░').join('')}│ (${cur}/${total})`;
}

function finishProgress () {
  const fields = getBottom();
  const element = document.getElementsByClassName('kp_bm_rbl')[0];
  fields.removeChild(element);
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

// Chapters .txt
async function process_txt (zip, chapters, ranobeId, label, last_chapter) {
  let count = 0;
  for (const chapterData of chapters) {
    const chapter = await getChapter(ranobeId, chapterData);

    // Text
    let builder = `${label}\nТом ${chapter.volume} Глава ${chapterData.number}\n\n`;

    const content = chapter.content;
    if (content instanceof String || typeof content === 'string') {
      builder = oldApiTxtProcess(builder, content);
    } else if (content instanceof Object && content.type === 'doc' && content.content) {
      builder = newApiTxtProcess(builder, content);
    }
    zip.file(`v${chapter.volume}_${chapter.number}.txt`, builder);
    logChapter(chapter, last_chapter);
    updateProgress('загружаем', ++count, chapters.length);
  }
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
    if (element.nodeName.toLowerCase() === 'img' && element.src && /^https?:\/\/ranobelib\.me/g.test(element.src)) {
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
    if (elements.type === 'image' && elements.attrs && elements.attrs['images']) {
      for (const img of elements.attrs['images']) {
        const __ret = await procPdfImg(pdf, imgUrls[img.image], isImageWasLast, currentY);
        isImageWasLast = __ret.isImageWasLast;
        currentY = __ret.currentY;
      }
    }
  }
}

async function makePdf (zip, volumeNum, volume, label) {
  const pdf = new PDFDocument({ size: 'A4' });
  const stream = pdf.pipe(blobStream());
  const font = await getFont();
  pdf.font(font);
  pdf.fontSize(20).text(`${label} - Том ${volumeNum}`);
  for (const chapter of volume) {
    pdf.addPage();
    pdf.fontSize(18).text(`Глава ${chapter.number}. ${chapter.name}\n\n`);
    pdf.fontSize(11);
    const content = chapter.content;
    if (content instanceof String || typeof content === 'string') {
      await oldApiPdfProcess(pdf, content);
    } else if (content instanceof Object && content.type === 'doc' && content.content) {
      await newApiPdfProcess(pdf, content, chapter);
    }
  }
  pdf.end();
  await stream.on('finish', function () {
    zip.file(`vol${volumeNum}.pdf`, stream.toBlob('application/pdf'), { binary: true });
  });
}

// Chapters .pdf
async function process_pdf (zip, chapters, ranobeId, label, last_chapter) {
  let count = 0;
  const chaptersData = [];
  for (const chapterData of chapters) {
    const chapter = await getChapter(ranobeId, chapterData);
    chaptersData.push(chapter);
    logChapter(chapter, last_chapter);
    updateProgress('загружаем', ++count, chapters.length);
  }
  const volumes = Object.entries(groupByKey(chaptersData, 'volume'));
  count = 0;
  updateProgress('собираем PDF', count, volumes.length);
  for (const [volumeNum, volume] of volumes) {
    await makePdf(zip, volumeNum, volume, label);
    updateProgress('собираем PDF', ++count, volumes.length);
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
function createButton (innerText, title, callback) {
  const upMenu = getHeader();
  if (!upMenu) {
    return;
  }

  const downloadButton = document.createElement('div');
  downloadButton.className = 'r8_c6';
  const be = document.createElement('div');
  be.className = 'r8_be';
  be.innerText = innerText;
  be.title = title;
  be.style.cursor = 'pointer';
  downloadButton.appendChild(be);

  upMenu.insertBefore(downloadButton, upMenu.firstChild);

  downloadButton.addEventListener('click', async (e) => {
    await download(e, callback);
  });
}

createButton('📥', 'Скачать TXT', process_txt);
createButton('📖', 'Скачать PDF', process_pdf);
