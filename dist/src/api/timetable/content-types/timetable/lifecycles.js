"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const generative_ai_1 = require("@google/generative-ai");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// --- CONFIGURATION ---
const PDF_FIELD = 'timetableImage';
const JSON_FIELD = 'prayerData';
const COLLECTION_UID = 'api::timetable.timetable';
// ---------------------
exports.default = {
    async afterCreate(event) {
        var _a;
        //  LOOP PROTECTION 
        // When you click "Publish", Strapi clones the document.
        // If it's a clone, the JSON data will already exist. Do NOT run the AI.
        const existingData = (_a = event.result) === null || _a === void 0 ? void 0 : _a[JSON_FIELD];
        const hasData = Array.isArray(existingData) && existingData.length > 0 && !existingData[0].ERROR;
        if (hasData) {
            strapi.log.info(`[Timetable AI] Publish/Clone action detected. Skipping AI to break loop.`);
            return;
        }
        strapi.log.info(`[Timetable AI] Brand new entry detected. Running AI...`);
        await processTimetable(event);
    },
    async beforeUpdate(event) {
        var _a;
        const { params } = event;
        // Check if the update payload even includes the PDF field
        if (params.data && params.data[PDF_FIELD] !== undefined) {
            // Fetch existing entry to compare
            const existingEntry = await strapi.entityService.findOne(COLLECTION_UID, params.where.id, {
                populate: [PDF_FIELD]
            });
            const oldFileId = (_a = existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry[PDF_FIELD]) === null || _a === void 0 ? void 0 : _a.id;
            const newFileId = getFileId(params.data[PDF_FIELD]);
            // If IDs are different, the user explicitly clicked "Replace" on the PDF
            if (oldFileId !== newFileId) {
                event.state = { ...event.state, pdfChanged: true };
            }
            else {
                event.state = { ...event.state, pdfChanged: false };
            }
        }
        else {
            // Field isn't in payload (e.g. Publish action, or manual text edit)
            event.state = { ...event.state, pdfChanged: false };
        }
    },
    async afterUpdate(event) {
        // Only run if beforeUpdate proved the PDF/Image was actually swapped
        if (event.state && event.state.pdfChanged) {
            strapi.log.info(`[Timetable AI] File explicitly replaced. Running AI extraction...`);
            await processTimetable(event);
        }
        else {
            strapi.log.info(`[Timetable AI] No file change detected. Skipping AI to protect manual edits.`);
        }
    },
};
function getFileId(fieldData) {
    if (!fieldData)
        return null;
    if (typeof fieldData === 'number' || typeof fieldData === 'string')
        return fieldData;
    if (typeof fieldData === 'object' && 'id' in fieldData)
        return fieldData.id;
    if (fieldData.connect && Array.isArray(fieldData.connect) && fieldData.connect.length > 0) {
        return getFileId(fieldData.connect[0]);
    }
    if (Array.isArray(fieldData) && fieldData.length > 0) {
        return getFileId(fieldData[0]);
    }
    return null;
}
async function processTimetable(event) {
    var _a;
    const { result, params } = event;
    if (!params.data || !params.data[PDF_FIELD])
        return;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        return;
    try {
        const fileId = getFileId(params.data[PDF_FIELD]);
        if (!fileId)
            return;
        const fileData = await strapi.db.query('plugin::upload.file').findOne({
            where: { id: fileId }
        });
        //  UPDATED: Allow PDFs AND standard Image formats
        const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
        if (!fileData || !allowedExtensions.includes(fileData.ext.toLowerCase())) {
            strapi.log.warn(`[Timetable AI] Unsupported file type: ${fileData === null || fileData === void 0 ? void 0 : fileData.ext}. Skipping.`);
            return;
        }
        let base64Data = "";
        if (fileData.url.startsWith('http')) {
            const response = await fetch(fileData.url);
            if (!response.ok)
                throw new Error(`Failed to fetch file`);
            const arrayBuffer = await response.arrayBuffer();
            base64Data = Buffer.from(arrayBuffer).toString('base64');
        }
        else {
            const publicDir = strapi.dirs.static.public;
            const filePath = path_1.default.join(publicDir, fileData.url);
            if (!fs_1.default.existsSync(filePath))
                return;
            const fileBuffer = fs_1.default.readFileSync(filePath);
            base64Data = fileBuffer.toString('base64');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const targetMonth = result.month || "Unknown";
        const targetYear = result.year || "Unknown";
        const prompt = `
      You are a data extraction engine.
      Target Month: ${targetMonth}
      
      STEP 1: SAFETY CHECK
      Scan the document for printed Month Names.
      - IF the document is for a single month and it CONTRADICTS "${targetMonth}":
        Return this JSON: [{ "ERROR": "MISMATCH: Document says [Found Month] but entry is for ${targetMonth}." }]
      - IF the document covers multiple months (e.g., Feb-Mar) and "${targetMonth}" is ONE of those months:
        Proceed to Step 2.
      - IF it matches or has no month:
        Proceed to Step 2.

      STEP 2: EXTRACTION
      Extract the prayer timetable into this JSON format:
      [
        {
          "date": 1,
          "day": "MON",
          "fajr": { "start": "5.39", "jamaat": "7.00" },
          "dhuhar": { "start": "11.47", "jamaat": "12.30/1.30" },
          "asr": { "start": "2.08", "jamaat": "2.30" },
          "maghrib": { "start": "3.53", "jamaat": "3.53" },
          "isha": { "start": "5.53", "jamaat": "7.00" }
        }
      ]

      CRITICAL RULES:
      1. EXACT MONTH FILTERING: If the timetable covers multiple months (like Feb-Mar), you MUST ONLY output the rows that belong to the Target Month ("${targetMonth}"). Completely ignore and drop all rows belonging to the other month.
      
      2. DATE EXTRACTION (UNIVERSAL RULE): 
         - The layout varies. It may have separate "Date" and "Day" columns (e.g., "1" and "MON"), OR it may have a combined "Day/Date" column (e.g., "SUN 1.3").
         - IF SEPARATE: Use the standard "Date" column number.
         - IF COMBINED: Extract the Gregorian date from the string (e.g., for "SUN 1.3", the date is 1. For "THU 19.2", the date is 19).
         - RAMADAN IGNORE RULE: If you see an extra column with sequential numbers (1, 2... 11, 12) next to a combined "Day/Date", IGNORE IT completely. That is the Islamic date. Only output the Gregorian date for the "date" field.
         
      3. COLUMN MAPPING FOR MAGHRIB & ISHA:
         - There is only ONE column for "Maghrib/ Iftari". Take this single time and duplicate it in BOTH the "start" and "jamaat" fields for maghrib.
         - The column immediately after Maghrib is "Isha start".
         - The final column is "Isha Jamaat". Do not shift or mix these up!
         
      4. 100% Accuracy for numbers. No leading zeros. Keep slashes for multiple times (e.g., "12.30/1.30").
      5. Output ONLY a valid JSON array.
    `;
        strapi.log.info(`[Timetable AI] Processing file for ${targetMonth}...`);
        //  UPDATED: Dynamically pass the correct MIME type
        const aiResult = await model.generateContent([
            prompt,
            { inlineData: { data: base64Data, mimeType: fileData.mime } },
        ]);
        const response = await aiResult.response;
        const textResponse = response.text();
        const cleanJson = textResponse.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsedData = JSON.parse(cleanJson);
        // Save Result
        await strapi.entityService.update(COLLECTION_UID, result.id, {
            data: {
                [JSON_FIELD]: parsedData
            }
        });
        if ((_a = parsedData[0]) === null || _a === void 0 ? void 0 : _a.ERROR) {
            strapi.log.warn(`[Timetable AI] BLOCKED: ${parsedData[0].ERROR}`);
        }
        else {
            strapi.log.info(`[Timetable AI] SUCCESS! Database updated.`);
        }
    }
    catch (error) {
        strapi.log.error(`[Timetable AI] Error: ${error.message}`);
    }
}
