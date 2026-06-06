"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generative_ai_1 = require("@google/generative-ai");
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
    async beforeCreate(event) {
        const { params } = event;
        if (params.data && params.data[JSON_FIELD] !== undefined && typeof params.data[JSON_FIELD] !== 'string') {
            params.data[JSON_FIELD] = JSON.stringify(params.data[JSON_FIELD]);
        }
    },
    async beforeUpdate(event) {
        try {
            const { params } = event;
            if (params.data && params.data[JSON_FIELD] !== undefined && typeof params.data[JSON_FIELD] !== 'string') {
                params.data[JSON_FIELD] = JSON.stringify(params.data[JSON_FIELD]);
            }
        }
        catch (error) {
            strapi.log.error(`[Timetable AI] beforeUpdate Error: ${error.message}`);
        }
    },
    async afterUpdate(event) {
        var _a;
        const existingData = (_a = event.result) === null || _a === void 0 ? void 0 : _a[JSON_FIELD];
        const hasData = Array.isArray(existingData) && existingData.length > 0 && !existingData[0].ERROR;
        if (!hasData) {
            strapi.log.info(`[Timetable AI] prayerData is empty. Running AI extraction...`);
            await processTimetable(event);
        }
        else {
            strapi.log.info(`[Timetable AI] prayerData already has data. Skipping AI to protect manual edits.`);
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
            const port = strapi.config.get('server.port') || 1337;
            const fileUrl = `http://127.0.0.1:${port}${fileData.url}`;
            const response = await fetch(fileUrl);
            if (!response.ok)
                throw new Error(`Failed to fetch local file via loopback`);
            const arrayBuffer = await response.arrayBuffer();
            base64Data = Buffer.from(arrayBuffer).toString('base64');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-flash-lite-preview",
            systemInstruction: "You are a data extraction engine. Your job is to extract structured prayer timetables from provided files, performing safety checks for matching month names, and ensuring high precision for time values."
        });
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
         - ISHA COLUMNS LAYOUT CHECK:
           - IF the table has TWO columns for Isha (e.g. "Isha Start" and "Isha Jamaat"): Map the first to the "start" field and the second to the "jamaat" field under the "isha" object.
           - IF the table has ONLY ONE column for Isha (e.g. labeled "Isha" or "Isha Jamaat", with no separate "Isha Start" column): Map that single column to BOTH the "start" and "jamaat" fields under the "isha" object.
           - Under no circumstances should the "start" field in the "isha" object be populated with the Maghrib time.
         
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
                [JSON_FIELD]: JSON.stringify(parsedData)
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
