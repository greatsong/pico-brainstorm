
import { GoogleGenAI } from "@google/genai";

const apiKey = "dummy_key";
const ai = new GoogleGenAI({ apiKey });

console.log("ai instance:", ai);
console.log("ai.models:", ai.models);
console.log("ai.models.generateContentStream:", ai.models.generateContentStream);

async function test() {
    try {
        const result = await ai.models.generateContentStream({
            model: "gemini-3-pro-preview",
            contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        });
        console.log("Result:", result);
        if (result) {
            console.log("Is async iterable?", result[Symbol.asyncIterator]);
        }
    } catch (e) {
        console.error("Error calling generateContentStream:", e);
    }
}

test();
