import { strFromU8, unzipSync } from "fflate";

const headerAliases = {
  prompt: ["题干", "题目", "问题", "prompt"],
  optionA: ["选项A", "A", "optionA"],
  optionB: ["选项B", "B", "optionB"],
  optionC: ["选项C", "C", "optionC"],
  optionD: ["选项D", "D", "optionD"],
  answer: ["正确答案", "答案", "answer", "answers"],
  type: ["题型", "类型", "type"],
  explanation: ["答案解析", "解析", "explanation"]
};

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function pick(record, key) {
  const alias = headerAliases[key].find((name) => Object.prototype.hasOwnProperty.call(record, name));
  return alias ? record[alias] : "";
}

function answerIndexes(value) {
  const tokens = String(value || "")
    .toUpperCase()
    .split(/[,，、/;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const indexes = tokens.map((token) => {
    if (/^[A-D]$/.test(token)) return token.charCodeAt(0) - 65;
    if (/^[1-4]$/.test(token)) return Number(token) - 1;
    if (/^[0-3]$/.test(token)) return Number(token);
    return -1;
  }).filter((index) => index >= 0 && index <= 3);
  return [...new Set(indexes)];
}

function normalizeQuestion(record, index) {
  const prompt = String(record.prompt ?? pick(record, "prompt") ?? "").trim();
  const options = Array.isArray(record.options) ? record.options : [
    record.optionA ?? pick(record, "optionA"),
    record.optionB ?? pick(record, "optionB"),
    record.optionC ?? pick(record, "optionC"),
    record.optionD ?? pick(record, "optionD")
  ];
  const rawAnswers = Array.isArray(record.answerIndexes)
    ? record.answerIndexes.map(Number)
    : answerIndexes(record.answer ?? record.correctAnswer ?? pick(record, "answer"));
  const normalizedAnswers = rawAnswers.filter((answer) => Number.isInteger(answer) && answer >= 0 && answer < 4);
  const typeValue = String(record.type ?? pick(record, "type") ?? "").toLowerCase();
  const type = typeValue.includes("多") || typeValue === "multiple" || normalizedAnswers.length > 1 ? "multiple" : "single";

  if (!prompt) throw new Error(`第 ${index + 1} 行缺少题干`);
  if (options.filter((item) => String(item || "").trim()).length < 2) throw new Error(`第 ${index + 1} 行至少需要两个选项`);
  if (normalizedAnswers.length === 0) throw new Error(`第 ${index + 1} 行缺少正确答案`);

  return {
    prompt,
    optionA: String(options[0] || "").trim(),
    optionB: String(options[1] || "").trim(),
    optionC: String(options[2] || "").trim(),
    optionD: String(options[3] || "").trim(),
    type,
    answerIndexes: (type === "single" ? normalizedAnswers.slice(0, 1) : normalizedAnswers).map(String),
    explanation: String(record.explanation ?? pick(record, "explanation") ?? "").trim()
  };
}

export function parseExamQuestionFile(text, filename = "questions.csv") {
  const lowerName = String(filename).toLowerCase();
  if (lowerName.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("JSON 文件格式不正确");
    }
    const questions = Array.isArray(parsed) ? parsed : parsed?.questions;
    if (!Array.isArray(questions) || questions.length === 0) throw new Error("文件中没有题目");
    return questions.map(normalizeQuestion);
  }

  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("CSV 文件中没有题目");
  const headers = rows[0];
  const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  return records.map(normalizeQuestion);
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function xmlText(xml) {
  return decodeXmlEntities(String(xml || "").replace(/<[^>]+>/g, ""));
}

function textRuns(xml) {
  return [...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlEntities(match[1]))
    .join("")
    .replace(/\u00a0/g, " ")
    .trim();
}

function parseDocxBlocks(documentXml) {
  const bodyMatch = /<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/.exec(String(documentXml || ""));
  if (!bodyMatch) throw new Error("Word 文档缺少正文内容");
  const body = bodyMatch[1];
  const blocks = [];
  const blockPattern = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g;
  for (const match of body.matchAll(blockPattern)) {
    const xml = match[0];
    if (xml.startsWith("<w:p")) {
      const text = textRuns(xml);
      if (text) blocks.push({ type: "paragraph", text });
      continue;
    }
    const cells = [...xml.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)]
      .map((cell) => textRuns(cell[1]))
      .filter(Boolean);
    if (cells.length) blocks.push({ type: "table", cells, text: cells.join("\n") });
  }
  return blocks;
}

function questionMarkers(text) {
  return [...String(text || "").matchAll(/(\d{1,3})\s*[.．、]\s*/g)]
    .map((match) => ({ number: Number(match[1]), start: match.index + match[0].length, markerStart: match.index }));
}

function cleanQuestionPrompt(value) {
  return String(value || "")
    .replace(/\[\s*(?:单选|多选)题\s*\]/gi, "")
    .replace(/[＊*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOptionCell(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const marker = /^(?:([A-D])\s*[、.．:：]\s*)?(.*)$/i.exec(text);
  const content = marker?.[2]?.trim() || text;
  return {
    label: marker?.[1]?.toUpperCase() || "",
    text: content.replace(/\(正确答案\)|（正确答案）/g, "").trim(),
    correct: /\(正确答案\)|（正确答案）/i.test(content)
  };
}

function parseQuestionFromParts(prompt, optionValues, index, warningSeed = []) {
  const cleanedPrompt = cleanQuestionPrompt(prompt);
  const options = optionValues.map(parseOptionCell).filter((option) => option.text);
  const answerIndexes = options
    .map((option, optionIndex) => option.correct ? optionIndex : -1)
    .filter((optionIndex) => optionIndex >= 0)
    .map(String);
  const explicitType = /\[\s*(多选|单选)题\s*\]/i.exec(prompt)?.[1];
  const type = explicitType === "多选" || answerIndexes.length > 1 ? "multiple" : "single";
  const warnings = [...warningSeed];
  if (!cleanedPrompt) warnings.push(`第 ${index} 题缺少题干`);
  if (options.length < 2) warnings.push(`第 ${index} 题选项少于两个`);
  if (answerIndexes.length === 0) warnings.push(`第 ${index} 题没有识别到正确答案`);
  if (options.some((option, optionIndex) => option.label && option.label !== String.fromCharCode(65 + optionIndex))) {
    warnings.push(`第 ${index} 题选项字母顺序异常`);
  }
  if (options.some((option) => /[A-D]\s*[、.．:：]/i.test(option.text))) {
    warnings.push(`第 ${index} 题存在选项粘连，需核对`);
  }
  return {
    prompt: cleanedPrompt,
    optionA: options[0]?.text || "",
    optionB: options[1]?.text || "",
    optionC: options[2]?.text || "",
    optionD: options[3]?.text || "",
    type,
    answerIndexes,
    explanation: "",
    warnings
  };
}

function parseInlineQuestionSegments(text) {
  const source = String(text || "").replace(/\u00a0/g, " ");
  const markers = questionMarkers(source);
  return markers.map((marker, index) => ({
    number: marker.number,
    text: source.slice(marker.start, index + 1 < markers.length ? markers[index + 1].markerStart : source.length).trim()
  }));
}

function parseInlineQuestion(segment) {
  const content = segment.text.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ").trim();
  let typeMatch = /\[\s*(单选|多选)题\s*\]/i.exec(content);
  let optionsStart = typeMatch ? (typeMatch.index || 0) + typeMatch[0].length : 0;
  let optionSource = content.slice(optionsStart).trim();
  let optionMarkers = [...optionSource.matchAll(/([A-D])\s*[、.．:：]\s*/gi)];
  let prompt = (typeMatch ? content.slice(0, typeMatch.index || 0) : optionSource.slice(0, optionMarkers[0]?.index || optionSource.length)).trim();
  const initialCorrectMarkerCount = (optionSource.match(/正确答案/gi) || []).length;
  if (!typeMatch && (optionMarkers.length || initialCorrectMarkerCount > 1)) {
    const punctuationIndex = Math.max(content.lastIndexOf("？"), content.lastIndexOf("?"));
    if (punctuationIndex >= 0) {
      prompt = content.slice(0, punctuationIndex + 1).trim();
      optionSource = content.slice(punctuationIndex + 1).trim();
      optionMarkers = [...optionSource.matchAll(/([A-D])\s*[、.．:：]\s*/gi)];
    }
  }
  const options = [];
  const correctMarkerCount = (optionSource.match(/正确答案/gi) || []).length;
  if (correctMarkerCount > 1 && optionMarkers.length < 4) {
    options.push(...optionSource.split(/(?<=\(正确答案\)|（正确答案）)/).filter(Boolean));
  } else if (optionMarkers.length && optionMarkers[0].index > 0) {
    options.push(optionSource.slice(0, optionMarkers[0].index).trim());
  }
  if (correctMarkerCount <= 1 && optionMarkers.length) {
    optionMarkers.forEach((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = index + 1 < optionMarkers.length ? optionMarkers[index + 1].index : optionSource.length;
      options.push(optionSource.slice(start, end).trim());
    });
  } else if (correctMarkerCount <= 1) {
    const chunks = optionSource.split(/(?<=\(正确答案\)|（正确答案）)/).filter(Boolean);
    options.push(...chunks);
  }
  const normalized = parseQuestionFromParts(prompt.replace(typeMatch?.[0] || "", ""), options, segment.number, [
    ...(optionMarkers.length === 0 || options.some((_, index) => !optionMarkers[index]) ? [`第 ${segment.number} 题选项字母不完整，已按顺序尝试识别`] : [])
  ]);
  return normalized;
}

function parseWordQuestionBlocks(blocks) {
  const questions = [];
  const warnings = [];
  let pending = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === "paragraph") {
      const markers = questionMarkers(block.text);
      if (!markers.length) continue;
      const marker = markers[0];
      const prompt = block.text.slice(marker.start).trim();
      pending = { number: marker.number, prompt, blockIndex: index };
      continue;
    }
    if (block.type !== "table") continue;
    if (pending) {
      const optionCells = block.cells.filter((cell) => !questionMarkers(cell).length || questionMarkers(cell)[0].number === pending.number);
      const firstQuestionCell = block.cells.findIndex((cell) => questionMarkers(cell).length > 0);
      const cellsForPending = firstQuestionCell >= 0 ? block.cells.slice(0, firstQuestionCell) : optionCells;
      if (cellsForPending.length >= 2) {
        const parsed = parseQuestionFromParts(pending.prompt, cellsForPending, pending.number);
        questions.push({ number: pending.number, ...parsed });
      } else {
        warnings.push(`第 ${pending.number} 题未找到选项`);
      }
      pending = null;
      if (firstQuestionCell >= 0) {
        for (const cell of block.cells.slice(firstQuestionCell)) {
          for (const segment of parseInlineQuestionSegments(cell)) {
            questions.push({ number: segment.number, ...parseInlineQuestion(segment) });
          }
        }
      }
    } else {
      for (const cell of block.cells) {
        for (const segment of parseInlineQuestionSegments(cell)) {
          questions.push({ number: segment.number, ...parseInlineQuestion(segment) });
        }
      }
    }
  }
  if (pending) warnings.push(`第 ${pending.number} 题未找到选项`);
  const deduped = [...new Map(questions.map((question) => [question.number, question])).values()]
    .sort((left, right) => left.number - right.number);
  return {
    questions: deduped,
    warnings: [...warnings, ...deduped.flatMap((question) => question.warnings || [])]
  };
}

export async function parseExamQuestionDocx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const archive = unzipSync(bytes);
  const documentXml = archive["word/document.xml"];
  if (!documentXml) throw new Error("Word 文件中没有找到正文内容");
  const parsed = parseWordQuestionBlocks(parseDocxBlocks(strFromU8(documentXml)));
  if (!parsed.questions.length) throw new Error("Word 文件中没有识别到题目");
  return parsed;
}

export function splitExamQuestionGroups(questions, groupSize = 10) {
  const sorted = [...questions].sort((left, right) => Number(left.number || 0) - Number(right.number || 0));
  return Array.from({ length: Math.ceil(sorted.length / groupSize) }, (_, index) => ({
    index: index + 1,
    title: `示例产品C产品评测（${["一", "二", "三", "四", "五"][index] || index + 1}）`,
    productName: "示例产品C",
    questions: sorted.slice(index * groupSize, (index + 1) * groupSize)
  }));
}

export function examQuestionTemplate() {
  return "题干,选项A,选项B,选项C,选项D,正确答案,题型,答案解析\n示例题目,选项一,选项二,选项三,选项四,B,单选,填写答案解释";
}
