// Флаги вместо приписок. Провайдер отдаёт имена вида «FI Финляндия» или
// «Финляндия», поэтому код страны достаём из первых двух латинских букв,
// а если их нет — по названию страны или города на русском и английском.
// Сами флаги лежат рядом в public/flags и нарисованы руками людей (MIT).

import { COUNTRY } from "./countries";

// Знаком ли код стране — решает таблица координат: она полная, поэтому не
// приходится держать второй список из 70 кодов и забывать в нём новые страны.
const known = new Set(Object.keys(COUNTRY));

const words: [RegExp, string][] = [
  [/финлянд|хельсинк|finland|helsink/i, "fi"],
  [/лондон|англи|британ|london|england|britain/i, "gb"],
  [/нидерланд|амстердам|голланд|netherland|amsterdam|holland/i, "nl"],
  [/польш|варшав|poland|warsaw/i, "pl"],
  [/герман|франкфурт|берлин|germany|frankfurt|berlin/i, "de"],
  [/испан|мадрид|spain|madrid/i, "es"],
  [/франц|париж|france|paris/i, "fr"],
  [/швец|стокгольм|sweden|stockholm/i, "se"],
  [/турци|стамбул|turkey|istanbul/i, "tr"],
  [/сша|америк|нью-йорк|usa|united states|new york|america/i, "us"],
  [/канад|canada|toronto|торонто/i, "ca"],
  [/япон|токио|japan|tokyo/i, "jp"],
  [/сингапур|singapore/i, "sg"],
  [/гонконг|hong kong/i, "hk"],
  [/швейцар|switzerland|zurich|цюрих/i, "ch"],
  [/австри|austria|vienna|вена/i, "at"],
  [/итали|милан|italy|milan/i, "it"],
  [/латви|рига|latvia|riga/i, "lv"],
  [/литв|вильнюс|lithuania|vilnius/i, "lt"],
  [/эстони|таллин|estonia|tallinn/i, "ee"],
  [/украин|киев|київ|ukraine|kyiv|kiev/i, "ua"],
  [/казах|kazakh/i, "kz"],
  [/армени|armenia|yerevan|ереван/i, "am"],
  [/грузи|тбилиси|georgia|tbilisi/i, "ge"],
  [/серби|белград|serbia|belgrade/i, "rs"],
  [/румын|romania|bucharest|бухарест/i, "ro"],
  [/болгар|bulgaria|sofia|софия/i, "bg"],
  [/чехи|прага|czech|prague/i, "cz"],
  [/венгри|будапешт|hungary|budapest/i, "hu"],
  [/кипр|cyprus/i, "cy"],
  [/молдов|кишинёв|moldova|chisinau/i, "md"],
  [/узбек|uzbek|tashkent|ташкент/i, "uz"],
  [/вьетнам|vietnam|hanoi|ханой/i, "vn"],
  [/индия|india|mumbai|мумбаи/i, "in"],
  [/индонези|indonesia|jakarta|джакарта/i, "id"],
  [/малайзи|malaysia|kuala/i, "my"],
  [/тайланд|thailand|bangkok|бангкок/i, "th"],
  [/австрали|australia|sydney|сидней/i, "au"],
  [/бразили|brazil|sao paulo|сан-паулу/i, "br"],
  [/аргентин|argentina|buenos/i, "ar"],
  [/мексик|mexico/i, "mx"],
  [/израил|israel|tel aviv|тель-авив/i, "il"],
  [/оаэ|эмират|emirates|dubai|дубай/i, "ae"],
  [/юар|south africa|johannesburg/i, "za"],
  [/нигери|nigeria|lagos|лагос/i, "ng"],
  [/норвеги|осло|norway|oslo/i, "no"],
  [/дания|копенгаген|denmark|copenhagen/i, "dk"],
  [/белорус|минск|belarus|minsk/i, "by"],
  [/молдавия/gi, "md"],
  [/киргиз|бишкек|kyrgyz|bishkek/i, "kg"],
  [/таджик|tajik|dushanbe/i, "tj"],
];

// Эмодзи в именах от провайдера: флаг в начале, огонёк в конце. На Windows
// флаги-эмодзи всё равно рисуются буквами, поэтому из имени их убираем, а флаг
// берём из своей папки.
const LEAD_EMOJI = /^[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\s]+/u;
const TAIL_EMOJI = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+$/u;

/** Пара региональных символов в начале — это и есть код страны. */
function ccFromRegional(text: string): string | null {
  const m = text.match(/^([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u);
  if (!m) return null;
  const a = String.fromCharCode((m[1].codePointAt(0) ?? 0) - 0x1f1e6 + 65);
  const b = String.fromCharCode((m[2].codePointAt(0) ?? 0) - 0x1f1e6 + 65);
  const cc = (a + b).toLowerCase();
  return known.has(cc) ? cc : null;
}

/**
 * Префикс похож на код страны, только если после него идёт имя собственное:
 * «FI Финляндия», «DE Germany». Иначе «It works» теряло бы первое слово,
 * а «No logs» превращалось в Норвегию.
 */
function looksLikeCode(rest: string): boolean {
  return rest.length > 0 && !/^[a-z]/.test(rest);
}

/** Знаком ли нам код страны: нужен, когда страна пришла из разбора подписки. */
export function knownCc(cc: string): boolean {
  return known.has((cc ?? "").trim().toLowerCase());
}

/** Код страны из имени сервера или null, если не разобрали. */
export function ccFromName(name: string): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const regional = ccFromRegional(raw);
  if (regional) return regional;
  const text = raw.replace(LEAD_EMOJI, "").trim();
  if (!text) return null;
  const prefix = text.match(/^([A-Za-z]{2})(?![A-Za-z])\s*[-–—·:]?\s*(.*)$/);
  if (prefix && looksLikeCode(prefix[2])) {
    const cc = prefix[1].toLowerCase();
    if (known.has(cc)) return cc;
  }
  for (const [re, cc] of words) {
    if (re.test(text) && known.has(cc)) return cc;
  }
  return null;
}

/** Имя сервера без служебного кода впереди: «FI Финляндия» → «Финляндия». */
export function stripCc(name: string): string {
  let text = (name ?? "").trim();
  const regional = ccFromRegional(text);
  if (regional) text = text.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}/u, "").trim();
  text = text.replace(LEAD_EMOJI, "").trim();
  const m = text.match(/^([A-Za-z]{2})(?![A-Za-z])\s*[-–—·:]?\s*(.+)$/);
  if (m && known.has(m[1].toLowerCase()) && looksLikeCode(m[2])) text = m[2].trim();
  // и хвост вроде огонька после названия
  text = text.replace(TAIL_EMOJI, "").trim();
  return text;
}

/** Страна по коду — для подписи, когда в имени сервера её нет. */
export function nameOf(cc: string): string | null {
  const names: Record<string, string> = {
    ru: "Россия",
    fi: "Финляндия",
    gb: "Великобритания",
    nl: "Нидерланды",
    pl: "Польша",
    de: "Германия",
    es: "Испания",
    fr: "Франция",
    se: "Швеция",
    tr: "Турция",
    us: "США",
    ca: "Канада",
    jp: "Япония",
    sg: "Сингапур",
    hk: "Гонконг",
    ch: "Швейцария",
    at: "Австрия",
    it: "Италия",
    lv: "Латвия",
    lt: "Литва",
    ee: "Эстония",
    ua: "Украина",
    kz: "Казахстан",
    am: "Армения",
    ge: "Грузия",
    rs: "Сербия",
    ro: "Румыния",
    bg: "Болгария",
    cz: "Чехия",
    hu: "Венгрия",
    cy: "Кипр",
    md: "Молдова",
    uz: "Узбекистан",
    vn: "Вьетнам",
    in: "Индия",
    id: "Индонезия",
    my: "Малайзия",
    th: "Таиланд",
    au: "Австралия",
    br: "Бразилия",
    ar: "Аргентина",
    mx: "Мексика",
    il: "Израиль",
    ae: "ОАЭ",
    za: "ЮАР",
    ng: "Нигерия",
    no: "Норвегия",
    dk: "Дания",
    by: "Беларусь",
    tj: "Таджикистан",
    kg: "Киргизия",
  };
  const code = (cc ?? "").trim().toLowerCase();
  if (names[code]) return names[code];
  // Незнакомый код — не страна: ICU на «zz» отвечает «неизвестный регион»,
  // а списку нужен именно null, чтобы показать адрес узла.
  if (!(code in COUNTRY)) return null;
  // Остальные страны и территории берём из ICU: 250 названий руками — это
  // гарантированные опечатки, а Windows уже знает их по-русски.
  try {
    return new Intl.DisplayNames(["ru"], { type: "region" }).of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}
