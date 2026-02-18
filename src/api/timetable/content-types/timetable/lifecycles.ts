import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

// --- CONFIGURATION ---
const PDF_FIELD = 'timetableImage'; 
const JSON_FIELD = 'prayerData';     
const COLLECTION_UID = 'api::timetable.timetable'; 
// ---------------------

export default {
  async afterCreate(event: any) {
    // Always run on initial creation if a PDF is attached
    await processTimetable(event);
  },

  async beforeUpdate(event: any) {
    const { params } = event;
    
    // Check if the update payload even includes the PDF field
    if (params.data && params.data[PDF_FIELD] !== undefined) {
      // 1. Fetch the existing database entry BEFORE the update happens
      const existingEntry = await strapi.entityService.findOne(COLLECTION_UID, params.where.id, {
        populate: [PDF_FIELD]
      });

      // 2. Compare the old PDF ID with the incoming new PDF ID
      const oldFileId = existingEntry?.[PDF_FIELD]?.id;
      const newFileId = getFileId(params.data[PDF_FIELD]);

      // 3. Set a flag so afterUpdate knows whether to run the AI
      if (oldFileId !== newFileId) {
          event.state = { ...event.state, pdfChanged: true };
      } else {
          event.state = { ...event.state, pdfChanged: false };
      }
    } else {
      // If the field isn't in the payload, the user is just saving text/JSON edits
      event.state = { ...event.state, pdfChanged: false };
    }
  },

  async afterUpdate(event: any) {
    // 4. ONLY run the AI if the PDF was actually replaced.
    // This protects your manual edits and stops the infinite loop.
    if (event.state && event.state.pdfChanged) {
        strapi.log.info(`[Timetable AI] PDF change detected. Running AI extraction...`);
        await processTimetable(event);
    } else {
        strapi.log.info(`[Timetable AI] No PDF change detected. Skipping AI to protect manual edits.`);
    }
  },
};

function getFileId(fieldData: any): number | string | null {
  if (!fieldData) return null;
  if (typeof fieldData === 'number' || typeof fieldData === 'string') return fieldData;
  if (typeof fieldData === 'object' && 'id' in fieldData) return fieldData.id;
  if (fieldData.connect && Array.isArray(fieldData.connect) && fieldData.connect.length > 0) {
    return getFileId(fieldData.connect[0]);
  }
  if (Array.isArray(fieldData) && fieldData.length > 0) {
    return getFileId(fieldData[0]);
  }
  return null;
}

async function processTimetable(event: any) {
  const { result, params } = event;

  // Validation
  if (!params.data || !params.data[PDF_FIELD]) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return;

  try {
    const fileId = getFileId(params.data[PDF_FIELD]);
    if (!fileId) return;

    const fileData: any = await strapi.db.query('plugin::upload.file').findOne({
      where: { id: fileId }
    });

    if (!fileData || fileData.ext !== '.pdf') return;

    // Get File Buffer
    let base64Data: string = "";
    if (fileData.url.startsWith('http')) {
      const response = await fetch(fileData.url);
      if (!response.ok) throw new Error(`Failed to fetch PDF`);
      const arrayBuffer = await response.arrayBuffer();
      base64Data = Buffer.from(arrayBuffer).toString('base64');
    } else {
      const publicDir = strapi.dirs.static.public;
      const filePath = path.join(publicDir, fileData.url);
      if (!fs.existsSync(filePath)) return;
      const fileBuffer = fs.readFileSync(filePath);
      base64Data = fileBuffer.toString('base64');
    }

    // Send to Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const targetMonth = result.month || "Unknown";
    const targetYear = result.year || "Unknown";

    const prompt = `
      You are a data extraction engine.
      Target Month: ${targetMonth}
      
      STEP 1: SAFETY CHECK
      Scan the document for printed Month Names.
      - IF the document is for a single month and it CONTRADICTS "${targetMonth}":
        Return this JSON: [{ "ERROR": "MISMATCH: PDF says [Found Month] but entry is for ${targetMonth}." }]
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
      2. DATE FORMAT: The "date" field MUST be an integer representing the standard Gregorian calendar date. 
         - If the document says "19.2" or "19th Feb", the date is 19. 
         - Do NOT output decimals like "19.2".
         - Do NOT use the Islamic date/Ramadan day number as the calendar date.
      3. 100% Accuracy for numbers.
      4. No leading zeros.
      5. Keep slashes for multiple times (e.g., "12.30/1.30").
      6. Output ONLY a valid JSON array.
    `;

    strapi.log.info(`[Timetable AI] Processing PDF for ${targetMonth}...`);
    
    const aiResult = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: "application/pdf" } },
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
    
    if (parsedData[0]?.ERROR) {
       strapi.log.warn(`[Timetable AI] BLOCKED: ${parsedData[0].ERROR}`);
    } else {
       strapi.log.info(`[Timetable AI] SUCCESS! Database updated.`);
    }

  } catch (error: any) {
    strapi.log.error(`[Timetable AI] Error: ${error.message}`);
  }
}